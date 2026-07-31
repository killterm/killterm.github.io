// 스테가노그래피 공용 로직 — 페이로드 프레임, LSB 읽기/쓰기, WAV 청크.
// (글 속에 숨기는 기법은 steganography-text.ts에 따로 있다)
//
// AudioContext·canvas·DOM에 의존하지 않는 순수 함수라 Node로 직접 검증한다.
// .ts 확장자를 명시하면 Vite뿐 아니라 Node(type stripping)로도 실행 가능하다.

// ---------- 페이로드 프레임 ----------
//
// 숨긴 데이터는 자기 기술적(self-describing) 프레임으로 감싼다. 추출할 때
// magic·버전·길이를 검증할 수 있어야 "쓰레기 비트"와 "실제 숨긴 데이터"를
// 구분할 수 있고, 분석 탭이 같은 함수로 탐지까지 할 수 있다.
//
//   magic "KSTG"(4) | version(1) | kind(1) | nameLen(1) | name(UTF-8) |
//   dataLen(4, big-endian) | data

const MAGIC = [0x4b, 0x53, 0x54, 0x47]; // "KSTG"
const VERSION = 1;
/** magic + version + kind + nameLen + dataLen */
const FIXED_HEADER_SIZE = 11;

export type PayloadKind = 'text' | 'file';

export interface StegPayload {
  kind: PayloadKind;
  /** 파일이면 파일명, 텍스트면 빈 문자열 */
  name: string;
  data: Uint8Array;
}

export function frameMessage(payload: StegPayload): Uint8Array {
  const nameBytes = new TextEncoder().encode(payload.name);
  if (nameBytes.length > 255) throw new Error('파일 이름이 너무 깁니다 (255바이트 초과).');
  const frame = new Uint8Array(FIXED_HEADER_SIZE + nameBytes.length + payload.data.length);
  frame.set(MAGIC, 0);
  frame[4] = VERSION;
  frame[5] = payload.kind === 'file' ? 1 : 0;
  frame[6] = nameBytes.length;
  frame.set(nameBytes, 7);
  const dataStart = 7 + nameBytes.length;
  const length = payload.data.length;
  frame[dataStart] = (length >>> 24) & 0xff;
  frame[dataStart + 1] = (length >>> 16) & 0xff;
  frame[dataStart + 2] = (length >>> 8) & 0xff;
  frame[dataStart + 3] = length & 0xff;
  frame.set(payload.data, dataStart + 4);
  return frame;
}

/** 프레임 앞부분만 보고 전체 길이를 알아낸다 (2단계 읽기용). 형식이 아니면 null. */
export function peekFrameSize(header: Uint8Array): number | null {
  if (header.length < FIXED_HEADER_SIZE) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (header[i] !== MAGIC[i]) return null;
  }
  if (header[4] !== VERSION) return null;
  if (header[5] !== 0 && header[5] !== 1) return null;
  const nameLength = header[6];
  const dataStart = 7 + nameLength;
  // dataLen 4바이트가 헤더 안에 들어오지 않으면 지금은 판단할 수 없다
  if (header.length < dataStart + 4) return null;
  const dataLength =
    (header[dataStart] << 24) |
    (header[dataStart + 1] << 16) |
    (header[dataStart + 2] << 8) |
    header[dataStart + 3];
  if (dataLength < 0) return null;
  return FIXED_HEADER_SIZE + nameLength + dataLength;
}

export function parseFrame(frame: Uint8Array): StegPayload | null {
  const size = peekFrameSize(frame);
  if (size === null || frame.length < size) return null;
  const nameLength = frame[6];
  const dataStart = 7 + nameLength;
  const dataLength = size - FIXED_HEADER_SIZE - nameLength;
  return {
    kind: frame[5] === 1 ? 'file' : 'text',
    name: new TextDecoder().decode(frame.subarray(7, 7 + nameLength)),
    data: frame.slice(dataStart + 4, dataStart + 4 + dataLength),
  };
}

/** 프레임을 감싸는 데 드는 추가 바이트 (용량 표시용) */
export function frameOverhead(name: string): number {
  return FIXED_HEADER_SIZE + new TextEncoder().encode(name).length;
}

// ---------- LSB 읽기 · 쓰기 ----------
//
// 컨테이너(이미지 픽셀 바이트 / 오디오 샘플)와 "쓸 수 있는 슬롯 인덱스 목록"을
// 분리해 일반화한다. 이미지는 알파를 제외한 RGB 인덱스, 오디오는 전체 샘플
// 인덱스를 넘긴다. 한 슬롯에 1비트씩만 쓴다(변화가 가장 작다).

type LsbContainer = Uint8Array | Int16Array | Uint8ClampedArray;

export function capacityBytes(slotCount: number): number {
  return Math.floor(slotCount / 8);
}

export function lsbWrite(
  container: LsbContainer,
  indices: ArrayLike<number>,
  payload: Uint8Array,
): void {
  const neededSlots = payload.length * 8;
  if (neededSlots > indices.length) {
    throw new Error(
      `용량이 부족합니다. 필요 ${payload.length.toLocaleString()}바이트 / 가능 ${capacityBytes(indices.length).toLocaleString()}바이트`,
    );
  }
  let slot = 0;
  for (const byte of payload) {
    for (let bit = 7; bit >= 0; bit--) {
      const index = indices[slot++];
      const value = container[index];
      container[index] = (value & ~1) | ((byte >> bit) & 1);
    }
  }
}

export function lsbRead(
  container: LsbContainer,
  indices: ArrayLike<number>,
  byteCount: number,
): Uint8Array {
  const available = capacityBytes(indices.length);
  const output = new Uint8Array(Math.min(byteCount, available));
  let slot = 0;
  for (let i = 0; i < output.length; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      byte = (byte << 1) | (container[indices[slot++]] & 1);
    }
    output[i] = byte;
  }
  return output;
}

/**
 * LSB에서 프레임을 찾아 복원한다. 헤더를 먼저 읽어 전체 길이를 알아낸 뒤
 * 필요한 만큼만 다시 읽는다 (큰 캐리어에서 전체를 읽지 않기 위해).
 * 숨긴 데이터가 없으면 null.
 */
export function readFrameFrom(
  container: LsbContainer,
  indices: ArrayLike<number>,
): StegPayload | null {
  // nameLen 최대 255 + 고정 헤더까지 넉넉히 읽어 dataLen을 확보한다
  const header = lsbRead(container, indices, Math.min(FIXED_HEADER_SIZE + 255, capacityBytes(indices.length)));
  const size = peekFrameSize(header);
  if (size === null) return null;
  if (size > capacityBytes(indices.length)) return null;
  return parseFrame(lsbRead(container, indices, size));
}

/** 이미지 픽셀 배열(RGBA)에서 알파를 제외한 인덱스 — 투명 영역 변화가 눈에 띄므로 건드리지 않는다 */
export function rgbIndices(pixelByteLength: number): Uint32Array {
  const count = Math.floor(pixelByteLength / 4) * 3;
  const indices = new Uint32Array(count);
  let cursor = 0;
  for (let i = 0; i < pixelByteLength; i++) {
    if (i % 4 !== 3) indices[cursor++] = i;
  }
  return indices.subarray(0, cursor) as Uint32Array;
}

/** 0..count-1 연속 인덱스 (오디오 샘플 등) */
export function sequentialIndices(count: number): Uint32Array {
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return indices;
}

/** 채널별 LSB가 1인 비율 — 자연 이미지는 0.5 근처, 숨긴 데이터가 있으면 더 균일해진다 */
export function lsbOneRatio(container: LsbContainer, indices: ArrayLike<number>): number {
  if (indices.length === 0) return 0;
  let ones = 0;
  for (let i = 0; i < indices.length; i++) {
    ones += container[indices[i]] & 1;
  }
  return ones / indices.length;
}

// ---------- WAV ----------

export interface WavDataChunk {
  /** data 청크의 첫 바이트 위치 */
  offset: number;
  /** data 청크 크기(바이트) */
  size: number;
  bitsPerSample: number;
  channels: number;
  sampleRate: number;
}

/**
 * WAV(RIFF)에서 fmt 정보와 data 청크 위치를 찾는다.
 * 원본 바이트를 그대로 두고 data 영역의 LSB만 패치하기 위한 것이라
 * 재인코딩이 없고 다른 청크(메타데이터 등)도 보존된다.
 */
export function findWavDataChunk(bytes: Uint8Array): WavDataChunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error('WAV(RIFF) 파일이 아닙니다.');
  }
  let cursor = 12;
  let format: { bitsPerSample: number; channels: number; sampleRate: number } | null = null;
  while (cursor + 8 <= bytes.length) {
    const chunkId = ascii(cursor, 4);
    const chunkSize = view.getUint32(cursor + 4, true);
    const bodyStart = cursor + 8;
    if (chunkId === 'fmt ' && bodyStart + 16 <= bytes.length) {
      format = {
        channels: view.getUint16(bodyStart + 2, true),
        sampleRate: view.getUint32(bodyStart + 4, true),
        bitsPerSample: view.getUint16(bodyStart + 14, true),
      };
    } else if (chunkId === 'data') {
      if (!format) throw new Error('fmt 청크를 찾을 수 없습니다.');
      if (format.bitsPerSample !== 16) {
        throw new Error(`16-bit PCM만 지원합니다 (이 파일은 ${format.bitsPerSample}-bit).`);
      }
      // 헤더의 크기가 실제보다 클 수 있으므로 파일 끝으로 자른다
      const size = Math.min(chunkSize, bytes.length - bodyStart);
      return { offset: bodyStart, size: size - (size % 2), ...format };
    }
    // 청크는 2바이트 정렬 (홀수 크기면 패딩 1바이트)
    cursor = bodyStart + chunkSize + (chunkSize % 2);
  }
  throw new Error('data 청크를 찾을 수 없습니다.');
}

/** data 청크를 16-bit 샘플 뷰로 감싼다 (원본 바이트를 그대로 가리킨다) */
export function wavSampleView(bytes: Uint8Array, chunk: WavDataChunk): Int16Array {
  // byteOffset이 2의 배수가 아니면 Int16Array를 만들 수 없어 복사가 필요하다
  if ((bytes.byteOffset + chunk.offset) % 2 === 0) {
    return new Int16Array(bytes.buffer, bytes.byteOffset + chunk.offset, chunk.size / 2);
  }
  const copy = bytes.slice(chunk.offset, chunk.offset + chunk.size);
  return new Int16Array(copy.buffer, 0, chunk.size / 2);
}
