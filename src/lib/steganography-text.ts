// 글 속에 메시지를 숨기는 세 가지 기법 — 제로폭 문자 · 호모글리프 · 공백.
//
// 세 기법의 트레이드오프가 다르다. 제로폭은 어떤 글에든 원하는 만큼 넣을 수 있지만
// 입력값을 정리하는 서비스가 잘 지운다. 호모글리프는 실제로 보이는 문자를 시각적으로
// 같은 다른 문자로 바꾸는 것이라 그런 필터를 통과하지만, 바꿀 수 있는 글자 수만큼만
// 담을 수 있다. 공백은 줄 끝에 붙어 눈에 안 띄지만 편집기가 자동으로 잘라낼 수 있다.

export type TextTechnique = 'zeroWidth' | 'homoglyph' | 'whitespace';

// ---------- 제로폭 문자 ----------

const ZERO_WIDTH_ALPHABET = ['​', '‌', '‍', '⁠'];
const ZERO_WIDTH_SET = new Set(ZERO_WIDTH_ALPHABET);

export function toZeroWidth(payload: Uint8Array): string {
  let output = '';
  for (const byte of payload) {
    // 한 바이트 = 2비트씩 4글자
    output += ZERO_WIDTH_ALPHABET[(byte >> 6) & 3];
    output += ZERO_WIDTH_ALPHABET[(byte >> 4) & 3];
    output += ZERO_WIDTH_ALPHABET[(byte >> 2) & 3];
    output += ZERO_WIDTH_ALPHABET[byte & 3];
  }
  return output;
}

export function fromZeroWidth(text: string): Uint8Array {
  const symbols: number[] = [];
  for (const character of text) {
    const index = ZERO_WIDTH_ALPHABET.indexOf(character);
    if (index >= 0) symbols.push(index);
  }
  const byteCount = Math.floor(symbols.length / 4);
  const output = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const base = i * 4;
    output[i] =
      (symbols[base] << 6) |
      (symbols[base + 1] << 4) |
      (symbols[base + 2] << 2) |
      symbols[base + 3];
  }
  return output;
}

export function countZeroWidth(text: string): number {
  let count = 0;
  for (const character of text) {
    if (ZERO_WIDTH_SET.has(character)) count++;
  }
  return count;
}

export function stripZeroWidth(text: string): string {
  return [...text].filter((character) => !ZERO_WIDTH_SET.has(character)).join('');
}

export type ZeroWidthPlacement = 'end' | 'spread';

/** 겉보기 텍스트에 제로폭 비밀 문자열을 심는다 */
export function hideInText(
  visibleText: string,
  hidden: string,
  placement: ZeroWidthPlacement,
): string {
  if (placement === 'end' || visibleText.length === 0) return visibleText + hidden;
  // 단어 사이(공백 뒤)에 균등 분배 — 자리 수가 부족하면 남는 건 끝에 붙인다
  const gaps: number[] = [];
  for (let i = 1; i < visibleText.length; i++) {
    if (/\s/.test(visibleText[i - 1]) && !/\s/.test(visibleText[i])) gaps.push(i);
  }
  if (gaps.length === 0) return visibleText + hidden;
  const perGap = Math.ceil(hidden.length / gaps.length);
  let output = '';
  let cursor = 0;
  let consumed = 0;
  for (const gap of gaps) {
    output += visibleText.slice(cursor, gap);
    output += hidden.slice(consumed, consumed + perGap);
    consumed += perGap;
    cursor = gap;
  }
  output += visibleText.slice(cursor);
  if (consumed < hidden.length) output += hidden.slice(consumed);
  return output;
}

// ---------- 호모글리프 (동형 문자) ----------
//
// 라틴 문자를 눈으로 구별할 수 없는 키릴·그리스 문자로 바꿀 수 있다. 바꿨으면 1,
// 원래 문자면 0. 그래서 겉보기 글자 수와 모양이 그대로 유지된다.
// 주의: 이 성질 때문에 피싱 도메인(예: аpple.com)에 악용되는 기법이기도 하다.

const HOMOGLYPH_PAIRS: [string, string][] = [
  ['a', 'а'], // 키릴 а
  ['c', 'с'],
  ['e', 'е'],
  ['i', 'і'],
  ['j', 'ј'],
  ['o', 'о'],
  ['p', 'р'],
  ['s', 'ѕ'],
  ['x', 'х'],
  ['y', 'у'],
  ['A', 'А'],
  ['B', 'В'],
  ['C', 'С'],
  ['E', 'Е'],
  ['H', 'Н'],
  ['I', 'І'],
  ['K', 'К'],
  ['M', 'М'],
  ['O', 'О'],
  ['P', 'Р'],
  ['T', 'Т'],
  ['X', 'Х'],
];

const TO_HOMOGLYPH = new Map(HOMOGLYPH_PAIRS);
const FROM_HOMOGLYPH = new Map(HOMOGLYPH_PAIRS.map(([latin, look]) => [look, latin]));

/** 이 글에 호모글리프로 담을 수 있는 비트 수 = 바꿀 수 있는 글자 수 */
export function homoglyphCapacityBits(text: string): number {
  let count = 0;
  for (const character of text) {
    if (TO_HOMOGLYPH.has(character) || FROM_HOMOGLYPH.has(character)) count++;
  }
  return count;
}

export function homoglyphEmbed(text: string, payload: Uint8Array): string {
  const bits: number[] = [];
  for (const byte of payload) {
    for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1);
  }
  if (bits.length > homoglyphCapacityBits(text)) {
    throw new Error(
      `바꿀 수 있는 글자가 부족합니다. 필요 ${bits.length}자 / 가능 ${homoglyphCapacityBits(text)}자 (라틴 알파벳이 많은 글이 필요합니다)`,
    );
  }
  let cursor = 0;
  let output = '';
  for (const character of text) {
    // 이미 호모글리프인 문자는 원래 라틴 문자로 되돌려 놓고 다시 판단한다
    const latin = FROM_HOMOGLYPH.get(character) ?? character;
    const look = TO_HOMOGLYPH.get(latin);
    if (look && cursor < bits.length) {
      output += bits[cursor++] === 1 ? look : latin;
    } else if (look) {
      output += latin;
    } else {
      output += character;
    }
  }
  return output;
}

export function homoglyphExtract(text: string): Uint8Array {
  const bits: number[] = [];
  for (const character of text) {
    if (FROM_HOMOGLYPH.has(character)) bits.push(1);
    else if (TO_HOMOGLYPH.has(character)) bits.push(0);
  }
  const byteCount = Math.floor(bits.length / 8);
  const output = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | bits[i * 8 + bit];
    output[i] = byte;
  }
  return output;
}

/** 글에 섞인 호모글리프를 원래 라틴 문자로 되돌린다 (정상화) */
export function normalizeHomoglyphs(text: string): string {
  return [...text].map((character) => FROM_HOMOGLYPH.get(character) ?? character).join('');
}

export function countHomoglyphs(text: string): number {
  let count = 0;
  for (const character of text) {
    if (FROM_HOMOGLYPH.has(character)) count++;
  }
  return count;
}

// ---------- 공백 (줄 끝 스페이스/탭) ----------
//
// 스페이스=0, 탭=1로 비트를 표현해 줄 끝에 붙인다. 화면에는 아무것도 보이지 않는다.

const SPACE = ' ';
const TAB = '\t';

export function whitespaceEmbed(text: string, payload: Uint8Array): string {
  const bits: string[] = [];
  for (const byte of payload) {
    for (let bit = 7; bit >= 0; bit--) bits.push(((byte >> bit) & 1) === 1 ? TAB : SPACE);
  }
  const lines = text.split('\n');
  // 줄마다 균등 분배 — 줄이 하나면 그 줄 끝에 전부 붙는다
  const perLine = Math.ceil(bits.length / lines.length);
  let cursor = 0;
  const output = lines.map((line) => {
    const chunk = bits.slice(cursor, cursor + perLine).join('');
    cursor += perLine;
    // 기존 줄 끝 공백은 지워 비트가 섞이지 않게 한다
    return line.replace(/[ \t]+$/, '') + chunk;
  });
  return output.join('\n');
}

export function whitespaceExtract(text: string): Uint8Array {
  const bits: number[] = [];
  for (const line of text.split('\n')) {
    const trailing = line.match(/[ \t]+$/);
    if (!trailing) continue;
    for (const character of trailing[0]) bits.push(character === TAB ? 1 : 0);
  }
  const byteCount = Math.floor(bits.length / 8);
  const output = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | bits[i * 8 + bit];
    output[i] = byte;
  }
  return output;
}

export function countTrailingWhitespace(text: string): number {
  let count = 0;
  for (const line of text.split('\n')) {
    count += line.match(/[ \t]+$/)?.[0].length ?? 0;
  }
  return count;
}

export function stripTrailingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}
