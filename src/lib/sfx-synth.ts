// 레트로 SFX 합성 엔진 — sfxr(DrPetter, 2007) 알고리즘의 TypeScript 포팅.
//
// 원본 WAV 없이 오실레이터(사각/톱니/사인/노이즈)를 수식으로 생성하고,
// 피치 슬라이드·비브라토·아르페지오·듀티·페이저·필터를 시간축에 건 뒤
// 엔벨로프(attack/sustain/decay)로 볼륨 곡선을 씌워 샘플 배열을 만든다.
// 원본과의 비교가 가능하도록 각 계수(0.01, 100000 등)는 sfxr 값을 그대로 쓴다.
// 파라미터 값 범위도 sfxr/jsfxr과 호환된다 (0..1 또는 -1..1).

export const SAMPLE_RATE = 44100;

export type WaveType = 'square' | 'sawtooth' | 'sine' | 'noise' | 'triangle';

// 앞 4개는 sfxr 원본 순서 — 프리셋/랜덤의 정수 매핑이 이 순서에 의존한다.
// triangle은 Bfxr가 추가한 파형으로 맨 뒤에 확장 (부드러운 저음, 패미컴 베이스 채널).
export const WAVE_TYPES: WaveType[] = ['square', 'sawtooth', 'sine', 'noise', 'triangle'];

export interface SfxParams {
  waveType: WaveType;
  /** 엔벨로프 (0..1) */
  attack: number;
  sustain: number;
  punch: number;
  decay: number;
  /** 주파수 — baseFreq/freqLimit은 0..1, 슬라이드는 -1..1 */
  baseFreq: number;
  freqLimit: number;
  freqSlide: number;
  freqDeltaSlide: number;
  /** 비브라토 (0..1) */
  vibratoDepth: number;
  vibratoSpeed: number;
  /** 아르페지오 — arpMod는 -1..1(음정 도약 방향), arpSpeed는 0..1 */
  arpMod: number;
  arpSpeed: number;
  /** 사각파 듀티 — duty는 0..1, dutySweep은 -1..1 */
  duty: number;
  dutySweep: number;
  /** 리피트 (0..1, 0이면 없음) */
  repeatSpeed: number;
  /** 페이저 (-1..1) */
  phaserOffset: number;
  phaserSweep: number;
  /** 필터 — 컷오프/레저넌스는 0..1, 스위프는 -1..1 */
  lpfCutoff: number;
  lpfSweep: number;
  lpfResonance: number;
  hpfCutoff: number;
  hpfSweep: number;
}

export type NumericParamKey = Exclude<keyof SfxParams, 'waveType'>;

export interface ParamMeta {
  key: NumericParamKey;
  label: string;
  /** 최소값 (-1 또는 0). 최대값은 전부 1. */
  min: -1 | 0;
}

/** UI 슬라이더 렌더링과 mutate의 범위 클램프가 함께 쓰는 파라미터 메타데이터 */
export const PARAM_GROUPS: { title: string; params: ParamMeta[] }[] = [
  {
    title: '엔벨로프',
    params: [
      { key: 'attack', label: '어택', min: 0 },
      { key: 'sustain', label: '서스테인', min: 0 },
      { key: 'punch', label: '펀치', min: 0 },
      { key: 'decay', label: '디케이', min: 0 },
    ],
  },
  {
    title: '주파수',
    params: [
      { key: 'baseFreq', label: '시작 주파수', min: 0 },
      { key: 'freqLimit', label: '최저 한계 (도달 시 종료)', min: 0 },
      { key: 'freqSlide', label: '슬라이드', min: -1 },
      { key: 'freqDeltaSlide', label: '슬라이드 가속', min: -1 },
    ],
  },
  {
    title: '비브라토',
    params: [
      { key: 'vibratoDepth', label: '깊이', min: 0 },
      { key: 'vibratoSpeed', label: '속도', min: 0 },
    ],
  },
  {
    title: '아르페지오',
    params: [
      { key: 'arpMod', label: '음정 도약', min: -1 },
      { key: 'arpSpeed', label: '속도', min: 0 },
    ],
  },
  {
    title: '사각파 듀티',
    params: [
      { key: 'duty', label: '듀티', min: 0 },
      { key: 'dutySweep', label: '스위프', min: -1 },
    ],
  },
  {
    title: '리피트',
    params: [{ key: 'repeatSpeed', label: '반복 속도', min: 0 }],
  },
  {
    title: '페이저',
    params: [
      { key: 'phaserOffset', label: '오프셋', min: -1 },
      { key: 'phaserSweep', label: '스위프', min: -1 },
    ],
  },
  {
    title: '필터',
    params: [
      { key: 'lpfCutoff', label: '로우패스 컷오프', min: 0 },
      { key: 'lpfSweep', label: '로우패스 스위프', min: -1 },
      { key: 'lpfResonance', label: '로우패스 레저넌스', min: 0 },
      { key: 'hpfCutoff', label: '하이패스 컷오프', min: 0 },
      { key: 'hpfSweep', label: '하이패스 스위프', min: -1 },
    ],
  },
];

/** sfxr의 ResetParams와 같은 기본값 */
export function defaultParams(): SfxParams {
  return {
    waveType: 'square',
    attack: 0,
    sustain: 0.3,
    punch: 0,
    decay: 0.4,
    baseFreq: 0.3,
    freqLimit: 0,
    freqSlide: 0,
    freqDeltaSlide: 0,
    vibratoDepth: 0,
    vibratoSpeed: 0,
    arpMod: 0,
    arpSpeed: 0,
    duty: 0,
    dutySweep: 0,
    repeatSpeed: 0,
    phaserOffset: 0,
    phaserSweep: 0,
    lpfCutoff: 1,
    lpfSweep: 0,
    lpfResonance: 0,
    hpfCutoff: 0,
    hpfSweep: 0,
  };
}

// ---------- 합성 ----------

/**
 * 파라미터로 모노 샘플(Float32Array, [-1,1])을 합성한다.
 * sfxr의 SynthSample을 그대로 옮긴 것으로, 내부적으로 8배 오버샘플링한다.
 */
export function synthesize(params: SfxParams): Float32Array {
  // 엔벨로프 3단계 길이(샘플). 0이면 스테이지 진행 나눗셈에서 NaN이 되므로 1로 바닥 처리.
  const envelopeLengths = [
    Math.max(1, Math.floor(params.attack ** 2 * 100000)),
    Math.max(1, Math.floor(params.sustain ** 2 * 100000)),
    Math.max(1, Math.floor(params.decay ** 2 * 100000)),
  ];
  const output = new Float32Array(envelopeLengths[0] + envelopeLengths[1] + envelopeLengths[2]);

  // 주파수·듀티·아르페지오 상태 — 리피트가 발동하면 이 블록만 재초기화된다
  let periodExact = 0;
  let maxPeriod = 0;
  let slide = 0;
  let deltaSlide = 0;
  let squareDuty = 0;
  let squareDutySweep = 0;
  let arpeggioTime = 0;
  let arpeggioLimit = 0;
  let arpeggioMultiplier = 0;

  const restart = () => {
    periodExact = 100 / (params.baseFreq ** 2 + 0.001);
    maxPeriod = 100 / (params.freqLimit ** 2 + 0.001);
    slide = 1 - params.freqSlide ** 3 * 0.01;
    deltaSlide = -(params.freqDeltaSlide ** 3) * 0.000001;
    squareDuty = 0.5 - params.duty * 0.5;
    squareDutySweep = -params.dutySweep * 0.00005;
    arpeggioMultiplier =
      params.arpMod >= 0 ? 1 - params.arpMod ** 2 * 0.9 : 1 + params.arpMod ** 2 * 10;
    arpeggioTime = 0;
    arpeggioLimit =
      params.arpSpeed === 1 ? 0 : Math.floor((1 - params.arpSpeed) ** 2 * 20000 + 32);
  };
  restart();

  // 오실레이터·필터·페이저 상태 — 리피트에도 유지된다
  let phase = 0;
  const noiseBuffer = new Float32Array(32);
  const refillNoise = () => {
    for (let i = 0; i < noiseBuffer.length; i++) noiseBuffer[i] = Math.random() * 2 - 1;
  };
  refillNoise();

  let filterPos = 0;
  let filterDeltaPos = 0;
  let filterWidth = params.lpfCutoff ** 3 * 0.1;
  const filterWidthDelta = 1 + params.lpfSweep * 0.0001;
  const filterDamping = Math.min(
    0.8,
    (5 / (1 + params.lpfResonance ** 2 * 20)) * (0.01 + filterWidth),
  );
  let filterHighPassPos = 0;
  let filterHighPass = params.hpfCutoff ** 2 * 0.1;
  const filterHighPassDelta = 1 + params.hpfSweep * 0.0003;

  let vibratoPhase = 0;
  const vibratoSpeed = params.vibratoSpeed ** 2 * 0.01;
  const vibratoAmplitude = params.vibratoDepth * 0.5;

  let envelopeStage = 0;
  let envelopeTime = 0;

  let phaserPhase = params.phaserOffset ** 2 * 1020 * (params.phaserOffset < 0 ? -1 : 1);
  const phaserDelta = params.phaserSweep ** 2 * (params.phaserSweep < 0 ? -1 : 1);
  let phaserIndex = 0;
  let phaserBufferPos = 0;
  const phaserBuffer = new Float32Array(1024);

  let repeatTime = 0;
  const repeatLimit =
    params.repeatSpeed === 0 ? 0 : Math.floor((1 - params.repeatSpeed) ** 2 * 20000 + 32);

  let producedCount = 0;
  for (let i = 0; i < output.length; i++) {
    repeatTime++;
    if (repeatLimit !== 0 && repeatTime >= repeatLimit) {
      repeatTime = 0;
      restart();
    }

    arpeggioTime++;
    if (arpeggioLimit !== 0 && arpeggioTime >= arpeggioLimit) {
      arpeggioLimit = 0;
      periodExact *= arpeggioMultiplier;
    }

    slide += deltaSlide;
    periodExact *= slide;
    if (periodExact > maxPeriod) {
      periodExact = maxPeriod;
      // 최저 주파수 한계에 도달하면 소리를 끝낸다 (레이저의 뚝 끊기는 느낌)
      if (params.freqLimit > 0) break;
    }

    let currentPeriod = periodExact;
    if (vibratoAmplitude > 0) {
      vibratoPhase += vibratoSpeed;
      currentPeriod = periodExact * (1 + Math.sin(vibratoPhase) * vibratoAmplitude);
    }
    const period = Math.max(8, Math.floor(currentPeriod));

    squareDuty = Math.min(0.5, Math.max(0, squareDuty + squareDutySweep));

    envelopeTime++;
    if (envelopeTime > envelopeLengths[envelopeStage]) {
      envelopeTime = 0;
      envelopeStage++;
      if (envelopeStage === 3) break;
    }
    let envelopeVolume: number;
    if (envelopeStage === 0) {
      envelopeVolume = envelopeTime / envelopeLengths[0];
    } else if (envelopeStage === 1) {
      envelopeVolume = 1 + (1 - envelopeTime / envelopeLengths[1]) * 2 * params.punch;
    } else {
      envelopeVolume = 1 - envelopeTime / envelopeLengths[2];
    }

    phaserPhase += phaserDelta;
    phaserIndex = Math.min(1023, Math.abs(Math.trunc(phaserPhase)));

    filterHighPass = Math.min(0.1, Math.max(0.00001, filterHighPass * filterHighPassDelta));

    // 8배 오버샘플링: 한 출력 샘플당 내부 스텝 8번의 평균
    let superSample = 0;
    for (let step = 0; step < 8; step++) {
      phase++;
      if (phase >= period) {
        phase %= period;
        if (params.waveType === 'noise') refillNoise();
      }
      const phaseRatio = phase / period;
      let sample: number;
      switch (params.waveType) {
        case 'square':
          sample = phaseRatio < squareDuty ? 0.5 : -0.5;
          break;
        case 'sawtooth':
          sample = 1 - phaseRatio * 2;
          break;
        case 'sine':
          sample = Math.sin(phaseRatio * 2 * Math.PI);
          break;
        case 'noise':
          sample = noiseBuffer[Math.floor(phaseRatio * 32)];
          break;
        case 'triangle':
          sample = 1 - Math.abs(phaseRatio * 4 - 2);
          break;
      }

      // 로우패스 (공진 포함)
      const previousFilterPos = filterPos;
      filterWidth = Math.min(0.1, Math.max(0, filterWidth * filterWidthDelta));
      if (params.lpfCutoff !== 1) {
        filterDeltaPos += (sample - filterPos) * filterWidth;
        filterDeltaPos -= filterDeltaPos * filterDamping;
      } else {
        filterPos = sample;
        filterDeltaPos = 0;
      }
      filterPos += filterDeltaPos;

      // 하이패스
      filterHighPassPos += filterPos - previousFilterPos;
      filterHighPassPos -= filterHighPassPos * filterHighPass;
      sample = filterHighPassPos;

      // 페이저 — 과거 샘플을 어긋난 위치에서 더해 금속성 간섭을 만든다
      phaserBuffer[phaserBufferPos] = sample;
      sample += phaserBuffer[(phaserBufferPos - phaserIndex + 1024) & 1023];
      phaserBufferPos = (phaserBufferPos + 1) & 1023;

      superSample += sample * envelopeVolume;
    }

    output[i] = Math.max(-1, Math.min(1, superSample / 8));
    producedCount = i + 1;
  }

  return output.subarray(0, producedCount);
}

// ---------- 프리셋 (sfxr 원본의 랜덤 범위) ----------

/** frnd(x) — 0 이상 x 미만의 실수 */
const randomFloat = (max: number) => Math.random() * max;

/** rnd(n) — 0..n의 정수 (양 끝 포함) */
const randomInt = (max: number) => Math.floor(Math.random() * (max + 1));

const coinFlip = () => randomInt(1) === 1;

export function presetCoin(): SfxParams {
  const params = defaultParams();
  params.baseFreq = 0.4 + randomFloat(0.5);
  params.sustain = randomFloat(0.1);
  params.decay = 0.1 + randomFloat(0.4);
  params.punch = 0.3 + randomFloat(0.3);
  if (coinFlip()) {
    params.arpSpeed = 0.5 + randomFloat(0.2);
    params.arpMod = 0.2 + randomFloat(0.4);
  }
  return params;
}

export function presetLaser(): SfxParams {
  const params = defaultParams();
  let wave = randomInt(2);
  if (wave === 2 && coinFlip()) wave = randomInt(1);
  params.waveType = WAVE_TYPES[wave];
  params.baseFreq = 0.5 + randomFloat(0.5);
  params.freqLimit = Math.max(0.2, params.baseFreq - 0.2 - randomFloat(0.6));
  params.freqSlide = -0.15 - randomFloat(0.2);
  if (randomInt(2) === 0) {
    params.baseFreq = 0.3 + randomFloat(0.6);
    params.freqLimit = randomFloat(0.1);
    params.freqSlide = -0.35 - randomFloat(0.3);
  }
  if (coinFlip()) {
    params.duty = randomFloat(0.5);
    params.dutySweep = randomFloat(0.2);
  } else {
    params.duty = 0.4 + randomFloat(0.5);
    params.dutySweep = -randomFloat(0.7);
  }
  params.sustain = 0.1 + randomFloat(0.2);
  params.decay = randomFloat(0.4);
  if (coinFlip()) params.punch = randomFloat(0.3);
  if (randomInt(2) === 0) {
    params.phaserOffset = randomFloat(0.2);
    params.phaserSweep = -randomFloat(0.2);
  }
  if (coinFlip()) params.hpfCutoff = randomFloat(0.3);
  return params;
}

export function presetExplosion(): SfxParams {
  const params = defaultParams();
  params.waveType = 'noise';
  if (coinFlip()) {
    params.baseFreq = 0.1 + randomFloat(0.4);
    params.freqSlide = -0.1 + randomFloat(0.4);
  } else {
    params.baseFreq = 0.2 + randomFloat(0.7);
    params.freqSlide = -0.2 - randomFloat(0.2);
  }
  params.baseFreq *= params.baseFreq;
  if (randomInt(4) === 0) params.freqSlide = 0;
  if (randomInt(2) === 0) params.repeatSpeed = 0.3 + randomFloat(0.5);
  params.sustain = 0.1 + randomFloat(0.3);
  params.decay = randomFloat(0.5);
  params.punch = 0.2 + randomFloat(0.6);
  if (coinFlip()) {
    params.phaserOffset = -0.3 + randomFloat(0.9);
    params.phaserSweep = -randomFloat(0.3);
  }
  if (coinFlip()) {
    params.vibratoDepth = randomFloat(0.7);
    params.vibratoSpeed = randomFloat(0.6);
  }
  if (randomInt(2) === 0) {
    params.arpSpeed = 0.6 + randomFloat(0.3);
    params.arpMod = 0.8 - randomFloat(1.6);
  }
  return params;
}

export function presetPowerup(): SfxParams {
  const params = defaultParams();
  if (coinFlip()) params.waveType = 'sawtooth';
  else params.duty = randomFloat(0.6);
  params.baseFreq = 0.2 + randomFloat(0.3);
  if (coinFlip()) {
    params.freqSlide = 0.1 + randomFloat(0.4);
    params.repeatSpeed = 0.4 + randomFloat(0.4);
  } else {
    params.freqSlide = 0.05 + randomFloat(0.2);
    if (coinFlip()) {
      params.vibratoDepth = randomFloat(0.7);
      params.vibratoSpeed = randomFloat(0.6);
    }
  }
  params.sustain = randomFloat(0.4);
  params.decay = 0.1 + randomFloat(0.4);
  return params;
}

export function presetHit(): SfxParams {
  const params = defaultParams();
  let wave = randomInt(2);
  if (wave === 2) wave = 3;
  params.waveType = WAVE_TYPES[wave];
  if (params.waveType === 'square') params.duty = randomFloat(0.6);
  params.baseFreq = 0.2 + randomFloat(0.6);
  params.freqSlide = -0.3 - randomFloat(0.4);
  params.sustain = randomFloat(0.1);
  params.decay = 0.1 + randomFloat(0.2);
  if (coinFlip()) params.hpfCutoff = randomFloat(0.3);
  return params;
}

export function presetJump(): SfxParams {
  const params = defaultParams();
  params.duty = randomFloat(0.6);
  params.baseFreq = 0.3 + randomFloat(0.3);
  params.freqSlide = 0.1 + randomFloat(0.2);
  params.sustain = 0.1 + randomFloat(0.3);
  params.decay = 0.1 + randomFloat(0.2);
  if (coinFlip()) params.hpfCutoff = randomFloat(0.3);
  if (coinFlip()) params.lpfCutoff = 1 - randomFloat(0.6);
  return params;
}

export function presetBlip(): SfxParams {
  const params = defaultParams();
  params.waveType = WAVE_TYPES[randomInt(1)];
  if (params.waveType === 'square') params.duty = randomFloat(0.6);
  params.baseFreq = 0.2 + randomFloat(0.4);
  params.sustain = 0.1 + randomFloat(0.1);
  params.decay = randomFloat(0.2);
  params.hpfCutoff = 0.1;
  return params;
}

// ---------- 랜덤 · 변형 ----------

const clampToRange = (value: number, min: number) => Math.min(1, Math.max(min, value));

/**
 * 전체 파라미터를 무작위로 생성한다 (sfxr의 Randomize).
 * 원본은 일부 파라미터가 음수까지 나올 수 있는데(사실상 "효과 없음" 취지),
 * UI 슬라이더 범위에 맞춰 마지막에 클램프한다.
 */
export function randomize(): SfxParams {
  const params = defaultParams();
  params.waveType = WAVE_TYPES[randomInt(3)];
  params.baseFreq = (randomFloat(2) - 1) ** 2;
  if (coinFlip()) params.baseFreq = (randomFloat(2) - 1) ** 3 + 0.5;
  params.freqLimit = 0;
  params.freqSlide = (randomFloat(2) - 1) ** 5;
  if (params.baseFreq > 0.7 && params.freqSlide > 0.2) params.freqSlide = -params.freqSlide;
  if (params.baseFreq < 0.2 && params.freqSlide < -0.05) params.freqSlide = -params.freqSlide;
  params.freqDeltaSlide = (randomFloat(2) - 1) ** 3;
  params.duty = randomFloat(2) - 1;
  params.dutySweep = (randomFloat(2) - 1) ** 3;
  params.vibratoDepth = (randomFloat(2) - 1) ** 3;
  params.vibratoSpeed = randomFloat(2) - 1;
  params.attack = (randomFloat(2) - 1) ** 3;
  params.sustain = (randomFloat(2) - 1) ** 2;
  params.decay = randomFloat(2) - 1;
  params.punch = randomFloat(0.8) ** 2;
  if (params.attack + params.sustain + params.decay < 0.2) {
    params.sustain += 0.2 + randomFloat(0.3);
    params.decay += 0.2 + randomFloat(0.3);
  }
  params.lpfResonance = randomFloat(2) - 1;
  params.lpfCutoff = 1 - randomFloat(1) ** 3;
  params.lpfSweep = (randomFloat(2) - 1) ** 3;
  if (params.lpfCutoff < 0.1 && params.lpfSweep < -0.05) params.lpfSweep = -params.lpfSweep;
  params.hpfCutoff = randomFloat(1) ** 5;
  params.hpfSweep = (randomFloat(2) - 1) ** 5;
  params.phaserOffset = (randomFloat(2) - 1) ** 3;
  params.phaserSweep = (randomFloat(2) - 1) ** 3;
  params.repeatSpeed = randomFloat(2) - 1;
  params.arpSpeed = randomFloat(2) - 1;
  params.arpMod = randomFloat(2) - 1;
  for (const group of PARAM_GROUPS) {
    for (const meta of group.params) {
      params[meta.key] = clampToRange(params[meta.key], meta.min);
    }
  }
  return params;
}

/**
 * 현재 소리를 조금씩 흔들어 비슷한 변종을 만든다 (sfxr의 Mutate). 파형은 유지.
 * freqLimit은 제외한다 — 시작 주파수보다 높아지면 첫 샘플에서 바로 종료되어
 * 무음이 되기 때문 (원본 sfxr도 건드리지 않는다).
 */
export function mutate(source: SfxParams): SfxParams {
  const params = { ...source };
  for (const group of PARAM_GROUPS) {
    for (const meta of group.params) {
      if (meta.key === 'freqLimit') continue;
      if (coinFlip()) {
        params[meta.key] = clampToRange(params[meta.key] + randomFloat(0.1) - 0.05, meta.min);
      }
    }
  }
  return params;
}
