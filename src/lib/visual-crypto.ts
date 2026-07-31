// 시각 암호 (Naor–Shamir 2-of-2 비밀 분산).
//
// 비밀 이미지를 무작위로 보이는 조각(share) 두 장으로 나눈다. 한 장만으로는
// 아무 정보도 얻을 수 없고(정보이론적으로 안전), 두 장을 겹쳐야 그림이 드러난다.
// 계산이 필요 없는 "복호" — 인쇄해서 겹쳐도 보인다 — 가 이 기법의 특징이다.
//
// 픽셀 하나를 2×2 서브픽셀로 확장한다. 흰 픽셀은 두 share에 같은 패턴을 넣어
// 겹치면 절반만 검게 되고, 검은 픽셀은 서로 보수 패턴을 넣어 전부 검게 된다.

/** 2×2 안에 검정 2개가 들어가는 패턴 6가지 (검정 위치를 1로 표기) */
const PATTERNS = [
  [1, 1, 0, 0],
  [0, 0, 1, 1],
  [1, 0, 1, 0],
  [0, 1, 0, 1],
  [1, 0, 0, 1],
  [0, 1, 1, 0],
];

export interface Shares {
  width: number;
  height: number;
  /** RGBA 픽셀 (원본의 2배 크기) */
  first: Uint8ClampedArray<ArrayBuffer>;
  second: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * 흑백 판정된 비밀 이미지(밝기 배열, 0~255)를 share 두 장으로 나눈다.
 * threshold보다 어두운 픽셀을 "검정"으로 본다.
 */
export function splitShares(
  brightness: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 128,
): Shares {
  const outputWidth = width * 2;
  const outputHeight = height * 2;
  const first = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const second = new Uint8ClampedArray(outputWidth * outputHeight * 4);

  const paint = (
    target: Uint8ClampedArray,
    x: number,
    y: number,
    pattern: number[],
    invert: boolean,
  ) => {
    for (let subY = 0; subY < 2; subY++) {
      for (let subX = 0; subX < 2; subX++) {
        const bit = pattern[subY * 2 + subX] ^ (invert ? 1 : 0);
        const index = ((y * 2 + subY) * outputWidth + (x * 2 + subX)) * 4;
        const value = bit ? 0 : 255;
        target[index] = value;
        target[index + 1] = value;
        target[index + 2] = value;
        target[index + 3] = 255;
      }
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBlack = brightness[y * width + x] < threshold;
      const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
      paint(first, x, y, pattern, false);
      // 검정이면 보수 패턴(겹치면 전부 검정), 흰색이면 같은 패턴(절반만 검정)
      paint(second, x, y, pattern, isBlack);
    }
  }
  return { width: outputWidth, height: outputHeight, first, second };
}

/**
 * share 두 장을 겹친다 — 종이를 겹치는 것과 같은 OR(어두운 쪽 우선) 연산.
 * 크기가 다르면 null.
 */
export function overlayShares(
  first: Uint8ClampedArray | Uint8Array,
  second: Uint8ClampedArray | Uint8Array,
): Uint8ClampedArray<ArrayBuffer> | null {
  if (first.length !== second.length) return null;
  const output = new Uint8ClampedArray(first.length);
  for (let i = 0; i < first.length; i += 4) {
    const value = Math.min(first[i], second[i]);
    output[i] = value;
    output[i + 1] = value;
    output[i + 2] = value;
    output[i + 3] = 255;
  }
  return output;
}

/**
 * 겹친 결과에서 원본 크기의 흑백 이미지를 되살린다 (2×2 블록의 검정 수로 판정).
 * 검정 4개 = 원래 검정, 2개 = 원래 흰색.
 */
export function recoverFromOverlay(
  overlay: Uint8ClampedArray | Uint8Array,
  overlayWidth: number,
  overlayHeight: number,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const width = Math.floor(overlayWidth / 2);
  const height = Math.floor(overlayHeight / 2);
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let blacks = 0;
      for (let subY = 0; subY < 2; subY++) {
        for (let subX = 0; subX < 2; subX++) {
          const index = ((y * 2 + subY) * overlayWidth + (x * 2 + subX)) * 4;
          if (overlay[index] < 128) blacks++;
        }
      }
      data[y * width + x] = blacks >= 4 ? 0 : 255;
    }
  }
  return { data, width, height };
}
