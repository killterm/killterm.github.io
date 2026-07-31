// 오디오 주파수 영역 스테가노그래피 세 가지 — 위상 코딩 · FSK · 에코 은닉.
//
// 전부 시간 영역 LSB와 다른 층위에서 동작한다. 순수 함수(Float32Array 입출력)라
// Node로 검증할 수 있고, 16-bit 양자화를 통과하는지도 테스트로 확인한다.

import { fft, goertzelPower, inverseSpectrum, spectrum } from './fft.ts';
import {
  frameMessage,
  parseFrame,
  peekFrameSize,
  type StegPayload,
} from './steganography-frame.ts';

function bitsOf(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1);
  }
  return bits;
}

function bytesOf(bits: ArrayLike<number>, byteCount: number): Uint8Array {
  const output = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | (bits[i * 8 + bit] ?? 0);
    output[i] = byte;
  }
  return output;
}

// ---------- 1. 위상 코딩 ----------
//
// 사람 귀는 절대 위상에 둔감하다. 그래서 구간별 FFT에서 선택한 빈의 위상을
// +π/2(비트 1) / −π/2(비트 0)로 양자화하고 크기는 그대로 둔다. 여러 빈에 같은
// 비트를 심고 다수결로 읽어 16-bit 양자화 오차를 이긴다.
//
// 구간은 겹치지 않게 자른다 — 겹쳐 더하면 서로의 위상을 덮어써 복원이 깨진다.
// 대신 구간 경계에서 파형이 튀어 약한 클릭이 생길 수 있다(안내 문구에 명시).

export const PHASE_SEGMENT = 1024;
/** 비트 하나를 심는 빈 수 (다수결) */
const PHASE_BINS_PER_BIT = 6;
/** 사용 빈 범위 — 너무 낮으면 눈에 띄고 너무 높으면 압축에 먼저 버려진다 */
const PHASE_FIRST_BIN = 24;

export function phaseCapacityBytes(sampleCount: number): number {
  return Math.floor(Math.floor(sampleCount / PHASE_SEGMENT) / 8);
}

/** 구간 하나가 비트 하나를 담는다 */
export function phaseEmbed(samples: Float32Array, payload: StegPayload): Float32Array {
  const frame = frameMessage(payload);
  const bits = bitsOf(frame);
  const segments = Math.floor(samples.length / PHASE_SEGMENT);
  if (bits.length > segments) {
    throw new Error(
      `용량이 부족합니다. 필요 ${frame.length.toLocaleString()}바이트 / 가능 ${phaseCapacityBytes(samples.length).toLocaleString()}바이트`,
    );
  }
  const output = Float32Array.from(samples);
  for (let index = 0; index < bits.length; index++) {
    const start = index * PHASE_SEGMENT;
    const segment = samples.subarray(start, start + PHASE_SEGMENT);
    const { magnitude, phase } = spectrum(segment, PHASE_SEGMENT);
    const target = bits[index] === 1 ? Math.PI / 2 : -Math.PI / 2;
    for (let offset = 0; offset < PHASE_BINS_PER_BIT; offset++) {
      phase[PHASE_FIRST_BIN + offset] = target;
    }
    const restored = inverseSpectrum(magnitude, phase, PHASE_SEGMENT);
    for (let i = 0; i < PHASE_SEGMENT; i++) {
      output[start + i] = Math.max(-1, Math.min(1, restored[i]));
    }
  }
  return output;
}

function phaseReadBits(samples: Float32Array, bitCount: number): number[] {
  const bits: number[] = [];
  const segments = Math.floor(samples.length / PHASE_SEGMENT);
  for (let index = 0; index < Math.min(bitCount, segments); index++) {
    const start = index * PHASE_SEGMENT;
    const { phase } = spectrum(samples.subarray(start, start + PHASE_SEGMENT), PHASE_SEGMENT);
    let positives = 0;
    for (let offset = 0; offset < PHASE_BINS_PER_BIT; offset++) {
      if (phase[PHASE_FIRST_BIN + offset] > 0) positives++;
    }
    bits.push(positives * 2 > PHASE_BINS_PER_BIT ? 1 : 0);
  }
  return bits;
}

export function phaseExtract(samples: Float32Array): StegPayload | null {
  const maxBytes = phaseCapacityBytes(samples.length);
  if (maxBytes === 0) return null;
  const headerBytes = Math.min(maxBytes, 266);
  const size = peekFrameSize(bytesOf(phaseReadBits(samples, headerBytes * 8), headerBytes));
  if (size === null || size > maxBytes) return null;
  return parseFrame(bytesOf(phaseReadBits(samples, size * 8), size));
}

// ---------- 2. FSK (주파수 변조) ----------
//
// 비트를 두 톤의 높이로 실어 보낸다(옛 모뎀 방식). 복조는 Goertzel로 두 톤의
// 세기만 비교하면 되므로 전체 FFT가 필요 없다. 초음파 프리셋은 대부분의 성인에게
// 들리지 않아 기기 간 마이크 수신 시연이 가능하다(하드웨어에 따라 실패 가능).

export interface FskPreset {
  id: 'audible' | 'ultrasonic';
  label: string;
  zeroFrequency: number;
  oneFrequency: number;
  /** 심볼 길이(초) */
  symbolSeconds: number;
}

export const FSK_PRESETS: FskPreset[] = [
  {
    id: 'audible',
    label: '가청 (1200 / 2200Hz)',
    zeroFrequency: 1200,
    oneFrequency: 2200,
    symbolSeconds: 0.02,
  },
  {
    id: 'ultrasonic',
    label: '초음파 (18.5 / 19.5kHz)',
    zeroFrequency: 18500,
    oneFrequency: 19500,
    symbolSeconds: 0.02,
  },
];

/** 동기용 프리앰블 — 1과 0을 번갈아 보내 심볼 경계를 찾게 한다 */
const PREAMBLE_BITS = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1];

/** 데이터를 소리로 만든다 (모노 Float32) */
export function fskModulate(
  payload: StegPayload,
  preset: FskPreset,
  sampleRate: number,
): Float32Array {
  const bits = [...PREAMBLE_BITS, ...bitsOf(frameMessage(payload))];
  const symbolSamples = Math.round(preset.symbolSeconds * sampleRate);
  const output = new Float32Array(bits.length * symbolSamples);
  // 톤 사이 위상이 튀지 않게 위상을 계속 이어서 누적한다
  let phase = 0;
  for (let index = 0; index < bits.length; index++) {
    const frequency = bits[index] === 1 ? preset.oneFrequency : preset.zeroFrequency;
    const increment = (2 * Math.PI * frequency) / sampleRate;
    for (let i = 0; i < symbolSamples; i++) {
      // 심볼 양 끝을 살짝 줄여 딸깍 소리를 막는다
      const ramp = Math.min(1, Math.min(i, symbolSamples - 1 - i) / 32);
      output[index * symbolSamples + i] = Math.sin(phase) * 0.6 * ramp;
      phase += increment;
    }
  }
  return output;
}

function fskDecodeFrom(
  samples: Float32Array,
  preset: FskPreset,
  sampleRate: number,
  offset: number,
): { bits: number[]; confidence: number } {
  const symbolSamples = Math.round(preset.symbolSeconds * sampleRate);
  const bits: number[] = [];
  let confidence = 0;
  for (let start = offset; start + symbolSamples <= samples.length; start += symbolSamples) {
    const zeroPower = goertzelPower(samples, start, symbolSamples, preset.zeroFrequency, sampleRate);
    const onePower = goertzelPower(samples, start, symbolSamples, preset.oneFrequency, sampleRate);
    bits.push(onePower > zeroPower ? 1 : 0);
    const total = zeroPower + onePower;
    if (total > 0) confidence += Math.abs(onePower - zeroPower) / total;
  }
  return { bits, confidence: bits.length > 0 ? confidence / bits.length : 0 };
}

/**
 * 소리에서 데이터를 복원한다. 프리앰블을 찾아 심볼 경계를 맞춘다
 * (파일이든 마이크 녹음이든 시작 위치를 모르기 때문).
 */
export function fskDemodulate(
  samples: Float32Array,
  preset: FskPreset,
  sampleRate: number,
): StegPayload | null {
  const symbolSamples = Math.round(preset.symbolSeconds * sampleRate);
  const searchLimit = Math.min(samples.length, sampleRate * 5);
  const stride = Math.max(1, Math.floor(symbolSamples / 8));

  let best: { offset: number; score: number } | null = null;
  for (let offset = 0; offset + symbolSamples * PREAMBLE_BITS.length <= searchLimit; offset += stride) {
    const { bits, confidence } = fskDecodeFrom(
      samples.subarray(offset, offset + symbolSamples * PREAMBLE_BITS.length),
      preset,
      sampleRate,
      0,
    );
    let matched = 0;
    for (let i = 0; i < PREAMBLE_BITS.length && i < bits.length; i++) {
      if (bits[i] === PREAMBLE_BITS[i]) matched++;
    }
    const score = matched + confidence;
    if (matched === PREAMBLE_BITS.length && (!best || score > best.score)) {
      best = { offset, score };
    }
  }
  if (!best) return null;

  const dataOffset = best.offset + symbolSamples * PREAMBLE_BITS.length;
  const { bits } = fskDecodeFrom(samples, preset, sampleRate, dataOffset);
  const byteCount = Math.floor(bits.length / 8);
  if (byteCount === 0) return null;
  const bytes = bytesOf(bits, byteCount);
  const size = peekFrameSize(bytes);
  if (size === null || size > bytes.length) return null;
  return parseFrame(bytes.subarray(0, size));
}

// ---------- 3. 에코 은닉 ----------
//
// 비트에 따라 다른 지연의 짧은 반향을 섞는다. 사람은 1~2ms 반향을 소리 색깔의
// 미묘한 변화로만 느낀다. 복호는 켑스트럼(로그 스펙트럼의 역변환)에서 어느 지연에
// 피크가 서는지 본다.

export const ECHO_SEGMENT = 4096;
const ECHO_DELAY_ZERO = 60;
const ECHO_DELAY_ONE = 110;
const ECHO_GAIN = 0.45;

export function echoCapacityBytes(sampleCount: number): number {
  return Math.floor(Math.floor(sampleCount / ECHO_SEGMENT) / 8);
}

export function echoEmbed(samples: Float32Array, payload: StegPayload): Float32Array {
  const frame = frameMessage(payload);
  const bits = bitsOf(frame);
  const segments = Math.floor(samples.length / ECHO_SEGMENT);
  if (bits.length > segments) {
    throw new Error(
      `용량이 부족합니다. 필요 ${frame.length.toLocaleString()}바이트 / 가능 ${echoCapacityBytes(samples.length).toLocaleString()}바이트`,
    );
  }
  const output = Float32Array.from(samples);
  for (let index = 0; index < bits.length; index++) {
    const start = index * ECHO_SEGMENT;
    const delay = bits[index] === 1 ? ECHO_DELAY_ONE : ECHO_DELAY_ZERO;
    for (let i = delay; i < ECHO_SEGMENT; i++) {
      const value = output[start + i] + ECHO_GAIN * samples[start + i - delay];
      output[start + i] = Math.max(-1, Math.min(1, value));
    }
  }
  return output;
}

/** 켑스트럼: IFFT(log|FFT(x)|) — 반향 지연 위치에 피크가 생긴다 */
function cepstrum(segment: Float32Array): Float64Array {
  const real = new Float64Array(ECHO_SEGMENT);
  const imag = new Float64Array(ECHO_SEGMENT);
  for (let i = 0; i < ECHO_SEGMENT; i++) real[i] = segment[i] ?? 0;
  fft(real, imag);
  for (let i = 0; i < ECHO_SEGMENT; i++) {
    real[i] = Math.log(Math.hypot(real[i], imag[i]) + 1e-12);
    imag[i] = 0;
  }
  fft(real, imag, true);
  return real;
}

function echoReadBits(samples: Float32Array, bitCount: number): number[] {
  const bits: number[] = [];
  const segments = Math.floor(samples.length / ECHO_SEGMENT);
  for (let index = 0; index < Math.min(bitCount, segments); index++) {
    const start = index * ECHO_SEGMENT;
    const values = cepstrum(samples.subarray(start, start + ECHO_SEGMENT) as Float32Array);
    bits.push(values[ECHO_DELAY_ONE] > values[ECHO_DELAY_ZERO] ? 1 : 0);
  }
  return bits;
}

export function echoExtract(samples: Float32Array): StegPayload | null {
  const maxBytes = echoCapacityBytes(samples.length);
  if (maxBytes === 0) return null;
  const headerBytes = Math.min(maxBytes, 266);
  const size = peekFrameSize(bytesOf(echoReadBits(samples, headerBytes * 8), headerBytes));
  if (size === null || size > maxBytes) return null;
  return parseFrame(bytesOf(echoReadBits(samples, size * 8), size));
}
