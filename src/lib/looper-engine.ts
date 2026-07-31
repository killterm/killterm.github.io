// 루프 스테이션 엔진 — 샘플 정렬·오버더브·믹스다운의 순수 로직.
//
// AudioContext 의존이 없어 Node로 직접 검증한다. 시간은 전부 오디오 클록의
// 샘플 프레임 단위로 다룬다 (워클릿의 currentFrame과 같은 좌표계).
// .ts 확장자를 명시하면 Vite뿐 아니라 Node(type stripping)로도 실행 가능.

export const TRACK_COUNT = 4;
export const MIN_LOOP_SECONDS = 0.5;
export const MAX_LOOP_SECONDS = 60;

export interface LoopTrack {
  /** 루프 1회 길이의 오디오. 비어 있으면 null. 오버더브는 복제 후 교체(변형 금지). */
  buffer: Float32Array<ArrayBuffer> | null;
  /** 실행취소용 직전 스냅숏 — hasSnapshot이 true일 때만 유효 (null = 빈 트랙이었음) */
  previousBuffer: Float32Array<ArrayBuffer> | null;
  hasSnapshot: boolean;
  volume: number;
  muted: boolean;
}

export function emptyTrack(): LoopTrack {
  return { buffer: null, previousBuffer: null, hasSnapshot: false, volume: 0.9, muted: false };
}

/**
 * 오디오 클록 프레임 → 루프 내 샘플 위치.
 * 마이크 경로의 지연(latencyFrames)만큼 앞으로 당겨서, 사용자가 "들으면서
 * 연주한" 시점이 루프의 그 위치에 정렬되도록 한다.
 */
export function loopPositionForFrame(
  chunkFrame: number,
  loopStartFrame: number,
  latencyFrames: number,
  loopLength: number,
): number {
  const raw = (chunkFrame - loopStartFrame - latencyFrames) % loopLength;
  return raw < 0 ? raw + loopLength : raw;
}

/** 청크를 루프 버퍼의 position부터 겹쳐 더한다 (끝을 넘으면 앞으로 랩어라운드) */
export function addChunkIntoLoop(
  loop: Float32Array,
  chunk: Float32Array,
  position: number,
): void {
  const length = loop.length;
  let writeIndex = ((Math.round(position) % length) + length) % length;
  for (let i = 0; i < chunk.length; i++) {
    loop[writeIndex] += chunk[i];
    writeIndex++;
    if (writeIndex === length) writeIndex = 0;
  }
}

/** 오버더브 시작: 기존 버퍼의 복제본(없으면 무음)을 작업 버퍼로 만든다 */
export function beginOverdubBuffer(track: LoopTrack, loopLength: number): Float32Array<ArrayBuffer> {
  return track.buffer ? track.buffer.slice(0) : new Float32Array(loopLength);
}

/** 오버더브 확정: 직전 상태를 스냅숏으로 남기고 작업 버퍼로 교체한다 */
export function commitOverdub(track: LoopTrack, overdubBuffer: Float32Array<ArrayBuffer>): void {
  track.previousBuffer = track.buffer;
  track.hasSnapshot = true;
  track.buffer = overdubBuffer;
}

/** 마지막 오버더브 되돌리기 (1단계). 성공 여부를 반환한다. */
export function undoOverdub(track: LoopTrack): boolean {
  if (!track.hasSnapshot) return false;
  track.buffer = track.previousBuffer;
  track.previousBuffer = null;
  track.hasSnapshot = false;
  return true;
}

export function clearTrack(track: LoopTrack): void {
  track.buffer = null;
  track.previousBuffer = null;
  track.hasSnapshot = false;
}

/** 녹음 청크들을 하나의 루프 버퍼로 잇는다 (첫 녹음 = 마스터 루프) */
export function concatChunks(chunks: Float32Array[]): Float32Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** 루프 1회 길이의 믹스다운 (트랙 볼륨 × 마스터 × 0.5 헤드룸, 클램프) */
export function mixTracks(
  tracks: LoopTrack[],
  loopLength: number,
  masterVolume = 1,
): Float32Array<ArrayBuffer> {
  const output = new Float32Array(loopLength);
  for (const track of tracks) {
    if (!track.buffer || track.muted || track.volume === 0) continue;
    const gain = track.volume * masterVolume * 0.5;
    const limit = Math.min(loopLength, track.buffer.length);
    for (let i = 0; i < limit; i++) {
      output[i] += track.buffer[i] * gain;
    }
  }
  for (let i = 0; i < output.length; i++) {
    output[i] = Math.max(-1, Math.min(1, output[i]));
  }
  return output;
}
