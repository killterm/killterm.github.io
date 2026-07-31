// 헥스 편집기의 순수 로직 — 바이트 분류(색상 기준) · xxd 형식 덤프 · 검색 ·
// 엔트로피 · 편집 연산 · 값 해석기.
//
// DOM에 의존하지 않아 Node로 직접 검증한다.

// ---------- 바이트 분류 (색상의 기준) ----------
//
// xxd -R가 쓰는 것과 같은 갈래로 나눈다. 이렇게만 칠해도 헤더·문자열·패딩·
// 압축 구간이 눈으로 구분된다.

export type ByteCategory = 'null' | 'printable' | 'whitespace' | 'ff' | 'other';

export function byteCategory(byte: number): ByteCategory {
  if (byte === 0x00) return 'null';
  if (byte === 0xff) return 'ff';
  // 눈에 보이는 ASCII (공백 제외)
  if (byte >= 0x21 && byte <= 0x7e) return 'printable';
  // 공백류: tab · LF · VT · FF · CR · space
  if (byte === 0x20 || (byte >= 0x09 && byte <= 0x0d)) return 'whitespace';
  return 'other';
}

/** ASCII 칸 표기 — 볼 수 없는 바이트는 xxd와 같이 마침표로 */
export function asciiChar(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
}

export const toHex = (byte: number, upper = false): string => {
  const text = byte.toString(16).padStart(2, '0');
  return upper ? text.toUpperCase() : text;
};

export function formatOffset(offset: number, upper = false): string {
  const text = offset.toString(16).padStart(8, '0');
  return upper ? text.toUpperCase() : text;
}

// ---------- xxd 형식 덤프 ----------

export interface DumpOptions {
  bytesPerRow?: number;
  /** 헥스를 몇 바이트씩 붙여 쓸지 (xxd 기본 2) */
  groupSize?: number;
  upper?: boolean;
  /** 오프셋 표기의 시작값 */
  baseOffset?: number;
}

/**
 * xxd 기본 출력과 같은 모양의 문자열을 만든다.
 * `00000000: 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR`
 */
export function formatHexDump(bytes: Uint8Array, options: DumpOptions = {}): string {
  const bytesPerRow = options.bytesPerRow ?? 16;
  const groupSize = options.groupSize ?? 2;
  const upper = options.upper ?? false;
  const baseOffset = options.baseOffset ?? 0;

  const lines: string[] = [];
  for (let start = 0; start < bytes.length; start += bytesPerRow) {
    const row = bytes.subarray(start, start + bytesPerRow);
    let hex = '';
    for (let i = 0; i < bytesPerRow; i++) {
      hex += i < row.length ? toHex(row[i], upper) : '  ';
      // 묶음 끝마다 공백 (마지막 묶음 뒤에는 붙이지 않는다)
      if ((i + 1) % groupSize === 0 && i + 1 < bytesPerRow) hex += ' ';
    }
    let ascii = '';
    for (const byte of row) ascii += asciiChar(byte);
    lines.push(`${formatOffset(baseOffset + start, upper)}: ${hex}  ${ascii}`);
  }
  return lines.join('\n');
}

// ---------- 헥스 텍스트 읽기 ----------

/**
 * 붙여넣은 헥스 텍스트에서 바이트를 복원한다.
 * 공백·줄바꿈·`0x` 접두사·쉼표를 허용하고, xxd 덤프를 그대로 붙여넣어도
 * (오프셋 칸과 ASCII 칸을 걷어내고) 읽는다. 헥스 숫자가 없으면 null.
 */
export function parseHexText(text: string): Uint8Array | null {
  const digits: string[] = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine;
    // xxd 덤프 형태: "00000000: 8950 4e47 ...  .PNG"
    const dumpMatch = line.match(/^\s*[0-9a-fA-F]{4,16}:\s(.*)$/);
    if (dumpMatch) {
      line = dumpMatch[1];
      // ASCII 칸은 두 칸 이상 띄워 붙으므로 그 앞까지만 쓴다
      const separator = line.indexOf('  ');
      if (separator >= 0) line = line.slice(0, separator);
    }
    for (const token of line.split(/[\s,]+/)) {
      const cleaned = token.startsWith('0x') || token.startsWith('0X') ? token.slice(2) : token;
      if (cleaned === '') continue;
      if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
      digits.push(cleaned);
    }
  }
  const joined = digits.join('');
  if (joined.length === 0 || joined.length % 2 !== 0) return null;
  const bytes = new Uint8Array(joined.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(joined.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 검색어를 바이트 배열로 바꾼다. 형식이 틀리면 null. */
export function parseQuery(text: string, mode: 'hex' | 'text'): Uint8Array | null {
  if (text === '') return null;
  if (mode === 'text') return new TextEncoder().encode(text);
  return parseHexText(text);
}

// ---------- 검색 ----------

export function findBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  const last = haystack.length - needle.length;
  for (let start = Math.max(0, from); start <= last; start++) {
    let matched = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

/** 겹치는 일치도 모두 센다 (상한을 두어 거대한 파일에서 멈추지 않게 한다) */
export function findAllBytes(haystack: Uint8Array, needle: Uint8Array, limit = 10000): number[] {
  const results: number[] = [];
  let cursor = 0;
  while (results.length < limit) {
    const found = findBytes(haystack, needle, cursor);
    if (found < 0) break;
    results.push(found);
    cursor = found + 1;
  }
  return results;
}

export function findBytesBackward(haystack: Uint8Array, needle: Uint8Array, before: number): number {
  for (let start = Math.min(before, haystack.length - needle.length); start >= 0; start--) {
    let matched = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

// ---------- 엔트로피 ----------

/**
 * 구간의 섀넌 엔트로피를 0~1로 정규화해 돌려준다(최대 8비트 기준).
 * 압축·암호화된 구간은 1에 가깝고, 같은 값이 이어지는 패딩은 0이다.
 */
export function shannonEntropy(bytes: Uint8Array, start = 0, length = bytes.length - start): number {
  const end = Math.min(bytes.length, start + length);
  const count = end - start;
  if (count <= 0) return 0;
  const histogram = new Uint32Array(256);
  for (let i = start; i < end; i++) histogram[bytes[i]]++;
  let entropy = 0;
  for (const occurrences of histogram) {
    if (occurrences === 0) continue;
    const probability = occurrences / count;
    entropy -= probability * Math.log2(probability);
  }
  return entropy / 8;
}

// ---------- 편집 연산 ----------
//
// 각 연산은 결과 배열과 **역연산**을 함께 돌려준다. 실행취소 스택에 역연산만
// 쌓으면 되므로 파일 전체를 스냅숏으로 복제하지 않아도 된다.

export type EditOperation =
  | { type: 'overwrite'; offset: number; bytes: Uint8Array }
  | { type: 'insert'; offset: number; bytes: Uint8Array }
  | { type: 'delete'; offset: number; length: number };

export interface EditResult {
  bytes: Uint8Array;
  inverse: EditOperation;
}

export function applyEdit(bytes: Uint8Array, operation: EditOperation): EditResult {
  if (operation.type === 'overwrite') {
    const end = Math.min(bytes.length, operation.offset + operation.bytes.length);
    const previous = bytes.slice(operation.offset, end);
    const output = Uint8Array.from(bytes);
    output.set(operation.bytes.subarray(0, end - operation.offset), operation.offset);
    return {
      bytes: output,
      inverse: { type: 'overwrite', offset: operation.offset, bytes: previous },
    };
  }
  if (operation.type === 'insert') {
    const output = new Uint8Array(bytes.length + operation.bytes.length);
    output.set(bytes.subarray(0, operation.offset), 0);
    output.set(operation.bytes, operation.offset);
    output.set(bytes.subarray(operation.offset), operation.offset + operation.bytes.length);
    return {
      bytes: output,
      inverse: { type: 'delete', offset: operation.offset, length: operation.bytes.length },
    };
  }
  const end = Math.min(bytes.length, operation.offset + operation.length);
  const removed = bytes.slice(operation.offset, end);
  const output = new Uint8Array(bytes.length - removed.length);
  output.set(bytes.subarray(0, operation.offset), 0);
  output.set(bytes.subarray(end), operation.offset);
  return {
    bytes: output,
    inverse: { type: 'insert', offset: operation.offset, bytes: removed },
  };
}

// ---------- 값 해석기 ----------

export interface ByteInterpretation {
  label: string;
  value: string;
}

/** 커서 위치의 바이트를 여러 자료형으로 읽어 준다 */
export function interpretAt(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): ByteInterpretation[] {
  if (offset < 0 || offset >= bytes.length) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows: ByteInterpretation[] = [];
  const remaining = bytes.length - offset;

  const add = (label: string, read: () => number, size: number, fractionDigits?: number) => {
    if (remaining < size) return;
    const value = read();
    rows.push({
      label,
      value: fractionDigits === undefined ? String(value) : formatFloat(value),
    });
  };

  add('int8', () => view.getInt8(offset), 1);
  add('uint8', () => view.getUint8(offset), 1);
  add('int16', () => view.getInt16(offset, littleEndian), 2);
  add('uint16', () => view.getUint16(offset, littleEndian), 2);
  add('int32', () => view.getInt32(offset, littleEndian), 4);
  add('uint32', () => view.getUint32(offset, littleEndian), 4);
  add('float32', () => view.getFloat32(offset, littleEndian), 4, 6);
  add('float64', () => view.getFloat64(offset, littleEndian), 8, 6);

  rows.push({ label: '2진수', value: bytes[offset].toString(2).padStart(8, '0') });
  rows.push({ label: '문자', value: describeChar(bytes, offset) });
  return rows;
}

function formatFloat(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value !== 0 && (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e10)) {
    return value.toExponential(6);
  }
  return String(Number(value.toFixed(6)));
}

/** 해당 위치에서 시작하는 UTF-8 글자(가능하면) 또는 ASCII 표기 */
function describeChar(bytes: Uint8Array, offset: number): string {
  const byte = bytes[offset];
  if (byte >= 0x20 && byte <= 0x7e) return `'${String.fromCharCode(byte)}'`;
  const CONTROL_NAMES: Record<number, string> = {
    0x00: 'NUL',
    0x07: 'BEL',
    0x08: 'BS',
    0x09: 'TAB',
    0x0a: 'LF',
    0x0d: 'CR',
    0x1b: 'ESC',
    0x7f: 'DEL',
  };
  if (CONTROL_NAMES[byte]) return CONTROL_NAMES[byte];
  if (byte >= 0xc2) {
    // UTF-8 선두 바이트면 이어지는 바이트까지 묶어 해독을 시도한다
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
    if (offset + length <= bytes.length) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(offset, offset + length),
        );
        return `'${text}' (UTF-8 ${length}바이트)`;
      } catch {
        // 유효한 UTF-8이 아니면 아래로
      }
    }
  }
  return '표시 불가';
}
