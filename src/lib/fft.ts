// radix-2 복소 FFT/IFFT.
//
// 브라우저에는 임의 배열용 FFT API가 없다 — Web Audio의 AnalyserNode는 실시간
// 전용이고 크기(magnitude)만 주며 위상을 돌려주지 않는다. 위상 코딩·에코 은닉·
// 스펙트로그램이 모두 위상까지 필요하므로 직접 구현한다. 순수 함수라 Node 검증 가능.

/** 2의 거듭제곱인지 */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * 제자리(in-place) 복소 FFT. real/imag 길이는 같은 2의 거듭제곱이어야 한다.
 * inverse=true면 역변환(1/N 정규화 포함).
 */
export function fft(real: Float64Array, imag: Float64Array, inverse = false): void {
  const n = real.length;
  if (n !== imag.length || !isPowerOfTwo(n)) {
    throw new Error('FFT 길이는 2의 거듭제곱이어야 합니다.');
  }

  // 비트 역순 재배열
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (sign * 2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      for (let offset = 0; offset < length / 2; offset++) {
        const a = start + offset;
        const b = a + length / 2;
        const productReal = real[b] * twiddleReal - imag[b] * twiddleImag;
        const productImag = real[b] * twiddleImag + imag[b] * twiddleReal;
        real[b] = real[a] - productReal;
        imag[b] = imag[a] - productImag;
        real[a] += productReal;
        imag[a] += productImag;
        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

/** 실수 신호 구간을 FFT해 크기·위상 배열을 돌려준다 (0..N/2 빈) */
export function spectrum(samples: ArrayLike<number>, size: number) {
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let i = 0; i < size; i++) real[i] = samples[i] ?? 0;
  fft(real, imag);
  const bins = size / 2 + 1;
  const magnitude = new Float64Array(bins);
  const phase = new Float64Array(bins);
  for (let bin = 0; bin < bins; bin++) {
    magnitude[bin] = Math.hypot(real[bin], imag[bin]);
    phase[bin] = Math.atan2(imag[bin], real[bin]);
  }
  return { magnitude, phase };
}

/**
 * 크기·위상(0..N/2)에서 실수 신호를 복원한다.
 * 음수 주파수는 켤레 대칭으로 채워 실수 출력이 되도록 한다.
 */
export function inverseSpectrum(
  magnitude: ArrayLike<number>,
  phase: ArrayLike<number>,
  size: number,
): Float64Array {
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const bins = size / 2 + 1;
  for (let bin = 0; bin < bins; bin++) {
    real[bin] = magnitude[bin] * Math.cos(phase[bin]);
    imag[bin] = magnitude[bin] * Math.sin(phase[bin]);
    if (bin > 0 && bin < size / 2) {
      real[size - bin] = real[bin];
      imag[size - bin] = -imag[bin];
    }
  }
  imag[0] = 0;
  if (size % 2 === 0) imag[size / 2] = 0;
  fft(real, imag, true);
  return real;
}

/** Hann 창 (겹쳐 더할 때 매끄럽게) */
export function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }
  return window;
}

/**
 * Goertzel 알고리즘 — 특정 주파수 하나의 세기만 구한다.
 * FSK 복조는 두 톤의 세기만 비교하면 되므로 전체 FFT보다 훨씬 싸다.
 */
export function goertzelPower(
  samples: ArrayLike<number>,
  start: number,
  length: number,
  frequency: number,
  sampleRate: number,
): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let previous = 0;
  let beforePrevious = 0;
  for (let i = 0; i < length; i++) {
    const current = (samples[start + i] ?? 0) + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  return previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
}
