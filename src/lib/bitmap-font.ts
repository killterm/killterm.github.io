// 글리프 모델과 픽셀 → 컨투어 변환.
//
// 픽셀 편집과 벡터 편집을 한 타입으로 담는다. TTF 라이터는 컨투어만 보므로,
// 벡터 모드를 나중에 얹어도 내보내기 경로는 그대로다.

import type { Contour, GlyphPoint } from './ttf-encode.ts';

export type { Contour, GlyphPoint };

export type Glyph =
  | { kind: 'pixel'; bits: Uint8Array }
  | { kind: 'outline'; contours: Contour[] };

/** 픽셀 한 칸이 차지하는 폰트 단위 — unitsPerEm = grid × PIXEL_UNITS */
export const PIXEL_UNITS = 64;

export const unitsPerEmFor = (grid: number) => grid * PIXEL_UNITS;

export function emptyPixelGlyph(grid: number): Glyph {
  return { kind: 'pixel', bits: new Uint8Array(grid * grid) };
}

export const pixelAt = (bits: Uint8Array, grid: number, x: number, y: number) =>
  x >= 0 && y >= 0 && x < grid && y < grid ? bits[y * grid + x] : 0;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 칠한 픽셀을 직사각형 묶음으로 분해한다 (그리디).
 * 한 픽셀 = 사각형 하나로 두면 점이 네 배로 늘어나므로, 가로로 이어진 구간을 묶고
 * 아래 행이 같은 구간이면 세로로도 합친다. 8×8 대문자 하나가 사각형 몇 개로 줄어든다.
 */
export function pixelsToRects(bits: Uint8Array, grid: number): Rect[] {
  const used = new Uint8Array(bits.length);
  const rects: Rect[] = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const index = y * grid + x;
      if (!bits[index] || used[index]) continue;
      // 가로로 최대한 늘린다
      let width = 1;
      while (
        x + width < grid &&
        bits[y * grid + x + width] &&
        !used[y * grid + x + width]
      ) {
        width++;
      }
      // 같은 폭이 이어지는 동안 아래로 늘린다
      let height = 1;
      while (y + height < grid) {
        let rowMatches = true;
        for (let offset = 0; offset < width; offset++) {
          const below = (y + height) * grid + x + offset;
          if (!bits[below] || used[below]) {
            rowMatches = false;
            break;
          }
        }
        if (!rowMatches) break;
        height++;
      }
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          used[(y + row) * grid + x + column] = 1;
        }
      }
      rects.push({ x, y, width, height });
    }
  }
  return rects;
}

/**
 * 글리프를 폰트 좌표 컨투어로 바꾼다.
 * 픽셀 좌표는 위에서 아래로 세지만 폰트 좌표는 아래에서 위로 올라가므로 y를 뒤집고,
 * baselineRow(그 행의 위쪽 선이 베이스라인)를 기준으로 원점을 맞춘다.
 */
export function glyphToContours(glyph: Glyph, grid: number, baselineRow: number): Contour[] {
  if (glyph.kind === 'outline') return glyph.contours;

  const toUnits = (value: number) => value * PIXEL_UNITS;
  const baselineY = baselineRow;
  return pixelsToRects(glyph.bits, grid).map((rect) => {
    const left = toUnits(rect.x);
    const right = toUnits(rect.x + rect.width);
    // 픽셀 행 r의 위쪽 = 베이스라인에서 (baselineY - r)칸 위
    const top = toUnits(baselineY - rect.y);
    const bottom = toUnits(baselineY - (rect.y + rect.height));
    // 시계 방향 (TrueType의 채워지는 방향)
    const point = (x: number, y: number): GlyphPoint => ({ x, y, onCurve: true });
    return [point(left, bottom), point(left, top), point(right, top), point(right, bottom)];
  });
}

/** 칠한 픽셀이 하나도 없는지 */
export const isBlank = (glyph: Glyph): boolean =>
  glyph.kind === 'pixel'
    ? glyph.bits.every((bit) => bit === 0)
    : glyph.contours.every((contour) => contour.length === 0);

/** 칠한 영역의 좌우 끝 (없으면 null) — 폭 자동 계산에 쓴다 */
export function pixelExtent(bits: Uint8Array, grid: number): { left: number; right: number } | null {
  let left = grid;
  let right = -1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (bits[y * grid + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  return right < 0 ? null : { left, right };
}

// ---------- 픽셀 변형 ----------

export function shiftPixels(bits: Uint8Array, grid: number, dx: number, dy: number): Uint8Array {
  const output = new Uint8Array(bits.length);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (!bits[y * grid + x]) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= grid || nextY >= grid) continue;
      output[nextY * grid + nextX] = 1;
    }
  }
  return output;
}

export function flipPixels(bits: Uint8Array, grid: number, axis: 'horizontal' | 'vertical'): Uint8Array {
  const output = new Uint8Array(bits.length);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (!bits[y * grid + x]) continue;
      const nextX = axis === 'horizontal' ? grid - 1 - x : x;
      const nextY = axis === 'vertical' ? grid - 1 - y : y;
      output[nextY * grid + nextX] = 1;
    }
  }
  return output;
}

/** 그리드 크기를 바꿀 때 비트맵을 최근접 이웃으로 옮긴다 */
export function resizePixels(
  bits: Uint8Array,
  fromGrid: number,
  toGrid: number,
): Uint8Array {
  const output = new Uint8Array(toGrid * toGrid);
  for (let y = 0; y < toGrid; y++) {
    for (let x = 0; x < toGrid; x++) {
      const sourceX = Math.floor((x * fromGrid) / toGrid);
      const sourceY = Math.floor((y * fromGrid) / toGrid);
      output[y * toGrid + x] = bits[sourceY * fromGrid + sourceX] ?? 0;
    }
  }
  return output;
}

// ---------- 아웃라인(벡터) 편집 ----------
//
// 픽셀로 시작해 다듬는 흐름을 위해, 픽셀 글리프를 사각 컨투어로 "승격"할 수 있다.
// 승격 뒤에는 제어점을 옮기고 곡선(off-curve)을 섞어 부드러운 글자를 만든다.

/** 픽셀 글리프를 같은 모양의 아웃라인 글리프로 바꾼다 */
export function pixelGlyphToOutline(glyph: Glyph, grid: number, baselineRow: number): Glyph {
  if (glyph.kind === 'outline') return glyph;
  return { kind: 'outline', contours: glyphToContours(glyph, grid, baselineRow) };
}

/** 컨투어의 부호 있는 면적 — 진행 방향(시계/반시계)을 판단한다 */
export function contourSignedArea(contour: Contour): number {
  let sum = 0;
  for (let i = 0; i < contour.length; i++) {
    const current = contour[i];
    const next = contour[(i + 1) % contour.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

/** 진행 방향을 뒤집는다 (구멍을 만들거나 채움이 반대일 때 쓴다) */
export function reverseContour(contour: Contour): Contour {
  // 시작점은 그대로 두고 나머지 순서만 뒤집는다 — 닫힌 컨투어라 모양은 같고,
  // 두 번 뒤집으면 정확히 원래 배열로 돌아온다.
  if (contour.length < 3) return [...contour].reverse();
  return [contour[0], ...contour.slice(1).reverse()];
}

/** 폰트 단위 좌표를 격자에 맞춰 정리한다 (기본은 반 칸) */
export function snapUnits(value: number, divisions = 2): number {
  const step = PIXEL_UNITS / divisions;
  return Math.round(value / step) * step;
}

/**
 * 아웃라인을 화면에 그리기 위한 경로 명령으로 바꾼다.
 * TrueType은 2차 베지어를 쓰고, off-curve 점이 연달아 오면 그 사이의 중점이
 * 암시적 on-curve 점이 된다 — 그 규칙을 그대로 펼친다.
 */
export type PathCommand =
  | { type: 'move'; x: number; y: number }
  | { type: 'line'; x: number; y: number }
  | { type: 'quad'; cx: number; cy: number; x: number; y: number }
  | { type: 'close' };

export function contourToPath(contour: Contour): PathCommand[] {
  if (contour.length === 0) return [];
  const commands: PathCommand[] = [];
  const midpoint = (a: GlyphPoint, b: GlyphPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // 시작점 — on-curve 점이 없으면 첫 두 off-curve의 중점에서 시작한다
  const firstOnCurve = contour.findIndex((point) => point.onCurve);
  const start =
    firstOnCurve >= 0
      ? { index: firstOnCurve, point: contour[firstOnCurve] }
      : { index: 0, point: { ...midpoint(contour[0], contour[contour.length - 1]), onCurve: true } };
  commands.push({ type: 'move', x: start.point.x, y: start.point.y });

  let pendingControl: GlyphPoint | null = null;
  for (let step = 1; step <= contour.length; step++) {
    const point = contour[(start.index + step) % contour.length];
    if (point.onCurve) {
      if (pendingControl) {
        commands.push({ type: 'quad', cx: pendingControl.x, cy: pendingControl.y, x: point.x, y: point.y });
        pendingControl = null;
      } else {
        commands.push({ type: 'line', x: point.x, y: point.y });
      }
      continue;
    }
    if (pendingControl) {
      // off-curve가 연달아 오면 중점이 곡선의 끝점이 된다
      const implied = midpoint(pendingControl, point);
      commands.push({ type: 'quad', cx: pendingControl.x, cy: pendingControl.y, x: implied.x, y: implied.y });
    }
    pendingControl = point;
  }
  if (pendingControl) {
    commands.push({
      type: 'quad',
      cx: pendingControl.x,
      cy: pendingControl.y,
      x: start.point.x,
      y: start.point.y,
    });
  }
  commands.push({ type: 'close' });
  return commands;
}

// ---------- BDF 내보내기 ----------

/**
 * BDF(Glyph Bitmap Distribution Format) — 터미널·임베디드에서 쓰는 텍스트 비트맵 형식.
 * 픽셀 글리프를 그대로 담을 수 있어 변환 손실이 없다.
 */
export function encodeBdf(
  entries: { codePoint: number; bits: Uint8Array; advance: number }[],
  grid: number,
  baselineRow: number,
  familyName: string,
): string {
  const ascent = baselineRow;
  const descent = grid - baselineRow;
  const bytesPerRow = Math.ceil(grid / 8);
  const lines: string[] = [
    'STARTFONT 2.1',
    `FONT -killterm-${familyName.replace(/\s+/g, '')}-medium-r-normal--${grid}-${grid * 10}-75-75-c-${grid * 10}-iso10646-1`,
    `SIZE ${grid} 75 75`,
    `FONTBOUNDINGBOX ${grid} ${grid} 0 ${-descent}`,
    'STARTPROPERTIES 3',
    `FONT_ASCENT ${ascent}`,
    `FONT_DESCENT ${descent}`,
    'DEFAULT_CHAR 0',
    'ENDPROPERTIES',
    `CHARS ${entries.length}`,
  ];
  for (const entry of entries) {
    lines.push(`STARTCHAR U+${entry.codePoint.toString(16).toUpperCase().padStart(4, '0')}`);
    lines.push(`ENCODING ${entry.codePoint}`);
    lines.push('SWIDTH 500 0');
    lines.push(`DWIDTH ${entry.advance} 0`);
    lines.push(`BBX ${grid} ${grid} 0 ${-descent}`);
    lines.push('BITMAP');
    for (let y = 0; y < grid; y++) {
      let row = '';
      for (let byteIndex = 0; byteIndex < bytesPerRow; byteIndex++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteIndex * 8 + bit;
          if (x < grid && entry.bits[y * grid + x]) byte |= 0x80 >> bit;
        }
        row += byte.toString(16).toUpperCase().padStart(2, '0');
      }
      lines.push(row);
    }
    lines.push('ENDCHAR');
  }
  lines.push('ENDFONT');
  return lines.join('\n') + '\n';
}
