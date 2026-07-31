// AudioNode에 직접 .value를 대입하는 실수를 찾는다.
// GainNode.value = x 는 조용히 무시된다 (올바른 것은 GainNode.gain.value = x).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// 저장소 루트에서 실행한다 (npm run check)
const ROOT = new URL('../src', import.meta.url).pathname;

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else if (/\.(astro|ts)$/.test(entry)) out.push(path);
  }
  return out;
}

// AudioParam을 가진 노드 필드 이름들 — 이 이름 뒤에 바로 .value가 오면 의심
const NODE_HINTS = ['Gain', 'gain', 'Node', 'source', 'filter', 'osc', 'oscillator', 'panner'];
let hits = 0;
for (const file of collect(ROOT)) {
  const source = readFileSync(file, 'utf8');
  source.split('\n').forEach((line, index) => {
    // createGain()/createOscillator() 결과에 .value를 직접 대입하는 형태
    const match = line.match(/(\b[\w.]*(?:[Gg]ain|[Nn]ode)\b)\.value\s*=/);
    if (!match) return;
    // .gain.value / .frequency.value / .detune.value 등은 정상
    if (/\.(gain|frequency|detune|Q|pan|delayTime|threshold|knee|ratio|attack|release)\.value\s*=/.test(line)) return;
    hits++;
    console.log(`${file.replace(ROOT, 'src')}:${index + 1}  ${line.trim()}`);
  });
}
console.log(hits === 0 ? 'AudioNode에 직접 .value 대입 없음' : `의심 ${hits}건`);
if (hits > 0) process.exitCode = 1;
