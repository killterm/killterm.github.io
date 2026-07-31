// 스펙트로그램 은닉 — 그림을 소리로 합성해, 스펙트로그램으로 볼 때만 드러나게 한다.
//
// 데이터 복원용이 아니라 "보여주기" 기법이다(Aphex Twin 등이 쓴 방식). 이미지를
// 시간(가로)×주파수(세로) 평면으로 해석해 각 프레임의 크기 스펙트럼으로 삼고,
// 위상은 무작위로 채워 역FFT + Hann 겹쳐 더하기로 소리를 만든다. 위상이 무작위라
// 소리는 잡음처럼 들리지만 스펙트로그램 모양은 원본 그림을 따른다.

import { hannWindow, inverseSpectrum, spectrum } from './fft.ts';

export const FRAME_SIZE = 1024;
/** 겹침 간격 — FRAME_SIZE/4면 Hann 창 합이 거의 일정해진다 */
export const HOP_SIZE = FRAME_SIZE / 4;

export interface SpectrogramOptions {
  sampleRate: number;
  /** 그림이 놓일 주파수 하한·상한(Hz) */
  minFrequency: number;
  maxFrequency: number;
  /** 소리 길이(초) */
  seconds: number;
}

export const DEFAULT_OPTIONS: SpectrogramOptions = {
  sampleRate: 44100,
  minFrequency: 500,
  maxFrequency: 8000,
  seconds: 4,
};

/**
 * 그레이스케일 밝기 배열(행=주파수, 열=시간)을 오디오로 합성한다.
 * brightness[y][x]는 0~1이고 y=0이 이미지 위쪽(높은 주파수)이다.
 */
export function imageToAudio(
  brightness: Float32Array,
  imageWidth: number,
  imageHeight: number,
  options: SpectrogramOptions = DEFAULT_OPTIONS,
): Float32Array<ArrayBuffer> {
  const { sampleRate, minFrequency, maxFrequency, seconds } = options;
  const totalSamples = Math.floor(seconds * sampleRate);
  const frameCount = Math.max(1, Math.ceil(totalSamples / HOP_SIZE));
  const output = new Float32Array(totalSamples + FRAME_SIZE);
  const windowSum = new Float32Array(totalSamples + FRAME_SIZE);
  const window = hannWindow(FRAME_SIZE);
  const bins = FRAME_SIZE / 2 + 1;
  const binHz = sampleRate / FRAME_SIZE;
  const firstBin = Math.max(1, Math.round(minFrequency / binHz));
  const lastBin = Math.min(bins - 1, Math.round(maxFrequency / binHz));

  const magnitude = new Float64Array(bins);
  const phase = new Float64Array(bins);

  for (let frame = 0; frame < frameCount; frame++) {
    magnitude.fill(0);
    const imageColumn = Math.min(imageWidth - 1, Math.floor((frame / frameCount) * imageWidth));
    for (let bin = firstBin; bin <= lastBin; bin++) {
      // 로그 주파수 축으로 배치하면 사람이 보기에 이미지 비율이 자연스럽다
      const ratio = (bin - firstBin) / Math.max(1, lastBin - firstBin);
      const imageRow = Math.min(
        imageHeight - 1,
        Math.max(0, Math.round((1 - ratio) * (imageHeight - 1))),
      );
      const value = brightness[imageRow * imageWidth + imageColumn];
      magnitude[bin] = value * value * 90;
      // 위상은 무작위 — 그래서 소리는 잡음처럼 들린다
      phase[bin] = Math.random() * 2 * Math.PI;
    }
    const grain = inverseSpectrum(magnitude, phase, FRAME_SIZE);
    const start = frame * HOP_SIZE;
    for (let i = 0; i < FRAME_SIZE; i++) {
      if (start + i >= output.length) break;
      output[start + i] += grain[i] * window[i];
      windowSum[start + i] += window[i] * window[i];
    }
  }

  // 창 중첩 보정. 창 합이 거의 0인 양 끝(겹침이 모자란 구간)을 그대로 나누면
  // 값이 폭발해 그 스파이크가 정규화를 지배하고 본 구간이 조용해진다 — 잘라낸다.
  for (let i = 0; i < output.length; i++) {
    if (windowSum[i] > 0.05) output[i] /= windowSum[i];
    else output[i] = 0;
  }
  // 정규화는 실제로 돌려줄 구간만 보고 계산한다 (꼬리는 잘려 나가므로)
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) peak = Math.max(peak, Math.abs(output[i]));
  if (peak > 0) {
    const gain = 0.85 / peak;
    for (let i = 0; i < output.length; i++) output[i] *= gain;
  }
  return output.subarray(0, totalSamples) as Float32Array<ArrayBuffer>;
}

export interface SpectrogramData {
  /** [프레임][빈] 크기를 dB로 정규화한 0~1 값 */
  values: Float32Array;
  frameCount: number;
  binCount: number;
  sampleRate: number;
}

/** 오디오에서 스펙트로그램(0~1 정규화)을 만든다 — 뷰어 렌더용 */
export function audioToSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  maxFrames = 800,
): SpectrogramData {
  const available = Math.max(1, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const step = Math.max(1, Math.ceil(available / maxFrames));
  const frameCount = Math.ceil(available / step);
  const binCount = FRAME_SIZE / 2 + 1;
  const values = new Float32Array(frameCount * binCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * step * HOP_SIZE;
    const { magnitude } = spectrum(samples.subarray(start, start + FRAME_SIZE), FRAME_SIZE);
    for (let bin = 0; bin < binCount; bin++) {
      // dB로 옮겨 -80dB..0dB를 0..1로 매핑 (사람 청각과 눈에 맞는 대비)
      const db = 20 * Math.log10(magnitude[bin] + 1e-9);
      values[frame * binCount + bin] = Math.max(0, Math.min(1, (db + 80) / 80));
    }
  }
  return { values, frameCount, binCount, sampleRate };
}
