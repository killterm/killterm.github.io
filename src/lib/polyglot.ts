// 폴리글랏(한 파일이 여러 형식으로 동시에 읽히는 파일) 생성·분석 유틸리티.
//
// 원리는 두 가지다.
//  1. 캐리어(앞에 놓이는 파일): 이미지·오디오·영상 형식은 헤더에 적힌 길이나 종료 마커까지만
//     읽고 그 뒤 바이트는 무시한다. 그래서 뒤에 무엇이 붙어도 원래대로 열린다.
//  2. 페이로드(뒤에 붙는 파일): 압축 형식은 파일 앞이 아니라 다른 곳을 기준으로 읽는다.
//     ZIP은 파일 끝의 EOCD를 찾아 거꾸로 읽고, RAR·7z은 파일 안에서 시그니처를 찾아 읽는다
//     (SFX 자동 압축 해제 파일이 동작하는 원리와 같다).
//
// ZIP만 예외적으로 손이 더 간다. ZIP이 기록하는 위치 값은 "파일 처음"을 기준으로 하므로 그냥
// 이어 붙이면 앞에 붙은 길이만큼 어긋난다. 압축 프로그램들이 대개 스스로 보정해 열어주지만
// 경고가 뜨므로, 여기서는 위치 값을 직접 고쳐 완전히 유효한 ZIP을 만든다.
// RAR·7z은 위치 값이 상대 기준이라 그대로 붙이면 된다.

const SIG_LOCAL = 0x04034b50; // PK\x03\x04
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02
const SIG_EOCD = 0x06054b50; // PK\x05\x06
const SIG_ZIP64_LOCATOR = 0x07064b50; // PK\x06\x07

const EOCD_SIZE = 22; // 주석 제외 고정 길이
const CENTRAL_SIZE = 46; // 이름·extra·주석 제외 고정 길이

const RAR_BASE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]; // "Rar!\x1A\x07"
const SEVENZIP_SIG = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]; // "7z\xBC\xAF'\x1C"

// ---------- 형식 정보 ----------

export type CarrierKind =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'tiff'
  | 'wav'
  | 'mp3'
  | 'mp4'
  | 'avi'
  | 'webm'
  | 'ogg'
  | 'flac'
  | 'pdf'
  | 'unknown';

export interface CarrierInfo {
  kind: CarrierKind;
  label: string;
  ext: string;
  /** 뒤에 데이터를 붙여도 원래 형식으로 계속 열리는지 */
  appendable: boolean;
  /** 형식상 데이터가 끝나는 위치(종료 마커 다음 바이트). 알 수 없으면 null */
  dataEnd: number | null;
}

export type PayloadKind = 'zip' | 'rar' | '7z' | 'gzip' | 'tar' | 'pdf' | 'unknown';

export interface PayloadInfo {
  kind: PayloadKind;
  label: string;
  ext: string;
  /** 뒤에 붙여도 해당 프로그램이 찾아낼 수 있는지 */
  appendable: boolean;
  /** 앞에 붙은 길이만큼 내부 위치 값을 고쳐야 하는 형식 (필요 없으면 null) */
  rebase: 'zip' | 'pdf' | null;
  /** ZIP 계열만 목록을 읽을 수 있다 */
  entries: ZipEntry[] | null;
  /** 사용자에게 알려줄 주의사항 */
  note: string | null;
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** 이 파일 안에서 로컬 헤더가 실제로 놓인 위치 */
  localOffset: number;
  directory: boolean;
}

export interface EmbeddedPayload {
  kind: PayloadKind;
  label: string;
  ext: string;
  /** 파일 안에서 페이로드가 시작되는 위치 */
  start: number;
  entries: ZipEntry[] | null;
}

export interface Analysis {
  size: number;
  carrier: CarrierInfo;
  payload: EmbeddedPayload | null;
  /** 캐리어 데이터 뒤에 붙어 있는 바이트 수. 알 수 없으면 null */
  trailing: number | null;
  /** PDF 캐리어일 때, 트레일러가 파일 끝 1KB 안에 있는지. PDF가 아니면 null */
  pdfTrailerOk: boolean | null;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function matchesAt(bytes: Uint8Array, sig: readonly number[], at: number): boolean {
  if (at < 0 || at + sig.length > bytes.length) return false;
  return sig.every((b, i) => bytes[at + i] === b);
}

const startsWith = (bytes: Uint8Array, sig: readonly number[]) => matchesAt(bytes, sig, 0);

function indexOfSeq(bytes: Uint8Array, seq: readonly number[], from = 0): number {
  for (let i = Math.max(0, from); i <= bytes.length - seq.length; i++) {
    if (matchesAt(bytes, seq, i)) return i;
  }
  return -1;
}

function lastIndexOfSeq(bytes: Uint8Array, seq: readonly number[]): number {
  for (let i = bytes.length - seq.length; i >= 0; i--) {
    if (matchesAt(bytes, seq, i)) return i;
  }
  return -1;
}

const ascii = (bytes: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...bytes.subarray(at, at + len));

// ---------- 캐리어 ----------

export function detectCarrier(bytes: Uint8Array): CarrierInfo {
  const dv = view(bytes);

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const eoi = lastIndexOfSeq(bytes, [0xff, 0xd9]);
    return carrier('jpeg', 'JPEG 이미지', 'jpg', true, eoi < 0 ? null : eoi + 2);
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    const iend = lastIndexOfSeq(bytes, [0x49, 0x45, 0x4e, 0x44]); // IEND
    return carrier('png', 'PNG 이미지', 'png', true, iend < 0 ? null : iend + 8); // +CRC 4바이트
  }

  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    // GIF는 0x3B로 끝난다. 데이터 안에도 나올 수 있는 값이라 마지막 바이트만 확인한다.
    return carrier(
      'gif',
      'GIF 이미지',
      'gif',
      true,
      bytes[bytes.length - 1] === 0x3b ? bytes.length : null,
    );
  }

  if (startsWith(bytes, [0x42, 0x4d]) && bytes.length >= 6) {
    // BMP 헤더의 파일 크기 필드까지만 읽는다
    const declared = dv.getUint32(2, true);
    return carrier('bmp', 'BMP 이미지', 'bmp', true, declared >= 6 && declared <= bytes.length ? declared : null);
  }

  // RIFF 계열: 헤더에 적힌 크기까지만 읽는다
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12) {
    const declared = 8 + dv.getUint32(4, true);
    const end = declared >= 12 && declared <= bytes.length ? declared : null;
    const form = ascii(bytes, 8, 4);
    if (form === 'WEBP') return carrier('webp', 'WebP 이미지', 'webp', true, end);
    if (form === 'WAVE') return carrier('wav', 'WAV 오디오', 'wav', true, end);
    if (form === 'AVI ') return carrier('avi', 'AVI 영상', 'avi', true, end);
  }

  // TIFF: 바이트 순서 표시 + 42
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return carrier('tiff', 'TIFF 이미지', 'tiff', true, null);
  }

  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return carrier('webm', 'WebM/MKV 영상', 'webm', true, null);
  }

  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) {
    return carrier('ogg', 'Ogg 오디오', 'ogg', true, null);
  }

  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) {
    return carrier('flac', 'FLAC 오디오', 'flac', true, null);
  }

  // MP4/MOV: ftyp 박스로 시작한다. 재생기는 박스 크기만큼만 읽는다.
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    return carrier('mp4', 'MP4 영상', 'mp4', true, null);
  }

  // MP3: ID3 태그 또는 프레임 싱크로 시작. 재생기는 뒤쪽 잡음을 무시한다.
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return carrier('mp3', 'MP3 오디오', 'mp3', true, null);
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    // PDF 리더는 파일 끝 1KB 안에서 startxref를 찾는다. 뒤에 큰 데이터가 붙으면 그 범위를
    // 벗어나므로, 붙인 뒤 트레일러를 파일 끝에 다시 선언해준다(makePolyglot 참고).
    const eof = indexOfSeq(bytes, [0x25, 0x25, 0x45, 0x4f, 0x46]); // %%EOF
    return carrier('pdf', 'PDF 문서', 'pdf', true, eof < 0 ? null : skipEol(bytes, eof + 5));
  }

  return carrier('unknown', '지원하지 않는 형식', 'bin', false, null);
}

/** %%EOF 뒤의 줄바꿈까지 데이터에 포함시킨다 (없는 데이터가 붙은 것처럼 보이지 않도록) */
function skipEol(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i < bytes.length && (bytes[i] === 0x0d || bytes[i] === 0x0a || bytes[i] === 0x20)) i++;
  return i;
}

function carrier(
  kind: CarrierKind,
  label: string,
  ext: string,
  appendable: boolean,
  dataEnd: number | null,
): CarrierInfo {
  return { kind, label, ext, appendable, dataEnd };
}

// ---------- 페이로드 ----------

/** 뒤에 붙일 파일이 어떤 형식인지, 붙여도 열리는지 판단한다 */
export function detectPayload(bytes: Uint8Array): PayloadInfo {
  const rar = rarVariant(bytes, 0);
  if (rar) {
    return {
      kind: 'rar',
      label: `RAR 압축 파일 (${rar})`,
      ext: 'rar',
      appendable: true,
      rebase: null,
      entries: null,
      note: '위치 보정 없이 그대로 붙입니다. WinRAR은 자동 압축 해제 파일을 위해 시그니처를 찾아 엽니다.',
    };
  }

  if (startsWith(bytes, SEVENZIP_SIG)) {
    return {
      kind: '7z',
      label: '7z 압축 파일',
      ext: '7z',
      appendable: true,
      rebase: null,
      entries: null,
      note: '위치 보정 없이 그대로 붙입니다. 확장자는 캐리어 그대로(.jpg 등) 두세요 — .7z로 바꾸면 7-Zip이 열지 못합니다.',
    };
  }

  if (startsWith(bytes, [0x1f, 0x8b])) {
    return {
      kind: 'gzip',
      label: 'gzip 압축 파일',
      ext: 'gz',
      appendable: false,
      rebase: null,
      entries: null,
      note: 'gzip은 파일 앞에서부터 순서대로 읽는 형식이라 뒤에 붙이면 열 수 없습니다.',
    };
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return {
      kind: 'pdf',
      label: 'PDF 문서',
      ext: 'pdf',
      appendable: true,
      rebase: 'pdf',
      entries: null,
      note: '캐리어가 1KB보다 크면 리더가 헤더를 못 찾아 "PDF가 아닐 수 있다"는 안내를 띄운 뒤 엽니다. poppler·Evince·Firefox는 열리지만 엄격한 리더는 거부할 수 있습니다.',
    };
  }

  // TAR: 오프셋 257에 "ustar" 매직
  if (bytes.length > 262 && ascii(bytes, 257, 5) === 'ustar') {
    return {
      kind: 'tar',
      label: 'TAR 묶음 파일',
      ext: 'tar',
      appendable: false,
      rebase: null,
      entries: null,
      note: 'TAR은 파일 앞에서부터 읽는 형식이라 뒤에 붙이면 열 수 없습니다.',
    };
  }

  const zip = readZip(bytes);
  if (zip) {
    return {
      kind: 'zip',
      label: zipFamilyLabel(zip.entries),
      ext: 'zip',
      appendable: true,
      rebase: 'zip',
      entries: zip.entries,
      note: null,
    };
  }

  return {
    kind: 'unknown',
    label: '지원하지 않는 형식',
    ext: 'bin',
    appendable: false,
    rebase: null,
    entries: null,
    note: '지원하지 않는 형식입니다. 뒤에 붙일 수 있는 것은 ZIP · RAR · 7z · PDF입니다.',
  };
}

function rarVariant(bytes: Uint8Array, at: number): 'RAR5' | 'RAR4' | null {
  if (!matchesAt(bytes, RAR_BASE, at)) return null;
  const next = bytes[at + RAR_BASE.length];
  if (next === 0x01 && bytes[at + RAR_BASE.length + 1] === 0x00) return 'RAR5';
  if (next === 0x00) return 'RAR4';
  return null;
}

/** ZIP을 컨테이너로 쓰는 형식들을 항목 이름으로 구분한다 */
function zipFamilyLabel(entries: ZipEntry[]): string {
  // 일부 도구가 경로 구분자로 역슬래시를 쓰므로 비교 전에 통일한다
  const paths = entries.map((e) => e.name.replace(/\\/g, '/'));
  const names = new Set(paths);
  const has = (name: string) => names.has(name);
  const hasPrefix = (prefix: string) => paths.some((p) => p.startsWith(prefix));

  if (has('AndroidManifest.xml')) return 'APK (ZIP 계열)';
  if (has('META-INF/container.xml') || has('mimetype')) return 'EPUB (ZIP 계열)';
  if (has('META-INF/MANIFEST.MF')) return 'JAR (ZIP 계열)';
  if (has('[Content_Types].xml')) {
    if (hasPrefix('word/')) return 'DOCX (ZIP 계열)';
    if (hasPrefix('xl/')) return 'XLSX (ZIP 계열)';
    if (hasPrefix('ppt/')) return 'PPTX (ZIP 계열)';
    return 'Office 문서 (ZIP 계열)';
  }
  return 'ZIP 압축 파일';
}

// ---------- ZIP 읽기 ----------

interface Eocd {
  offset: number;
  entries: number;
  cdSize: number;
  cdOffset: number;
}

/** 파일 끝에서 EOCD를 찾는다. ZIP이 아니면 null */
function findEocd(bytes: Uint8Array): Eocd | null {
  if (bytes.length < EOCD_SIZE) return null;
  const dv = view(bytes);
  const limit = Math.max(0, bytes.length - (0xffff + EOCD_SIZE)); // 주석 최대 길이까지만
  for (let i = bytes.length - EOCD_SIZE; i >= limit; i--) {
    if (dv.getUint32(i, true) !== SIG_EOCD) continue;
    // 주석 길이가 파일 끝과 맞아떨어져야 진짜 EOCD다 (압축 데이터 속 우연한 일치 배제)
    if (i + EOCD_SIZE + dv.getUint16(i + 20, true) !== bytes.length) continue;
    return {
      offset: i,
      entries: dv.getUint16(i + 10, true),
      cdSize: dv.getUint32(i + 12, true),
      cdOffset: dv.getUint32(i + 16, true),
    };
  }
  return null;
}

function isZip64(bytes: Uint8Array, eocd: Eocd): boolean {
  if (eocd.entries === 0xffff || eocd.cdSize === 0xffffffff || eocd.cdOffset === 0xffffffff) {
    return true;
  }
  return eocd.offset >= 20 && view(bytes).getUint32(eocd.offset - 20, true) === SIG_ZIP64_LOCATOR;
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  // 플래그가 없으면 압축한 도구의 로컬 인코딩이다. UTF-8로 읽히면 UTF-8로,
  // 아니면 한국어 윈도우에서 흔한 CP949(EUC-KR)로 해석한다.
  for (const encoding of ['utf-8', 'euc-kr']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      /* 다음 인코딩 시도 */
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 파일 끝에 있는 ZIP 구조를 읽는다. ZIP이 없으면 null.
 * 기록된 위치가 실제와 어긋나 있어도(=보정 안 된 폴리글랏) 실제 위치로 환산해 돌려준다.
 */
export function readZip(bytes: Uint8Array): { start: number; entries: ZipEntry[] } | null {
  const eocd = findEocd(bytes);
  if (!eocd) return null;

  const cdStart = eocd.offset - eocd.cdSize;
  if (cdStart < 0) return null;

  const dv = view(bytes);
  const shift = cdStart - eocd.cdOffset; // 기록된 위치에 더하면 실제 위치가 된다
  const entries: ZipEntry[] = [];
  let p = cdStart;

  for (let i = 0; i < eocd.entries; i++) {
    if (p + CENTRAL_SIZE > bytes.length || dv.getUint32(p, true) !== SIG_CENTRAL) break;
    const flags = dv.getUint16(p + 8, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const name = decodeName(
      bytes.subarray(p + CENTRAL_SIZE, p + CENTRAL_SIZE + nameLen),
      (flags & 0x0800) !== 0,
    );
    entries.push({
      name,
      method: dv.getUint16(p + 10, true),
      compressedSize: dv.getUint32(p + 20, true),
      uncompressedSize: dv.getUint32(p + 24, true),
      localOffset: dv.getUint32(p + 42, true) + shift,
      directory: name.endsWith('/'),
    });
    p += CENTRAL_SIZE + nameLen + extraLen + commentLen;
  }

  let start = cdStart;
  for (const e of entries) start = Math.min(start, e.localOffset);
  return { start, entries };
}

/**
 * zipBytes(끝이 ZIP인 바이트열)의 내부 위치 값을 보정한 사본을 만든다.
 * 결과는 앞에 prefixLen 바이트가 붙은 파일 안에서 유효한 ZIP이 된다.
 */
function rebaseZip(zipBytes: Uint8Array, prefixLen: number): Uint8Array {
  const eocd = findEocd(zipBytes);
  if (!eocd) {
    throw new Error('ZIP 파일이 아니거나 손상되었습니다. (파일 끝에서 ZIP 구조를 찾지 못함)');
  }
  if (isZip64(zipBytes, eocd)) {
    throw new Error('ZIP64 형식은 지원하지 않습니다. 4GB 미만으로 다시 압축해주세요.');
  }

  const cdStart = eocd.offset - eocd.cdSize;
  if (cdStart < 0) throw new Error('ZIP 중앙 디렉터리 크기가 파일 크기와 맞지 않습니다.');

  const out = new Uint8Array(zipBytes); // 원본을 건드리지 않도록 사본에 기록
  const dv = view(out);
  if (eocd.entries > 0 && dv.getUint32(cdStart, true) !== SIG_CENTRAL) {
    throw new Error('ZIP 중앙 디렉터리를 찾지 못했습니다.');
  }

  // 새 파일에서의 실제 위치 - 기록된 위치 = 모든 위치 값에 더할 값
  const delta = prefixLen + cdStart - eocd.cdOffset;

  let p = cdStart;
  for (let i = 0; i < eocd.entries; i++) {
    if (p + CENTRAL_SIZE > out.length || dv.getUint32(p, true) !== SIG_CENTRAL) {
      throw new Error(`${i + 1}번째 항목의 중앙 디렉터리 헤더가 손상되었습니다.`);
    }
    dv.setUint32(p + 42, dv.getUint32(p + 42, true) + delta, true);
    p +=
      CENTRAL_SIZE +
      dv.getUint16(p + 28, true) +
      dv.getUint16(p + 30, true) +
      dv.getUint16(p + 32, true);
  }
  dv.setUint32(eocd.offset + 16, eocd.cdOffset + delta, true);
  return out;
}

/** 보정한 위치 값이 실제 로컬 헤더를 가리키는지 확인한다 */
function verifyZip(bytes: Uint8Array): void {
  const info = readZip(bytes);
  if (!info) throw new Error('만든 파일에서 ZIP 구조를 다시 찾지 못했습니다.');
  const dv = view(bytes);
  for (const e of info.entries) {
    if (e.localOffset + 4 > bytes.length || dv.getUint32(e.localOffset, true) !== SIG_LOCAL) {
      throw new Error(`"${e.name}" 항목의 위치 보정이 어긋났습니다.`);
    }
  }
}

// ---------- PDF 트레일러 ----------

/** PDF 리더가 파일 끝에서 startxref를 찾는 범위 */
const PDF_TAIL_WINDOW = 1024;

/** PDF 끝의 startxref 값(교차 참조 표의 위치)을 읽는다 */
export function readPdfStartxref(bytes: Uint8Array): number | null {
  const from = Math.max(0, bytes.length - 2048);
  const tail = new TextDecoder('latin1').decode(bytes.subarray(from));
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : null;
}

/** 파일 끝 1KB 안에 startxref가 있는지 (PDF 리더가 경고 없이 열 수 있는 조건) */
export function hasPdfTrailerInWindow(bytes: Uint8Array): boolean {
  const from = Math.max(0, bytes.length - PDF_TAIL_WINDOW);
  return new TextDecoder('latin1').decode(bytes.subarray(from)).includes('startxref');
}

/**
 * PDF의 xref 오프셋을 delta만큼 옮긴 사본. 고전 xref 테이블만 다루고,
 * xref 스트림이나 여러 구역(/Prev)이 있으면 null을 돌려준다.
 *
 * 항목은 10자리 고정 폭이라 길이가 변하지 않고, 손대는 곳은 xref 표와 맨 끝
 * startxref 숫자뿐이다. 압축 스트림 바이트는 건드리지 않는다.
 */
function shiftPdfOffsets(
  pdf: Uint8Array,
  delta: number,
  /**
   * xref 표가 실제로 놓인 위치. 기본값은 startxref에 적힌 값이다.
   * 이미 보정된 PDF를 떼어낼 때는 적힌 값이 어긋나 있으므로 실제 위치를 넘겨야 한다.
   */
  tableAt?: number,
): Uint8Array | null {
  const recorded = readPdfStartxref(pdf);
  if (recorded === null) return null;
  const xrefPos = tableAt ?? recorded;
  if (xrefPos < 0 || xrefPos + 4 > pdf.length) return null;
  if (ascii(pdf, xrefPos, 4) !== 'xref') return null; // xref 스트림

  const trailerAt = indexOfSeq(pdf, [0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72], xrefPos);
  if (trailerAt < 0) return null;

  const startxrefAt = lastIndexOfSeq(
    pdf,
    [0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66], // startxref
  );
  if (startxrefAt < 0 || startxrefAt < trailerAt) return null;

  const trailerDict = ascii(pdf, trailerAt, startxrefAt - trailerAt);
  if (/\/(Prev|XRefStm)[\s/]/.test(trailerDict)) return null; // 여러 구역은 지원하지 않음

  // xref 표 영역만 다시 쓴다 ("0000000123 00000 n" 중 n 항목만, f 항목은 오프셋이 아니다)
  const table = ascii(pdf, xrefPos, trailerAt - xrefPos);
  const shifted = table.replace(/(\d{10})( \d{5} n)/g, (_all, off: string, rest: string) => {
    const next = Number(off) + delta;
    if (next < 0 || next > 9999999999) return off + rest;
    return String(next).padStart(10, '0') + rest;
  });
  if (shifted.length !== table.length) return null; // 길이가 바뀌면 오프셋이 어긋난다

  // 새 startxref 값 = 옮긴 뒤의 xref 표 위치
  const tail = new TextEncoder().encode(`startxref\n${recorded + delta}\n%%EOF\n`);
  const out = new Uint8Array(startxrefAt + tail.length);
  out.set(pdf.subarray(0, startxrefAt), 0); // 표·트레일러 포함 원본 그대로
  for (let i = 0; i < shifted.length; i++) out[xrefPos + i] = shifted.charCodeAt(i);
  out.set(tail, startxrefAt);
  return out;
}

/** xref가 실제 객체를 가리키는지 확인한다 (추출한 PDF가 단독으로 유효한지 판단용) */
function pdfXrefValid(pdf: Uint8Array): boolean {
  const xrefPos = readPdfStartxref(pdf);
  if (xrefPos === null || xrefPos < 0 || xrefPos + 4 > pdf.length) return false;
  if (ascii(pdf, xrefPos, 4) !== 'xref') return false;
  const trailerAt = indexOfSeq(pdf, [0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72], xrefPos);
  if (trailerAt < 0) return false;
  const table = ascii(pdf, xrefPos, trailerAt - xrefPos);
  const offsets = [...table.matchAll(/(\d{10}) \d{5} n/g)].map((m) => Number(m[1]));
  if (offsets.length === 0) return false;
  // 앞쪽 몇 개만 확인해도 어긋남은 드러난다
  return offsets.slice(0, 5).every((at) => {
    if (at <= 0 || at + 3 > pdf.length) return false;
    return /^\d+ \d+ obj/.test(ascii(pdf, at, Math.min(20, pdf.length - at)));
  });
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------- 생성·분석·추출 ----------

export interface PolyglotResult {
  bytes: Uint8Array;
  /** 추가로 처리한 내용을 사용자에게 알려줄 문구 */
  note: string | null;
}

/** 캐리어 뒤에 페이로드를 붙여 폴리글랏을 만든다 */
export function makePolyglot(
  carrierBytes: Uint8Array,
  payloadBytes: Uint8Array,
): PolyglotResult {
  const payload = detectPayload(payloadBytes);
  const prefix = carrierBytes.length;
  if (payload.rebase === 'zip' && prefix + payloadBytes.length > 0xffffffff) {
    throw new Error('합친 크기가 4GB를 넘어 ZIP 위치 값으로 표현할 수 없습니다.');
  }

  let extraNote: string | null = null;
  let tail = payloadBytes;
  if (payload.rebase === 'zip') {
    tail = rebaseZip(payloadBytes, prefix);
  } else if (payload.rebase === 'pdf') {
    // 캐리어가 1KB보다 작으면 리더가 헤더를 찾아 스스로 기준을 잡으므로 보정하면 오히려 어긋난다.
    // 1KB를 넘으면 리더가 절대 위치로 읽으므로 보정해야 xref를 읽을 수 있다.
    if (prefix >= PDF_TAIL_WINDOW) {
      const shifted = shiftPdfOffsets(payloadBytes, prefix);
      if (shifted) {
        tail = shifted;
        extraNote = 'PDF의 xref 위치를 보정했습니다.';
      } else {
        extraNote =
          'xref 스트림을 쓰는 PDF라 위치를 보정하지 못했습니다. 리더의 복구 기능에 의존합니다.';
      }
    } else {
      extraNote = '캐리어가 1KB보다 작아 위치 보정 없이 그대로 붙였습니다.';
    }
  }

  let out = concat(carrierBytes, tail);
  if (payload.rebase === 'zip') verifyZip(out);

  // PDF 캐리어는 뒤에 데이터가 붙으면 startxref가 파일 끝 1KB를 벗어나 리더가 복구 모드로
  // 열게 된다. 트레일러를 파일 끝에 다시 선언해 원래대로 열리게 만든다.
  let note: string | null = null;
  if (detectCarrier(carrierBytes).kind === 'pdf') {
    const xrefPos = readPdfStartxref(carrierBytes);
    if (xrefPos === null) {
      note = 'PDF에서 startxref를 찾지 못해 트레일러를 다시 선언하지 못했습니다.';
    } else {
      const trailer = new TextEncoder().encode(`\nstartxref\n${xrefPos}\n%%EOF\n`);
      const eocd = payload.kind === 'zip' ? findEocd(out) : null;
      if (payload.kind === 'zip' && eocd) {
        // ZIP은 EOCD가 파일 끝 근처에 있어야 하므로, 트레일러를 ZIP 주석 안에 넣는다
        const commentLen = out.length - (eocd.offset + EOCD_SIZE);
        if (commentLen + trailer.length <= 0xffff) {
          out = concat(out, trailer);
          view(out).setUint16(eocd.offset + 20, commentLen + trailer.length, true);
          verifyZip(out);
          note = 'PDF 트레일러를 ZIP 주석 안에 다시 선언했습니다.';
        } else {
          note = 'ZIP 주석 공간이 부족해 PDF 트레일러를 다시 선언하지 못했습니다.';
        }
      } else {
        out = concat(out, trailer);
        note = 'PDF 트레일러를 파일 끝에 다시 선언했습니다.';
      }
    }
  }

  return { bytes: out, note: [extraNote, note].filter(Boolean).join(' ') || null };
}

/** 파일 안에 붙어 있는 페이로드를 찾는다 */
export function findPayload(bytes: Uint8Array, searchFrom = 0): EmbeddedPayload | null {
  const zip = readZip(bytes);
  if (zip) {
    return {
      kind: 'zip',
      label: zipFamilyLabel(zip.entries),
      ext: 'zip',
      start: zip.start,
      entries: zip.entries,
    };
  }

  // RAR·7z·PDF는 시그니처 위치가 곧 시작 위치다. 캐리어 데이터 안의 우연한 일치를 피해
  // 캐리어가 끝나는 위치부터 찾고, 못 찾으면 파일 전체를 다시 훑는다.
  for (const from of searchFrom > 0 ? [searchFrom, 0] : [0]) {
    const rarAt = indexOfSeq(bytes, RAR_BASE, from);
    const variant = rarAt < 0 ? null : rarVariant(bytes, rarAt);
    if (variant) {
      return { kind: 'rar', label: `RAR 압축 파일 (${variant})`, ext: 'rar', start: rarAt, entries: null };
    }
    const sevenAt = indexOfSeq(bytes, SEVENZIP_SIG, from);
    if (sevenAt >= 0) {
      return { kind: '7z', label: '7z 압축 파일', ext: '7z', start: sevenAt, entries: null };
    }
    // PDF 헤더는 0번지에 있으면 캐리어 자신이므로 뒤쪽에 있는 것만 페이로드로 본다
    const pdfAt = indexOfSeq(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d], Math.max(from, 1));
    if (pdfAt > 0) {
      return { kind: 'pdf', label: 'PDF 문서', ext: 'pdf', start: pdfAt, entries: null };
    }
  }
  return null;
}

export function analyze(bytes: Uint8Array): Analysis {
  const carrierInfo = detectCarrier(bytes);
  let payload: EmbeddedPayload | null = null;
  try {
    payload = findPayload(bytes, carrierInfo.dataEnd ?? 0);
  } catch {
    payload = null;
  }
  return {
    size: bytes.length,
    carrier: carrierInfo,
    payload,
    trailing: carrierInfo.dataEnd === null ? null : bytes.length - carrierInfo.dataEnd,
    pdfTrailerOk: carrierInfo.kind === 'pdf' ? hasPdfTrailerInWindow(bytes) : null,
  };
}

/** 폴리글랏에서 페이로드만 떼어내 단독으로 열리는 파일로 만든다 */
export function extractPayload(bytes: Uint8Array): { bytes: Uint8Array; ext: string } {
  const payload = findPayload(bytes, detectCarrier(bytes).dataEnd ?? 0);
  if (!payload) throw new Error('이 파일에서 붙어 있는 파일을 찾을 수 없습니다.');
  const sliced = bytes.slice(payload.start);

  // ZIP은 위치 값이 파일 처음 기준이므로 떼어낼 때도 다시 보정해야 한다
  if (payload.kind === 'zip') return { bytes: rebaseZip(sliced, 0), ext: payload.ext };

  // PDF는 붙일 때 보정했을 수도, 안 했을 수도 있다. 유효한 쪽을 골라 쓴다.
  if (payload.kind === 'pdf' && !pdfXrefValid(sliced)) {
    const recorded = readPdfStartxref(sliced);
    // 보정된 PDF라면 표는 (적힌 값 - 떼어낸 길이) 위치에 있다
    const shifted =
      recorded === null
        ? null
        : shiftPdfOffsets(sliced, -payload.start, recorded - payload.start);
    if (shifted && pdfXrefValid(shifted)) return { bytes: shifted, ext: payload.ext };
  }
  return { bytes: sliced, ext: payload.ext };
}

export function methodLabel(method: number): string {
  if (method === 0) return '저장';
  if (method === 8) return 'Deflate';
  if (method === 12) return 'BZip2';
  if (method === 14) return 'LZMA';
  if (method === 93) return 'Zstd';
  return `방식 ${method}`;
}
