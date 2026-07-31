// 메타데이터 스테가노그래피 — 픽셀을 건드리지 않고 파일 구조의 빈 자리에 넣는다.
//
// PNG는 청크 목록 구조라 IEND 앞에 청크를 끼워 넣으면 되고, JPEG는 COM(주석)
// 세그먼트를 지원한다. 어느 쪽이든 **이미지 데이터는 재인코딩되지 않아** 화질이
// 그대로 유지되는 것이 LSB·DCT와의 결정적 차이다. 대신 exiftool 같은 도구가
// 즉시 찾아낸다.

import { frameMessage, parseFrame, type StegPayload } from './steganography-frame.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 사설 청크 타입. PNG 규칙: 1번째 바이트 소문자 = ancillary(없어도 표시 가능),
 * 2번째 소문자 = private(비표준), 3번째는 대문자여야 하고, 4번째 소문자 =
 * safe-to-copy(편집기가 몰라도 보존).
 */
const PRIVATE_CHUNK = 'stEg';
/** 표준 텍스트 청크 — UTF-8을 담을 수 있어 한글이 들어간다 */
const TEXT_CHUNK = 'iTXt';
const TEXT_KEYWORD = 'Comment';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type CarrierFormat = 'png' | 'jpeg';

export function detectFormat(bytes: Uint8Array): CarrierFormat {
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  throw new Error('PNG 또는 JPEG 파일만 지원합니다.');
}

// ---------- PNG ----------

interface PngChunk {
  type: string;
  /** 청크 전체(길이+타입+데이터+CRC)의 시작 위치 */
  start: number;
  /** 데이터 부분 */
  data: Uint8Array;
  /** 청크 전체 길이 */
  totalLength: number;
}

function readPngChunks(bytes: Uint8Array): PngChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = view.getUint32(cursor);
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (cursor + 12 + length > bytes.length) break;
    chunks.push({
      type,
      start: cursor,
      data: bytes.subarray(cursor + 8, cursor + 8 + length),
      totalLength: length + 12,
    });
    cursor += length + 12;
    if (type === 'IEND') break;
  }
  return chunks;
}

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** iTXt 청크 본문: keyword\0 compressionFlag compressionMethod language\0 translated\0 text */
function buildTextChunkData(text: string): Uint8Array {
  const keyword = new TextEncoder().encode(TEXT_KEYWORD);
  const value = new TextEncoder().encode(text);
  const data = new Uint8Array(keyword.length + 5 + value.length);
  data.set(keyword, 0);
  let cursor = keyword.length;
  data[cursor++] = 0; // keyword 종료
  data[cursor++] = 0; // 압축 안 함
  data[cursor++] = 0; // 압축 방식
  data[cursor++] = 0; // language tag 없음
  data[cursor++] = 0; // translated keyword 없음
  data.set(value, cursor);
  return data;
}

function parseTextChunkData(data: Uint8Array): string | null {
  const nul = data.indexOf(0);
  if (nul < 0) return null;
  const keyword = new TextDecoder().decode(data.subarray(0, nul));
  if (keyword !== TEXT_KEYWORD) return null;
  // compressionFlag(1) + method(1) 뒤에 language\0 translated\0 가 온다
  if (data[nul + 1] !== 0) return null; // 압축된 iTXt는 지원하지 않는다
  let cursor = nul + 3;
  let remainingTerminators = 2;
  while (cursor < data.length && remainingTerminators > 0) {
    if (data[cursor] === 0) remainingTerminators--;
    cursor++;
  }
  return new TextDecoder().decode(data.subarray(cursor));
}

// ---------- JPEG ----------

/** COM 세그먼트 하나에 들어갈 수 있는 최대 바이트 (길이 필드가 2바이트) */
const MAX_COMMENT_BYTES = 65533;

function jpegInsertComments(bytes: Uint8Array, payload: Uint8Array): Uint8Array {
  // SOI(2바이트) 바로 뒤에 COM 세그먼트들을 끼워 넣는다
  const segments: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += MAX_COMMENT_BYTES) {
    const slice = payload.subarray(offset, offset + MAX_COMMENT_BYTES);
    const segment = new Uint8Array(slice.length + 4);
    segment[0] = 0xff;
    segment[1] = 0xfe; // COM
    segment[2] = ((slice.length + 2) >> 8) & 0xff;
    segment[3] = (slice.length + 2) & 0xff;
    segment.set(slice, 4);
    segments.push(segment);
  }
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  const output = new Uint8Array(bytes.length + total);
  output.set(bytes.subarray(0, 2), 0);
  let cursor = 2;
  for (const segment of segments) {
    output.set(segment, cursor);
    cursor += segment.length;
  }
  output.set(bytes.subarray(2), cursor);
  return output;
}

function jpegReadComments(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0xff) break;
    const marker = bytes[cursor + 1];
    // SOS(0xda) 이후는 엔트로피 데이터라 세그먼트 순회를 멈춘다
    if (marker === 0xda) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      cursor += 2;
      continue;
    }
    const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    if (marker === 0xfe) parts.push(bytes.subarray(cursor + 4, cursor + 2 + length));
    cursor += 2 + length;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

// ---------- 공개 API ----------

/**
 * 이미지 바이트에 페이로드를 메타데이터로 심는다. 이미지 데이터는 그대로 복사되며
 * 재인코딩되지 않는다.
 */
export function metadataEmbed(bytes: Uint8Array, payload: StegPayload): Uint8Array {
  const format = detectFormat(bytes);
  const frame = frameMessage(payload);
  if (format === 'jpeg') return jpegInsertComments(bytes, frame);

  const chunks = readPngChunks(bytes);
  const iend = chunks.find((chunk) => chunk.type === 'IEND');
  if (!iend) throw new Error('PNG 구조가 올바르지 않습니다 (IEND 없음).');
  // 텍스트는 표준 iTXt(다른 도구에서도 읽힘), 파일은 사설 청크에 원본 바이트로
  const inserted =
    payload.kind === 'text'
      ? buildPngChunk(TEXT_CHUNK, buildTextChunkData(new TextDecoder().decode(payload.data)))
      : buildPngChunk(PRIVATE_CHUNK, frame);
  const output = new Uint8Array(bytes.length + inserted.length);
  output.set(bytes.subarray(0, iend.start), 0);
  output.set(inserted, iend.start);
  output.set(bytes.subarray(iend.start), iend.start + inserted.length);
  return output;
}

/** 메타데이터에서 페이로드를 꺼낸다. 없으면 null. */
export function metadataExtract(bytes: Uint8Array): StegPayload | null {
  const format = detectFormat(bytes);
  if (format === 'jpeg') {
    const comments = jpegReadComments(bytes);
    return comments.length > 0 ? parseFrame(comments) : null;
  }
  for (const chunk of readPngChunks(bytes)) {
    if (chunk.type === PRIVATE_CHUNK) {
      const payload = parseFrame(chunk.data);
      if (payload) return payload;
    }
    if (chunk.type === TEXT_CHUNK) {
      const text = parseTextChunkData(chunk.data);
      if (text !== null) {
        return { kind: 'text', name: '', data: new TextEncoder().encode(text) };
      }
    }
  }
  return null;
}

export interface MetadataEntry {
  label: string;
  detail: string;
}

/** 파일에 어떤 메타데이터 항목이 들어 있는지 목록으로 보여준다 (탐지용) */
export function listMetadata(bytes: Uint8Array): MetadataEntry[] {
  const format = detectFormat(bytes);
  const entries: MetadataEntry[] = [];
  if (format === 'png') {
    for (const chunk of readPngChunks(bytes)) {
      if (['IHDR', 'IDAT', 'IEND', 'PLTE'].includes(chunk.type)) continue;
      entries.push({
        label: chunk.type,
        detail:
          chunk.type === PRIVATE_CHUNK
            ? `사설 청크 · ${chunk.data.length.toLocaleString()}바이트 (이 도구가 심은 데이터)`
            : `${chunk.data.length.toLocaleString()}바이트`,
      });
    }
    return entries;
  }
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 0xff) break;
    const marker = bytes[cursor + 1];
    if (marker === 0xda) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      cursor += 2;
      continue;
    }
    const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    const names: Record<number, string> = {
      0xfe: 'COM (주석)',
      0xe0: 'APP0 (JFIF)',
      0xe1: 'APP1 (EXIF/XMP)',
      0xe2: 'APP2',
      0xed: 'APP13 (IPTC)',
      0xee: 'APP14',
    };
    if (marker === 0xfe || (marker >= 0xe0 && marker <= 0xef)) {
      entries.push({
        label: names[marker] ?? `APP${marker - 0xe0}`,
        detail: `${(length - 2).toLocaleString()}바이트`,
      });
    }
    cursor += 2 + length;
  }
  return entries;
}
