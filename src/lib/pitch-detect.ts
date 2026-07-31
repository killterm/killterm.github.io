// 단선율 멜로디 채보 — 오디오에서 음높이를 읽어 피아노롤 노트로 옮긴다.
//
// **단음(monophonic)만 다룬다.** 여러 악기가 동시에 울리는 음악에서 각 음을
// 분리하는 다성 채보는 규칙 기반으로는 결과가 쓸모없기 때문에 시도하지 않는다.
// 휘파람·허밍·단선율 연주가 대상이다.
//
// 피치 검출은 YIN 계열: 차분 함수 → 누적 평균 정규화 → 첫 임계 통과 지점.
// 자기상관만 쓰면 옥타브 아래로 잘못 잡히는 일이 흔한데, 정규화가 그걸 줄여 준다.
// DOM에 의존하지 않아 Node로 검증한다.

import { NOTE_COUNT, noteToHz } from './composer-engine.ts';

/** 분석 프레임 크기 — 44.1kHz에서 약 46ms. 낮은 음(80Hz)도 두 주기가 들어간다 */
export const FRAME_SIZE = 2048;
/** 프레임 간격 — 약 12ms */
export const HOP_SIZE = 512;

/** 사람이 낼 수 있는 범위로 탐색을 제한한다 (배음 오검출을 줄인다) */
const MIN_HZ = 70;
const MAX_HZ = 1400;
/** 이 값보다 작으면 "음이 아니다"로 본다 (YIN 임계) */
const YIN_THRESHOLD = 0.15;

/**
 * 한 프레임의 기본 주파수를 구한다. 음을 찾지 못하면 0.
 * 반환값은 Hz.
 */
export function detectPitch(
  samples: Float32Array,
  start: number,
  sampleRate: number,
): number {
  const size = Math.min(FRAME_SIZE, samples.length - start);
  if (size < 256) return 0;
  const half = Math.floor(size / 2);
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(half - 1, Math.floor(sampleRate / MIN_HZ));
  if (maxLag <= minLag) return 0;

  // 차분 함수 d(τ)
  const difference = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = samples[start + i] - samples[start + i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  // 누적 평균으로 정규화 d'(τ) — 옥타브 오검출을 줄이는 핵심
  const normalized = new Float64Array(maxLag + 1);
  normalized[minLag] = 1;
  let runningSum = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    runningSum += difference[lag];
    normalized[lag] = runningSum === 0 ? 1 : (difference[lag] * (lag - minLag + 1)) / runningSum;
  }

  // 임계값을 처음 밑도는 골짜기를 찾고, 그 안에서 최소점까지 내려간다
  let chosen = -1;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (normalized[lag] < YIN_THRESHOLD) {
      while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
      chosen = lag;
      break;
    }
  }
  if (chosen < 0) return 0;

  // 포물선 보간으로 소수점 정확도를 얻는다 (반음 단위 판정에 필요)
  const previous = normalized[chosen - 1] ?? normalized[chosen];
  const next = normalized[chosen + 1] ?? normalized[chosen];
  const denominator = 2 * (2 * normalized[chosen] - previous - next);
  const shift = denominator === 0 ? 0 : (next - previous) / denominator;
  return sampleRate / (chosen + shift);
}

/** 프레임의 실효값 — 소리가 있는지 판단한다 */
export function frameRms(samples: Float32Array, start: number, size = FRAME_SIZE): number {
  const end = Math.min(samples.length, start + size);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
}

/**
 * Hz → 피아노롤 노트 인덱스(C3=0, 반음 단위). 범위를 벗어나도 그대로 돌려주므로
 * C3보다 낮은 음은 **음수**가 된다 — "음 없음"을 -1로 표시하면 그 음들을 잃는다.
 * 유효하지 않은 입력은 NaN.
 */
export function hzToNoteIndex(hz: number): number {
  if (hz <= 0) return Number.NaN;
  // noteToHz(0) = C3
  return Math.round(12 * Math.log2(hz / noteToHz(0)));
}

export interface DetectedNote {
  noteIndex: number;
  /** 소리가 시작한 시각(초) */
  startSeconds: number;
  durationSeconds: number;
}

export interface TranscribeOptions {
  /** 이 값보다 조용한 프레임은 무음으로 본다 */
  silenceRms?: number;
  /** 이보다 짧은 음은 잡음으로 버린다(초) */
  minNoteSeconds?: number;
}

/**
 * 오디오에서 음 목록을 뽑는다 (아직 격자에 맞추지 않은 상태).
 * 프레임별 음높이를 중앙값으로 다듬고, 같은 음이 이어지는 구간을 하나로 묶는다.
 */
export function detectNotes(
  samples: Float32Array,
  sampleRate: number,
  options: TranscribeOptions = {},
): DetectedNote[] {
  const silenceRms = options.silenceRms ?? 0.02;
  const minNoteSeconds = options.minNoteSeconds ?? 0.07;

  // 1) 프레임마다 음높이. 음이 없으면 null (인덱스가 음수일 수 있어 -1은 못 쓴다)
  const frames: (number | null)[] = [];
  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    if (frameRms(samples, start) < silenceRms) {
      frames.push(null);
      continue;
    }
    const hz = detectPitch(samples, start, sampleRate);
    frames.push(hz > 0 ? hzToNoteIndex(hz) : null);
  }

  // 2) 중앙값 필터 — 한두 프레임짜리 옥타브 튐을 없앤다
  const smoothed = frames.map((_, index) => {
    const window = frames
      .slice(Math.max(0, index - 2), index + 3)
      .filter((note): note is number => note !== null);
    if (window.length === 0) return null;
    const sorted = [...window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });

  // 3) 같은 음이 이어지는 구간을 하나의 음으로 묶는다
  const secondsPerFrame = HOP_SIZE / sampleRate;
  const notes: DetectedNote[] = [];
  let current: number | null = null;
  let currentStart = 0;
  const flush = (endIndex: number) => {
    if (current === null) return;
    const duration = (endIndex - currentStart) * secondsPerFrame;
    if (duration >= minNoteSeconds) {
      notes.push({
        noteIndex: current,
        startSeconds: currentStart * secondsPerFrame,
        durationSeconds: duration,
      });
    }
  };
  smoothed.forEach((note, index) => {
    if (note !== current) {
      flush(index);
      current = note;
      currentStart = index;
    }
  });
  flush(smoothed.length);
  return notes;
}

export interface TranscribeResult {
  /** 격자에 맞춘 결과 — [스텝] = 노트 인덱스 | null */
  steps: (number | null)[];
  /** 옥타브를 옮긴 양(반음). 0이면 그대로 */
  transposedSemitones: number;
  /** 격자 길이를 넘어 버린 음 개수 */
  droppedCount: number;
  /** 격자에 들어간 음 개수 */
  placedCount: number;
}

/**
 * 음 목록을 BPM 격자(16분음표)에 맞춰 패턴 한 칸으로 만든다.
 * 피아노롤 범위(C3~B5)를 벗어나면 옥타브 단위로 통째로 옮긴다 — 사람이 부른
 * 음역이 그대로 들어가는 일이 드물기 때문이다.
 */
export function quantizeToPattern(
  notes: DetectedNote[],
  bpm: number,
  stepCount: number,
): TranscribeResult {
  const steps: (number | null)[] = Array.from({ length: stepCount }, () => null);
  if (notes.length === 0) {
    return { steps, transposedSemitones: 0, droppedCount: 0, placedCount: 0 };
  }

  // 옥타브 단위로 옮겨 피아노롤 범위에 넣는다. **0에 가까운 이동을 먼저** 시도해
  // 원래 음높이를 최대한 지키고, 전부 들어가는 이동이 없으면 가장 많이 들어가는
  // 이동을 고른다.
  const fitCount = (shift: number) =>
    notes.filter((note) => {
      const shifted = note.noteIndex + shift;
      return shifted >= 0 && shifted < NOTE_COUNT;
    }).length;
  const candidates = [0];
  for (let octave = 1; octave <= 6; octave++) candidates.push(-12 * octave, 12 * octave);
  let transpose = 0;
  let bestFit = -1;
  for (const shift of candidates) {
    const fit = fitCount(shift);
    if (fit === notes.length) {
      transpose = shift;
      bestFit = fit;
      break;
    }
    if (fit > bestFit) {
      bestFit = fit;
      transpose = shift;
    }
  }

  const stepSeconds = 60 / bpm / 4;
  let dropped = 0;
  let placed = 0;
  for (const note of notes) {
    const step = Math.round(note.startSeconds / stepSeconds);
    const shifted = note.noteIndex + transpose;
    if (step >= stepCount || shifted < 0 || shifted >= NOTE_COUNT) {
      dropped++;
      continue;
    }
    // 같은 칸에 여러 음이 겹치면 먼저 온 음을 남긴다 (채널은 모노포닉)
    if (steps[step] !== null) {
      dropped++;
      continue;
    }
    steps[step] = shifted;
    placed++;
  }
  return { steps, transposedSemitones: transpose, droppedCount: dropped, placedCount: placed };
}

/** 오디오 → 패턴 한 칸. detectNotes + quantizeToPattern을 묶은 편의 함수 */
export function transcribe(
  samples: Float32Array,
  sampleRate: number,
  bpm: number,
  stepCount: number,
  options?: TranscribeOptions,
): TranscribeResult & { notes: DetectedNote[] } {
  const notes = detectNotes(samples, sampleRate, options);
  return { ...quantizeToPattern(notes, bpm, stepCount), notes };
}
