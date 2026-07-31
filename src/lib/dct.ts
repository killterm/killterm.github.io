// 8×8 2D DCT-II / IDCT-III — JPEG가 쓰는 것과 같은 변환.
//
// 브라우저는 JPEG의 양자화 계수에 접근할 수 없으므로, 픽셀에서 직접 DCT를 계산해
// 중간 주파수 계수에 데이터를 심는다. 8×8은 JPEG 블록 격자와 일치해 이후 JPEG
// 재압축을 거쳐도 계수 위치가 어긋나지 않는다.

export const BLOCK_SIZE = 8;

// cos((2x+1)·u·π/16) 표 — 블록마다 다시 계산하지 않는다
const COSINE_TABLE = (() => {
  const table = new Float64Array(BLOCK_SIZE * BLOCK_SIZE);
  for (let u = 0; u < BLOCK_SIZE; u++) {
    for (let x = 0; x < BLOCK_SIZE; x++) {
      table[u * BLOCK_SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * BLOCK_SIZE));
    }
  }
  return table;
})();

const scale = (index: number) => (index === 0 ? Math.SQRT1_2 : 1);

/** 8×8 픽셀 블록(길이 64) → DCT 계수(길이 64) */
export function forwardDct8(block: ArrayLike<number>): Float64Array {
  const output = new Float64Array(64);
  for (let v = 0; v < BLOCK_SIZE; v++) {
    for (let u = 0; u < BLOCK_SIZE; u++) {
      let sum = 0;
      for (let y = 0; y < BLOCK_SIZE; y++) {
        for (let x = 0; x < BLOCK_SIZE; x++) {
          sum +=
            block[y * BLOCK_SIZE + x] *
            COSINE_TABLE[u * BLOCK_SIZE + x] *
            COSINE_TABLE[v * BLOCK_SIZE + y];
        }
      }
      output[v * BLOCK_SIZE + u] = 0.25 * scale(u) * scale(v) * sum;
    }
  }
  return output;
}

/** DCT 계수(길이 64) → 8×8 픽셀 블록(길이 64) */
export function inverseDct8(coefficients: ArrayLike<number>): Float64Array {
  const output = new Float64Array(64);
  for (let y = 0; y < BLOCK_SIZE; y++) {
    for (let x = 0; x < BLOCK_SIZE; x++) {
      let sum = 0;
      for (let v = 0; v < BLOCK_SIZE; v++) {
        for (let u = 0; u < BLOCK_SIZE; u++) {
          sum +=
            scale(u) *
            scale(v) *
            coefficients[v * BLOCK_SIZE + u] *
            COSINE_TABLE[u * BLOCK_SIZE + x] *
            COSINE_TABLE[v * BLOCK_SIZE + y];
        }
      }
      output[y * BLOCK_SIZE + x] = 0.25 * sum;
    }
  }
  return output;
}
