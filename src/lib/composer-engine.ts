// 칩튠 작곡기 엔진 — 음정 매핑, 노트 렌더링 캐시, 오프라인 믹스다운.
//
// 핵심: sfxr 파라미터에서 baseFreq만 음표 주파수로 치환해 재합성하면
// 같은 음색으로 모든 음정을 낼 수 있다. 합성이 순수 함수라서 노트 단위로
// 캐시하고, WAV 내보내기는 mixSong()의 오프라인 믹스다운을 그대로 쓴다.

// .ts 확장자를 명시하면 Vite뿐 아니라 Node(type stripping)로도 바로 실행돼
// 스크립트 검증이 가능하다
import { SAMPLE_RATE, defaultParams, synthesize, type SfxParams } from './sfx-synth.ts';

// ---------- 음정 ----------

/** 피아노롤 행 수 — C3(인덱스 0)부터 B5까지 반음 단위 3옥타브 */
export const NOTE_COUNT = 36;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteLabel(noteIndex: number): string {
  const octave = 3 + Math.floor(noteIndex / 12);
  return `${NOTE_NAMES[noteIndex % 12]}${octave}`;
}

export function isBlackKey(noteIndex: number): boolean {
  return NOTE_NAMES[noteIndex % 12].includes('#');
}

/** C3 = MIDI 48 기준 평균율 주파수 */
export function noteToHz(noteIndex: number): number {
  const midi = 48 + noteIndex;
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * 주파수(Hz) → sfxr baseFreq 역산.
 * sfxr의 기본 주파수는 period = 100/(baseFreq²+0.001), 내부 스텝이 초당
 * 44100×8이므로 freq = 352800/period = 3528×(baseFreq²+0.001).
 * (유효 범위 ~3.5Hz–3528Hz — C3~B5는 여유)
 */
export function baseFreqForHz(hz: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, hz / 3528 - 0.001)));
}

// ---------- 곡 구조 ----------

export const CHANNEL_COUNT = 4;
/** 패턴 길이: 16분음표 × 2마디 */
export const PATTERN_STEPS = 32;
export const MAX_PATTERNS = 16;
export const MAX_SEQUENCE = 64;

export interface Instrument {
  name: string;
  params: SfxParams;
}

export interface Channel {
  instrument: Instrument;
  volume: number;
  muted: boolean;
}

export interface Pattern {
  /** [채널][스텝] = 노트 인덱스 | null — 채널은 모노포닉(스텝당 한 음) */
  notes: (number | null)[][];
}

export interface Song {
  version: 1;
  bpm: number;
  channels: Channel[];
  patterns: Pattern[];
  /** 패턴 인덱스를 순서대로 나열한 곡 구성 */
  sequence: number[];
}

export function emptyPattern(): Pattern {
  return {
    notes: Array.from({ length: CHANNEL_COUNT }, () =>
      Array.from({ length: PATTERN_STEPS }, () => null),
    ),
  };
}

// ---------- 내장 악기 ----------

function instrumentParams(overrides: Partial<SfxParams>): SfxParams {
  const params = { ...defaultParams(), ...overrides };
  // baseFreq는 노트가 결정하므로 여기 값은 의미 없음 (renderNote가 치환)
  params.freqLimit = 0;
  return params;
}

export const BUILTIN_INSTRUMENTS: Instrument[] = [
  {
    name: '사각 리드',
    params: instrumentParams({ waveType: 'square', sustain: 0.18, decay: 0.18 }),
  },
  {
    name: '사인 리드',
    params: instrumentParams({ waveType: 'sine', sustain: 0.2, decay: 0.25 }),
  },
  {
    name: '톱니 베이스',
    params: instrumentParams({ waveType: 'sawtooth', sustain: 0.25, decay: 0.2, lpfCutoff: 0.45 }),
  },
  {
    name: '삼각 베이스',
    params: instrumentParams({ waveType: 'triangle', sustain: 0.25, decay: 0.3 }),
  },
  {
    name: '킥',
    params: instrumentParams({
      waveType: 'sine',
      sustain: 0.1,
      decay: 0.32,
      punch: 0.6,
      freqSlide: -0.4,
    }),
  },
  {
    name: '스네어',
    params: instrumentParams({
      waveType: 'noise',
      sustain: 0.08,
      decay: 0.2,
      punch: 0.4,
      freqSlide: -0.2,
      hpfCutoff: 0.1,
    }),
  },
  {
    name: '하이햇',
    params: instrumentParams({
      waveType: 'noise',
      sustain: 0.03,
      decay: 0.08,
      punch: 0.2,
      hpfCutoff: 0.6,
    }),
  },
];

export function defaultSong(): Song {
  return {
    version: 1,
    bpm: 120,
    channels: [
      { instrument: cloneInstrument(BUILTIN_INSTRUMENTS[0]), volume: 0.8, muted: false },
      { instrument: cloneInstrument(BUILTIN_INSTRUMENTS[3]), volume: 0.8, muted: false },
      { instrument: cloneInstrument(BUILTIN_INSTRUMENTS[4]), volume: 0.8, muted: false },
      { instrument: cloneInstrument(BUILTIN_INSTRUMENTS[5]), volume: 0.8, muted: false },
    ],
    patterns: [emptyPattern()],
    sequence: [0],
  };
}

export function cloneInstrument(instrument: Instrument): Instrument {
  return { name: instrument.name, params: { ...instrument.params } };
}

/** JSON 가져오기/localStorage 복원용 — 형태를 검증하고 빠진 값은 기본으로 보강 */
export function normalizeSong(raw: unknown): Song | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.patterns) || !Array.isArray(input.channels)) return null;
  const base = defaultSong();
  const song: Song = {
    version: 1,
    bpm: clampNumber(input.bpm, 60, 240, base.bpm),
    channels: base.channels.map((fallback, channelIndex) => {
      const channel = (input.channels as Record<string, unknown>[])[channelIndex];
      if (!channel || typeof channel !== 'object') return fallback;
      const instrument = channel.instrument as Record<string, unknown> | undefined;
      return {
        instrument:
          instrument && typeof instrument.name === 'string' && instrument.params
            ? {
                name: instrument.name,
                params: { ...defaultParams(), ...(instrument.params as Partial<SfxParams>) },
              }
            : fallback.instrument,
        volume: clampNumber(channel.volume, 0, 1, fallback.volume),
        muted: channel.muted === true,
      };
    }),
    patterns: (input.patterns as unknown[]).slice(0, MAX_PATTERNS).map((pattern) => {
      const target = emptyPattern();
      const notes = (pattern as Record<string, unknown>)?.notes;
      if (Array.isArray(notes)) {
        for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
          const row = notes[channel];
          if (!Array.isArray(row)) continue;
          for (let step = 0; step < PATTERN_STEPS; step++) {
            const note = row[step];
            if (typeof note === 'number' && Number.isInteger(note) && note >= 0 && note < NOTE_COUNT) {
              target.notes[channel][step] = note;
            }
          }
        }
      }
      return target;
    }),
    sequence: [],
  };
  if (song.patterns.length === 0) song.patterns.push(emptyPattern());
  if (Array.isArray(input.sequence)) {
    song.sequence = (input.sequence as unknown[])
      .filter(
        (index): index is number =>
          typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < song.patterns.length,
      )
      .slice(0, MAX_SEQUENCE);
  }
  if (song.sequence.length === 0) song.sequence = [0];
  return song;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

// ---------- 노트 렌더링 ----------

/** 16분음표 한 스텝의 길이(초) */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

// 캐시 키에 파라미터 전체(JSON)를 쓴다 — 악기가 바뀌면 자연히 다른 키가
// 되므로 무효화가 필요 없다. 노이즈 파형은 Math.random 기반이라 렌더마다
// 미세하게 다른데, 캐시 덕에 재생 중에는 같은 소리가 유지된다.
const noteCache = new Map<string, Float32Array>();
const NOTE_CACHE_LIMIT = 512;

export function renderNote(params: SfxParams, noteIndex: number): Float32Array {
  const key = `${JSON.stringify(params)}|${noteIndex}`;
  let samples = noteCache.get(key);
  if (!samples) {
    if (noteCache.size >= NOTE_CACHE_LIMIT) noteCache.clear();
    samples = synthesize({ ...params, baseFreq: baseFreqForHz(noteToHz(noteIndex)) });
    noteCache.set(key, samples);
  }
  return samples;
}

// ---------- 오프라인 믹스다운 ----------

/**
 * 곡 전체(시퀀스 순서)를 하나의 모노 샘플로 믹스한다.
 * 채널 볼륨 × 마스터 × 0.5(4채널 중첩 헤드룸) 후 [-1,1] 클램프.
 * 마지막 노트의 엔벨로프 꼬리까지 포함한다.
 */
export function mixSong(song: Song, masterVolume = 1): Float32Array {
  const stepSamples = Math.round(stepDuration(song.bpm) * SAMPLE_RATE);
  const sequence = song.sequence.length > 0 ? song.sequence : [0];

  interface NoteEvent {
    start: number;
    samples: Float32Array;
    volume: number;
  }
  const events: NoteEvent[] = [];
  let totalLength = sequence.length * PATTERN_STEPS * stepSamples;

  sequence.forEach((patternIndex, sequencePosition) => {
    const pattern = song.patterns[patternIndex];
    if (!pattern) return;
    for (let channelIndex = 0; channelIndex < CHANNEL_COUNT; channelIndex++) {
      const channel = song.channels[channelIndex];
      if (!channel || channel.muted || channel.volume === 0) continue;
      for (let step = 0; step < PATTERN_STEPS; step++) {
        const note = pattern.notes[channelIndex][step];
        if (note === null) continue;
        const samples = renderNote(channel.instrument.params, note);
        const start = (sequencePosition * PATTERN_STEPS + step) * stepSamples;
        events.push({ start, samples, volume: channel.volume });
        totalLength = Math.max(totalLength, start + samples.length);
      }
    }
  });

  const output = new Float32Array(totalLength);
  for (const event of events) {
    const gain = event.volume * masterVolume * 0.5;
    for (let i = 0; i < event.samples.length; i++) {
      output[event.start + i] += event.samples[i] * gain;
    }
  }
  for (let i = 0; i < output.length; i++) {
    output[i] = Math.max(-1, Math.min(1, output[i]));
  }
  return output;
}
