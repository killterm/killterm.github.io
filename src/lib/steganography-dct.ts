// 이미지 주파수 영역(DCT) 스테가노그래피.
//
// LSB와 결정적으로 다른 성질: 나중에 JPEG로 다시 저장하거나 약한 잡음이 섞여도
// 살아남는다. 픽셀의 최하위 비트가 아니라 8×8 블록의 중간 주파수 계수를 크게
// 흔들어 심기 때문이다.
//
// 방식은 QIM(양자화 인덱스 변조): 계수를 Δ 격자에 맞춰 반올림할 때 비트에 따라
// 짝수/홀수 격자로 보낸다. 원본 없이 추출할 수 있다(blind extraction).
// 저주파는 눈에 띄고 고주파는 압축에 먼저 버려지므로 중간 주파수만 쓴다.

import { BLOCK_SIZE, forwardDct8, inverseDct8 } from './dct.ts';
import { frameMessage, parseFrame, peekFrameSize, type StegPayload } from './steganography-frame.ts';

/** 양자화 간격 — 크면 견고하고 화질 손해가 커진다 */
export const QUANTIZATION_STEP = 32;
/** 비트당 반복 횟수 (다수결로 읽어 압축 잡음을 이긴다) */
export const REDUNDANCY = 3;

/**
 * 쓰는 계수 위치(지그재그 중간대). 저주파(눈에 띔)와 고주파(압축에 버려짐)를 피한다.
 * 블록 하나에 3비트씩 넣는다.
 */
const COEFFICIENT_SLOTS = [
  2 * BLOCK_SIZE + 1, // (u=1, v=2)
  1 * BLOCK_SIZE + 2, // (u=2, v=1)
  2 * BLOCK_SIZE + 2, // (u=2, v=2)
];

/** RGBA 픽셀 배열에서 파랑 채널만 8×8 블록 목록으로 뽑는다 (파랑은 눈이 가장 둔감하다) */
function blockPositions(width: number, height: number): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  for (let y = 0; y + BLOCK_SIZE <= height; y += BLOCK_SIZE) {
    for (let x = 0; x + BLOCK_SIZE <= width; x += BLOCK_SIZE) {
      positions.push({ x, y });
    }
  }
  return positions;
}

const CHANNEL_OFFSET = 2; // B

function readBlock(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  x: number,
  y: number,
): Float64Array {
  const block = new Float64Array(64);
  for (let row = 0; row < BLOCK_SIZE; row++) {
    for (let column = 0; column < BLOCK_SIZE; column++) {
      const index = ((y + row) * width + (x + column)) * 4 + CHANNEL_OFFSET;
      // DCT는 0 중심 값에서 계산한다 (JPEG와 동일)
      block[row * BLOCK_SIZE + column] = pixels[index] - 128;
    }
  }
  return block;
}

function writeBlock(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  x: number,
  y: number,
  block: ArrayLike<number>,
): void {
  for (let row = 0; row < BLOCK_SIZE; row++) {
    for (let column = 0; column < BLOCK_SIZE; column++) {
      const index = ((y + row) * width + (x + column)) * 4 + CHANNEL_OFFSET;
      pixels[index] = Math.max(0, Math.min(255, Math.round(block[row * BLOCK_SIZE + column] + 128)));
    }
  }
}

/** QIM: 계수를 비트에 맞는 Δ 격자 중심으로 옮긴다 */
function quantizeToBit(value: number, bit: number): number {
  const step = QUANTIZATION_STEP;
  const index = Math.round(value / step);
  // 격자 인덱스의 홀짝을 비트에 맞춘다 (가장 가까운 쪽으로)
  if (((index % 2) + 2) % 2 === bit) return index * step;
  const lower = (index - 1) * step;
  const upper = (index + 1) * step;
  return Math.abs(value - lower) <= Math.abs(value - upper) ? lower : upper;
}

function bitFromCoefficient(value: number): number {
  const index = Math.round(value / QUANTIZATION_STEP);
  return ((index % 2) + 2) % 2;
}

/** 이 이미지에 심을 수 있는 최대 바이트 수 */
export function dctCapacityBytes(width: number, height: number): number {
  const slots = blockPositions(width, height).length * COEFFICIENT_SLOTS.length;
  return Math.floor(slots / REDUNDANCY / 8);
}

/** 픽셀 배열(RGBA)에 페이로드를 심는다. 픽셀은 제자리에서 수정된다. */
export function dctEmbed(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  payload: StegPayload,
): void {
  const frame = frameMessage(payload);
  const bits: number[] = [];
  for (const byte of frame) {
    for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1);
  }
  const positions = blockPositions(width, height);
  const totalSlots = positions.length * COEFFICIENT_SLOTS.length;
  if (bits.length * REDUNDANCY > totalSlots) {
    throw new Error(
      `용량이 부족합니다. 필요 ${frame.length.toLocaleString()}바이트 / 가능 ${dctCapacityBytes(width, height).toLocaleString()}바이트`,
    );
  }

  // 같은 비트를 REDUNDANCY번 이어서 쓴다 (연속 슬롯 → 추출도 같은 순서)
  let slot = 0;
  const writes = new Map<number, { block: Float64Array; dirty: boolean }>();
  const blockCache = (blockIndex: number) => {
    let entry = writes.get(blockIndex);
    if (!entry) {
      const { x, y } = positions[blockIndex];
      entry = { block: forwardDct8(readBlock(pixels, width, x, y)), dirty: false };
      writes.set(blockIndex, entry);
    }
    return entry;
  };

  for (const bit of bits) {
    for (let repeat = 0; repeat < REDUNDANCY; repeat++) {
      const blockIndex = Math.floor(slot / COEFFICIENT_SLOTS.length);
      const coefficientIndex = COEFFICIENT_SLOTS[slot % COEFFICIENT_SLOTS.length];
      const entry = blockCache(blockIndex);
      entry.block[coefficientIndex] = quantizeToBit(entry.block[coefficientIndex], bit);
      entry.dirty = true;
      slot++;
    }
  }

  for (const [blockIndex, entry] of writes) {
    if (!entry.dirty) continue;
    const { x, y } = positions[blockIndex];
    writeBlock(pixels, width, x, y, inverseDct8(entry.block));
  }
}

/** 픽셀 배열(RGBA)에서 심어진 페이로드를 꺼낸다. 없으면 null. */
export function dctExtract(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): StegPayload | null {
  const positions = blockPositions(width, height);
  const totalSlots = positions.length * COEFFICIENT_SLOTS.length;
  const maxBits = Math.floor(totalSlots / REDUNDANCY);

  // 블록 DCT는 한 번만 계산해 캐시한다
  const cache = new Map<number, Float64Array>();
  const coefficientAt = (slot: number) => {
    const blockIndex = Math.floor(slot / COEFFICIENT_SLOTS.length);
    let block = cache.get(blockIndex);
    if (!block) {
      const { x, y } = positions[blockIndex];
      block = forwardDct8(readBlock(pixels, width, x, y));
      cache.set(blockIndex, block);
    }
    return block[COEFFICIENT_SLOTS[slot % COEFFICIENT_SLOTS.length]];
  };

  const readBytes = (count: number): Uint8Array => {
    const output = new Uint8Array(count);
    for (let byteIndex = 0; byteIndex < count; byteIndex++) {
      let byte = 0;
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        const bitPosition = byteIndex * 8 + bitIndex;
        if (bitPosition >= maxBits) return output.subarray(0, byteIndex);
        // REDUNDANCY개 슬롯의 다수결
        let ones = 0;
        for (let repeat = 0; repeat < REDUNDANCY; repeat++) {
          ones += bitFromCoefficient(coefficientAt(bitPosition * REDUNDANCY + repeat));
        }
        byte = (byte << 1) | (ones * 2 > REDUNDANCY ? 1 : 0);
      }
      output[byteIndex] = byte;
    }
    return output;
  };

  const maxHeaderBytes = Math.min(Math.floor(maxBits / 8), 266);
  const size = peekFrameSize(readBytes(maxHeaderBytes));
  if (size === null || size * 8 > maxBits) return null;
  return parseFrame(readBytes(size));
}
