// .astro 파일의 <script> 블록에서 "정의도 import도 되지 않은 함수 호출"을 찾는다.
// 브라우저에서만 드러나는 ReferenceError를 빌드 전에 잡기 위한 거친 검사기.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 저장소 루트에서 실행한다 (npm run check)
const ROOT = new URL('../src', import.meta.url).pathname;

// 브라우저·표준 전역 (호출 형태로 쓰이는 것들)
const GLOBALS = new Set([
  'if','for','while','switch','catch','return','function','typeof','new','await','case','do','else',
  'String','Number','Boolean','Array','Object','Math','JSON','Date','Map','Set','WeakMap','WeakSet',
  'Promise','Error','TypeError','RangeError','Symbol','BigInt','Proxy','Reflect','Intl',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'fetch','alert','confirm','prompt','structuredClone','queueMicrotask','btoa','atob',
  'Uint8Array','Uint8ClampedArray','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array',
  'Float32Array','Float64Array','ArrayBuffer','DataView','TextEncoder','TextDecoder','Blob','File',
  'FileReader','URL','URLSearchParams','FormData','Image','Audio','AudioContext','OfflineAudioContext',
  'AudioWorkletNode','MediaRecorder','RTCPeerConnection','RTCSessionDescription','ImageData',
  'createImageBitmap','ResizeObserver','MutationObserver','IntersectionObserver','CompressionStream',
  'DecompressionStream','Response','Request','Headers','Worker','EventTarget','CustomEvent','Event',
  'DOMParser','XMLSerializer','matchMedia','getComputedStyle','crypto','performance','console',
  'GIFEncoder','quantize','applyPalette','RegExp','FontFace','WebSocket','Notification',
  // AudioWorklet 안에서만 존재하는 것들 (워클릿 코드는 문자열로 들어간다)
  'registerProcessor','process','currentFrame','currentTime','sampleRate',
]);

/** 주석과 문자열 리터럴을 제거한다. 템플릿 리터럴은 ${...} 안의 코드만 남긴다. */
function stripNonCode(source) {
  let out = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''").replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  // 템플릿 리터럴: 백틱 사이에서 ${...}만 남긴다
  out = out.replace(/`(?:\\.|[^`\\])*`/g, (literal) => {
    const parts = [...literal.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]);
    return parts.length ? `(${parts.join(',')})` : "''";
  });
  // 정규식 리터럴 제거 — 나눗셈과 헷갈리지 않게 앞 문자가 (,=:[!&|?{;+ 인 경우만
  out = out.replace(/([(,=:[!&|?{;+]\s*)\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, '$1/RE/');
  // async 화살표 함수는 호출이 아니다
  return out.replace(/\basync\s*\(/g, '(');
}

function collectAstro(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collectAstro(path));
    else if (entry.endsWith('.astro')) out.push(path);
  }
  return out;
}

let problems = 0;
for (const file of collectAstro(ROOT)) {
  const source = readFileSync(file, 'utf8');
  // 클라이언트 <script> 블록만 본다 (is:inline 포함)
  const blocks = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length === 0) continue;
  const code = stripNonCode(blocks.join('\n'));

  const defined = new Set();
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  // 객체 메서드 축약(`childrenOf(id) {`)과 타입의 메서드 시그니처(`setSinkId(id: string):`)
  for (const m of code.matchAll(/^\s*(?:get |set |async )?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/gm)) {
    defined.add(m[1]);
  }
  // 타입 안의 메서드 시그니처 — `{ setSinkId(id: string): Promise<void> }` 처럼 줄 중간에 온다
  for (const m of code.matchAll(/[{;]\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:/g)) defined.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  // 구조 분해·import 목록
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim().replace(/^\.\.\./, '');
      if (name) defined.add(name);
    }
  }
  for (const m of code.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/^\s*type\s+/, '').split(' as ').pop().trim();
      if (name) defined.add(name);
    }
  }
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1]);
  // 함수 매개변수 이름
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }
  // (transform: (value: unknown) => unknown) 처럼 괄호가 중첩된 매개변수
  for (const m of code.matchAll(/[(,]\s*([A-Za-z_$][\w$]*)\s*:/g)) defined.add(m[1]);
  for (const m of code.matchAll(/function\s+[\w$]*\s*\(([^()]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }

  // 호출 형태 식별자 중 정의/전역/멤버호출이 아닌 것
  const missing = new Map();
  for (const m of code.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (defined.has(name) || GLOBALS.has(name)) continue;
    // 타입 어서션·제네릭 등 노이즈 제외
    if (/^(as|of|in|instanceof|void|delete|yield|throw|export|import|class|extends|satisfies)$/.test(name)) continue;
    const line = code.slice(0, m.index).split('\n').length;
    if (!missing.has(name)) missing.set(name, line);
  }
  if (missing.size > 0) {
    problems += missing.size;
    console.log(`\n${file.replace(ROOT, 'src')}`);
    for (const [name, line] of missing) console.log(`  미정의 호출 가능성: ${name}() (script 기준 ${line}행)`);
  }
}
console.log(problems === 0 ? '\n미정의 호출 없음' : `\n의심 ${problems}건 — 확인 필요`);
// 오탐이 섞이는 거친 검사라 종료 코드는 항상 0으로 두고, 목록만 보고 판단한다.
