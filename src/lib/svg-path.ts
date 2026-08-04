// SVG 경로를 TrueType 컨투어로 바꾸는 순수 모듈.
//
// **SVG는 3차 베지어(C)와 원호(A)를 쓰고 TrueType은 2차 베지어만 담는다.** 그래서
// 3차는 오차 허용치 안에서 2차로 근사하고(재귀 분할), 원호는 3차를 거쳐 들어온다.
// DOM에 기대는 부분(문서 순회 · transform 수집)은 `svg-import.ts`에 따로 두어
// 이 파일은 Node에서 그대로 테스트할 수 있게 했다.

import { contourToPath, contourSignedArea, reverseContour } from './bitmap-font.ts';
import type { Contour, GlyphPoint } from './ttf-encode.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 절대 좌표로 정규화한 경로 조각. 원호는 3차로 바뀐 뒤 들어온다. */
export type PathSegment =
  | { type: 'move'; x: number; y: number }
  | { type: 'line'; x: number; y: number }
  | { type: 'quad'; cx: number; cy: number; x: number; y: number }
  | { type: 'cubic'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { type: 'close' };

// ---------- 경로 데이터(d) 파싱 ----------

const isSeparator = (character: string | undefined): boolean =>
  character === ' ' ||
  character === ',' ||
  character === '\t' ||
  character === '\n' ||
  character === '\r' ||
  character === '\f';

const isDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= '0' && character <= '9';

const reflect = (control: Point, around: Point): Point => ({
  x: around.x * 2 - control.x,
  y: around.y * 2 - control.y,
});

/**
 * `d` 속성을 절대 좌표 조각으로 바꾼다.
 * 암시적 반복 좌표(`L 1 2 3 4`), 지수 표기, `S`/`T`의 반사 제어점을 모두 다룬다.
 */
export function parsePathData(d: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let index = 0;

  const skipSeparators = () => {
    while (index < d.length && isSeparator(d[index])) index++;
  };

  const hasNumberNext = (): boolean => {
    skipSeparators();
    const character = d[index];
    return character === '-' || character === '+' || character === '.' || isDigit(character);
  };

  const readNumber = (): number => {
    skipSeparators();
    const start = index;
    if (d[index] === '+' || d[index] === '-') index++;
    while (isDigit(d[index])) index++;
    if (d[index] === '.') {
      index++;
      while (isDigit(d[index])) index++;
    }
    if (d[index] === 'e' || d[index] === 'E') {
      const mark = index;
      index++;
      if (d[index] === '+' || d[index] === '-') index++;
      if (isDigit(d[index])) {
        while (isDigit(d[index])) index++;
      } else {
        index = mark;
      }
    }
    const text = d.slice(start, index);
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) {
      throw new Error(`경로에서 숫자를 읽지 못했습니다: "${d.slice(start, start + 12)}"`);
    }
    return value;
  };

  /** 원호의 large-arc / sweep 플래그는 구분자 없이 붙어 올 수 있다 */
  const readFlag = (): boolean => {
    skipSeparators();
    const character = d[index];
    if (character === '0' || character === '1') {
      index++;
      return character === '1';
    }
    throw new Error('원호 플래그는 0 또는 1이어야 합니다');
  };

  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let previousCommand = '';
  let lastCubicControl: Point | null = null;
  let lastQuadControl: Point | null = null;

  skipSeparators();
  while (index < d.length) {
    let command: string;
    const character = d[index];
    if (/[a-zA-Z]/.test(character)) {
      command = character;
      index++;
    } else if (previousCommand && previousCommand.toUpperCase() !== 'Z' && hasNumberNext()) {
      // 명령을 생략하면 이전 명령이 이어진다. 단 M 뒤의 반복은 L이다.
      command = previousCommand === 'M' ? 'L' : previousCommand === 'm' ? 'l' : previousCommand;
    } else {
      // 좌표를 소비하지 않는 명령이 반복되면 무한히 돌게 되므로 여기서 끊는다
      throw new Error(`경로에서 명령을 찾지 못했습니다: "${d.slice(index, index + 12)}"`);
    }

    const relative = command === command.toLowerCase();
    const originX = relative ? current.x : 0;
    const originY = relative ? current.y : 0;

    switch (command.toUpperCase()) {
      case 'M': {
        const x = readNumber() + originX;
        const y = readNumber() + originY;
        current = { x, y };
        subpathStart = current;
        segments.push({ type: 'move', x, y });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'L': {
        const x = readNumber() + originX;
        const y = readNumber() + originY;
        current = { x, y };
        segments.push({ type: 'line', x, y });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'H': {
        const x = readNumber() + originX;
        current = { x, y: current.y };
        segments.push({ type: 'line', x, y: current.y });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'V': {
        const y = readNumber() + originY;
        current = { x: current.x, y };
        segments.push({ type: 'line', x: current.x, y });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'C': {
        const c1 = { x: readNumber() + originX, y: readNumber() + originY };
        const c2 = { x: readNumber() + originX, y: readNumber() + originY };
        const to = { x: readNumber() + originX, y: readNumber() + originY };
        segments.push({ type: 'cubic', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: to.x, y: to.y });
        current = to;
        lastCubicControl = c2;
        lastQuadControl = null;
        break;
      }
      case 'S': {
        // 첫 제어점은 이전 곡선의 마지막 제어점을 현재 점 기준으로 뒤집은 것
        const c1 = lastCubicControl ? reflect(lastCubicControl, current) : current;
        const c2 = { x: readNumber() + originX, y: readNumber() + originY };
        const to = { x: readNumber() + originX, y: readNumber() + originY };
        segments.push({ type: 'cubic', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: to.x, y: to.y });
        current = to;
        lastCubicControl = c2;
        lastQuadControl = null;
        break;
      }
      case 'Q': {
        const control = { x: readNumber() + originX, y: readNumber() + originY };
        const to = { x: readNumber() + originX, y: readNumber() + originY };
        segments.push({ type: 'quad', cx: control.x, cy: control.y, x: to.x, y: to.y });
        current = to;
        lastQuadControl = control;
        lastCubicControl = null;
        break;
      }
      case 'T': {
        const control: Point = lastQuadControl ? reflect(lastQuadControl, current) : current;
        const to = { x: readNumber() + originX, y: readNumber() + originY };
        segments.push({ type: 'quad', cx: control.x, cy: control.y, x: to.x, y: to.y });
        current = to;
        lastQuadControl = control;
        lastCubicControl = null;
        break;
      }
      case 'A': {
        const rx = readNumber();
        const ry = readNumber();
        const rotation = readNumber();
        const largeArc = readFlag();
        const sweep = readFlag();
        const to = { x: readNumber() + originX, y: readNumber() + originY };
        const cubics = arcToCubics(current, to, { rx, ry }, rotation, largeArc, sweep);
        if (cubics.length === 0) {
          // 반지름이 0이면 규격상 직선이다
          segments.push({ type: 'line', x: to.x, y: to.y });
        } else {
          for (const cubic of cubics) {
            segments.push({
              type: 'cubic',
              c1x: cubic.c1.x,
              c1y: cubic.c1.y,
              c2x: cubic.c2.x,
              c2y: cubic.c2.y,
              x: cubic.to.x,
              y: cubic.to.y,
            });
          }
        }
        current = to;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'Z': {
        segments.push({ type: 'close' });
        current = subpathStart;
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      default:
        throw new Error(`알 수 없는 경로 명령: ${command}`);
    }

    previousCommand = command;
    skipSeparators();
  }

  return segments;
}

// ---------- 원호 → 3차 베지어 ----------

/**
 * SVG 규격 F.6.5(endpoint → center 파라미터화)로 원호를 3차 베지어로 바꾼다.
 * 90°를 넘으면 나눠야 오차가 커지지 않는다.
 * 반지름이 0이면 빈 배열을 돌려주고, 호출자가 직선으로 처리한다.
 */
export function arcToCubics(
  from: Point,
  to: Point,
  radii: { rx: number; ry: number },
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
): { c1: Point; c2: Point; to: Point }[] {
  let rx = Math.abs(radii.rx);
  let ry = Math.abs(radii.ry);
  if (rx === 0 || ry === 0) return [];
  if (from.x === to.x && from.y === to.y) return [];

  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const halfDx = (from.x - to.x) / 2;
  const halfDy = (from.y - to.y) / 2;
  const x1 = cosPhi * halfDx + sinPhi * halfDy;
  const y1 = -sinPhi * halfDx + cosPhi * halfDy;

  // 반지름이 두 점을 잇기에 모자라면 규격대로 늘린다
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const numerator = Math.max(0, rx * rx * ry * ry - denominator);
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const centerX1 = (coefficient * rx * y1) / ry;
  const centerY1 = (-coefficient * ry * x1) / rx;
  const centerX = cosPhi * centerX1 - sinPhi * centerY1 + (from.x + to.x) / 2;
  const centerY = sinPhi * centerX1 + cosPhi * centerY1 + (from.y + to.y) / 2;

  const angleBetween = (ux: number, uy: number, vx: number, vy: number): number => {
    const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (lengths === 0) return 0;
    const cosine = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / lengths));
    const angle = Math.acos(cosine);
    return ux * vy - uy * vx < 0 ? -angle : angle;
  };

  const startX = (x1 - centerX1) / rx;
  const startY = (y1 - centerY1) / ry;
  const endX = (-x1 - centerX1) / rx;
  const endY = (-y1 - centerY1) / ry;
  const theta = angleBetween(1, 0, startX, startY);
  let delta = angleBetween(startX, startY, endX, endY);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;

  const pointAt = (angle: number): Point => {
    const x = rx * Math.cos(angle);
    const y = ry * Math.sin(angle);
    return { x: cosPhi * x - sinPhi * y + centerX, y: sinPhi * x + cosPhi * y + centerY };
  };
  const tangentAt = (angle: number): Point => {
    const x = -rx * Math.sin(angle);
    const y = ry * Math.cos(angle);
    return { x: cosPhi * x - sinPhi * y, y: sinPhi * x + cosPhi * y };
  };

  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / steps;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const cubics: { c1: Point; c2: Point; to: Point }[] = [];
  let angle = theta;
  let start = from;
  for (let i = 0; i < steps; i++) {
    const nextAngle = angle + step;
    const end = i === steps - 1 ? to : pointAt(nextAngle);
    const startTangent = tangentAt(angle);
    const endTangent = tangentAt(nextAngle);
    cubics.push({
      c1: { x: start.x + alpha * startTangent.x, y: start.y + alpha * startTangent.y },
      c2: { x: end.x - alpha * endTangent.x, y: end.y - alpha * endTangent.y },
      to: end,
    });
    angle = nextAngle;
    start = end;
  }
  return cubics;
}

// ---------- 3차 → 2차 베지어 ----------

/**
 * 3차 베지어를 2차 베지어 여러 개로 근사한다.
 *
 * 한 개로 줄일 때 제어점은 `(3c1 + 3c2 − p0 − p3) / 4`이고, 이때 최대 오차는
 * `|p3 − 3c2 + 3c1 − p0| · √3/36`으로 알려져 있다. 허용치를 넘으면 de Casteljau로
 * 반씩 쪼갠다 — 오차는 분할마다 1/8로 줄어들어 몇 번이면 충분하다.
 */
export function cubicToQuadratics(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  tolerance: number,
  maxDepth = 8,
): { control: Point; to: Point }[] {
  const errorX = p3.x - 3 * c2.x + 3 * c1.x - p0.x;
  const errorY = p3.y - 3 * c2.y + 3 * c1.y - p0.y;
  const error = (Math.hypot(errorX, errorY) * Math.sqrt(3)) / 36;
  if (maxDepth <= 0 || error <= tolerance) {
    return [
      {
        control: {
          x: (3 * c1.x + 3 * c2.x - p0.x - p3.x) / 4,
          y: (3 * c1.y + 3 * c2.y - p0.y - p3.y) / 4,
        },
        to: p3,
      },
    ];
  }
  const middleOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a1 = middleOf(p0, c1);
  const a2 = middleOf(c1, c2);
  const a3 = middleOf(c2, p3);
  const b1 = middleOf(a1, a2);
  const b2 = middleOf(a2, a3);
  const split = middleOf(b1, b2);
  return [
    ...cubicToQuadratics(p0, a1, b1, split, tolerance, maxDepth - 1),
    ...cubicToQuadratics(split, b2, a3, p3, tolerance, maxDepth - 1),
  ];
}

// ---------- 조각 → 컨투어 ----------

const nearlySame = (a: Point, b: Point): boolean =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * 경로 조각을 TrueType 컨투어로 바꾼다. 3차는 2차로 근사하고, 열린 서브패스는
 * 닫아서 담는다(폰트 컨투어는 언제나 닫혀 있다).
 */
export function segmentsToContours(segments: PathSegment[], tolerance: number): Contour[] {
  const contours: Contour[] = [];
  let contour: GlyphPoint[] = [];
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };

  const pushOnCurve = (point: Point) => {
    const last = contour[contour.length - 1];
    if (last && last.onCurve && nearlySame(last, point)) return;
    contour.push({ x: point.x, y: point.y, onCurve: true });
  };

  const finishContour = () => {
    // 마지막 점이 시작점과 겹치면 버린다 — TrueType 컨투어는 암시적으로 닫힌다
    while (contour.length > 1) {
      const last = contour[contour.length - 1];
      if (last.onCurve && nearlySame(last, contour[0])) contour.pop();
      else break;
    }
    if (contour.length >= 3) contours.push(contour);
    contour = [];
  };

  for (const segment of segments) {
    if (segment.type === 'move') {
      finishContour();
      current = { x: segment.x, y: segment.y };
      subpathStart = current;
      contour.push({ x: current.x, y: current.y, onCurve: true });
      continue;
    }
    if (segment.type === 'close') {
      finishContour();
      current = subpathStart;
      continue;
    }
    // Z 뒤에 이어 그리면 시작점부터 새 컨투어가 열린다
    if (contour.length === 0) contour.push({ x: current.x, y: current.y, onCurve: true });

    if (segment.type === 'line') {
      pushOnCurve({ x: segment.x, y: segment.y });
      current = { x: segment.x, y: segment.y };
      continue;
    }
    if (segment.type === 'quad') {
      contour.push({ x: segment.cx, y: segment.cy, onCurve: false });
      contour.push({ x: segment.x, y: segment.y, onCurve: true });
      current = { x: segment.x, y: segment.y };
      continue;
    }
    const quadratics = cubicToQuadratics(
      current,
      { x: segment.c1x, y: segment.c1y },
      { x: segment.c2x, y: segment.c2y },
      { x: segment.x, y: segment.y },
      tolerance,
    );
    for (const quadratic of quadratics) {
      contour.push({ x: quadratic.control.x, y: quadratic.control.y, onCurve: false });
      contour.push({ x: quadratic.to.x, y: quadratic.to.y, onCurve: true });
    }
    current = { x: segment.x, y: segment.y };
  }
  finishContour();
  return contours;
}

// ---------- 채움 방향 ----------

/** 컨투어를 다각형으로 펼친다 — 방향 판정과 경계 계산에 쓴다 */
export function flattenContour(contour: Contour, stepsPerCurve = 6): Point[] {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  for (const command of contourToPath(contour)) {
    if (command.type === 'close') continue;
    if (command.type === 'quad') {
      for (let step = 1; step <= stepsPerCurve; step++) {
        const t = step / stepsPerCurve;
        const inverse = 1 - t;
        points.push({
          x: inverse * inverse * current.x + 2 * inverse * t * command.cx + t * t * command.x,
          y: inverse * inverse * current.y + 2 * inverse * t * command.cy + t * t * command.y,
        });
      }
    } else {
      points.push({ x: command.x, y: command.y });
    }
    current = { x: command.x, y: command.y };
  }
  return points;
}

function boundsOf(points: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const boundsContain = (outer: Bounds, inner: Bounds): boolean =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

/** 다각형 안의 한 점 — 가장 아래 꼭짓점은 항상 볼록해서 그 삼각형 무게중심을 쓴다 */
function interiorPoint(polygon: Point[]): Point {
  if (polygon.length < 3) return polygon[0] ?? { x: 0, y: 0 };
  let lowest = 0;
  for (let i = 1; i < polygon.length; i++) {
    if (polygon[i].y < polygon[lowest].y) lowest = i;
  }
  const previous = polygon[(lowest - 1 + polygon.length) % polygon.length];
  const vertex = polygon[lowest];
  const next = polygon[(lowest + 1) % polygon.length];
  return {
    x: (previous.x + vertex.x + next.x) / 3,
    y: (previous.y + vertex.y + next.y) / 3,
  };
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (!crosses) continue;
    const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < x) inside = !inside;
  }
  return inside;
}

/**
 * 채움 방향을 폰트 규칙에 맞춘다.
 *
 * **중첩 깊이가 짝수면 채움(시계 방향), 홀수면 구멍(반시계).** 원본이 nonzero든
 * evenodd든 같은 결과가 나오고 'O'·'ㅇ' 같은 글자의 구멍이 저절로 뚫린다.
 * 폰트 좌표는 위가 +y라서 시계 방향의 부호 면적이 음수다.
 */
export function normalizeWinding(contours: Contour[]): Contour[] {
  const polygons = contours.map((contour) => flattenContour(contour));
  const boxes = polygons.map((polygon) => boundsOf(polygon));
  const insides = polygons.map((polygon) => interiorPoint(polygon));

  return contours.map((contour, index) => {
    let depth = 0;
    for (let other = 0; other < contours.length; other++) {
      if (other === index) continue;
      if (!boundsContain(boxes[other], boxes[index])) continue;
      if (pointInPolygon(insides[index], polygons[other])) depth++;
    }
    const wantsClockwise = depth % 2 === 0;
    const isClockwise = contourSignedArea(contour) < 0;
    return isClockwise === wantsClockwise ? contour : reverseContour(contour);
  });
}

// ---------- 좌표 변환 ----------

/** [a, b, c, d, e, f] — x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

/** `outer`를 `inner` 다음에 적용하는 행렬 (부모 transform 합성 순서) */
export function multiplyMatrix(outer: Matrix, inner: Matrix): Matrix {
  const [a0, b0, c0, d0, e0, f0] = outer;
  const [a1, b1, c1, d1, e1, f1] = inner;
  return [
    a0 * a1 + c0 * b1,
    b0 * a1 + d0 * b1,
    a0 * c1 + c0 * d1,
    b0 * c1 + d0 * d1,
    a0 * e1 + c0 * f1 + e0,
    b0 * e1 + d0 * f1 + f0,
  ];
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/** transform 속성을 행렬 하나로 합친다. 왼쪽에 쓴 변환이 나중에 적용된다. */
export function parseTransformList(value: string): Matrix {
  let matrix = IDENTITY_MATRIX;
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match = pattern.exec(value);
  while (match) {
    const name = match[1].toLowerCase();
    const args = match[2]
      .split(/[\s,]+/)
      .filter((part) => part !== '')
      .map(Number);
    if (args.some((argument) => !Number.isFinite(argument))) {
      throw new Error(`transform 값을 읽지 못했습니다: ${match[0]}`);
    }
    matrix = multiplyMatrix(matrix, transformToMatrix(name, args));
    match = pattern.exec(value);
  }
  return matrix;
}

function transformToMatrix(name: string, args: number[]): Matrix {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  switch (name) {
    case 'matrix':
      if (args.length < 6) throw new Error('matrix()에는 값 6개가 필요합니다');
      return [args[0], args[1], args[2], args[3], args[4], args[5]];
    case 'translate':
      return [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    case 'scale': {
      const scaleX = args[0] ?? 1;
      return [scaleX, 0, 0, args[1] ?? scaleX, 0, 0];
    }
    case 'rotate': {
      const angle = radians(args[0] ?? 0);
      const rotation: Matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      if (args.length < 3) return rotation;
      // 중심점이 있으면 그 점으로 옮겨 돌리고 되돌린다
      const toCenter: Matrix = [1, 0, 0, 1, args[1], args[2]];
      const fromCenter: Matrix = [1, 0, 0, 1, -args[1], -args[2]];
      return multiplyMatrix(multiplyMatrix(toCenter, rotation), fromCenter);
    }
    case 'skewx':
      return [1, 0, Math.tan(radians(args[0] ?? 0)), 1, 0, 0];
    case 'skewy':
      return [1, Math.tan(radians(args[0] ?? 0)), 0, 1, 0, 0];
    default:
      throw new Error(`지원하지 않는 transform: ${name}`);
  }
}

export function transformSegments(segments: PathSegment[], matrix: Matrix): PathSegment[] {
  return segments.map((segment) => {
    if (segment.type === 'close') return segment;
    const to = applyMatrix(matrix, { x: segment.x, y: segment.y });
    if (segment.type === 'quad') {
      const control = applyMatrix(matrix, { x: segment.cx, y: segment.cy });
      return { type: 'quad', cx: control.x, cy: control.y, x: to.x, y: to.y };
    }
    if (segment.type === 'cubic') {
      const c1 = applyMatrix(matrix, { x: segment.c1x, y: segment.c1y });
      const c2 = applyMatrix(matrix, { x: segment.c2x, y: segment.c2y });
      return { type: 'cubic', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: to.x, y: to.y };
    }
    return { type: segment.type, x: to.x, y: to.y };
  });
}

export function transformContours(contours: Contour[], matrix: Matrix): Contour[] {
  return contours.map((contour) =>
    contour.map((point) => {
      const moved = applyMatrix(matrix, point);
      return { x: moved.x, y: moved.y, onCurve: point.onCurve };
    }),
  );
}

/** 곡선을 펼쳐 실제 그림 경계를 구한다 (제어점 기준으로 하면 실제보다 넓게 잡힌다) */
export function contourBounds(contours: Contour[]): Bounds | null {
  const points = contours.flatMap((contour) => flattenContour(contour));
  if (points.length === 0) return null;
  return boundsOf(points);
}

/**
 * 그림을 대상 사각형에 맞추는 행렬. 가로세로 비율은 유지한다.
 * `flipY`는 SVG(위→아래)와 폰트(아래→위)의 y 방향 차이를 뒤집는다.
 */
export function fitTransform(
  source: Bounds,
  box: Bounds,
  options: { flipY: boolean; align: 'center' | 'bottom-left' },
): Matrix {
  const scaleX = source.width > 0 ? box.width / source.width : 1;
  const scaleY = source.height > 0 ? box.height / source.height : 1;
  const scale = Math.min(scaleX, scaleY);
  const verticalScale = options.flipY ? -scale : scale;

  if (options.align === 'bottom-left') {
    const sourceBottom = options.flipY ? source.y + source.height : source.y;
    return [scale, 0, 0, verticalScale, box.x - scale * source.x, box.y - verticalScale * sourceBottom];
  }
  const centerX = source.x + source.width / 2;
  const centerY = source.y + source.height / 2;
  return [
    scale,
    0,
    0,
    verticalScale,
    box.x + box.width / 2 - scale * centerX,
    box.y + box.height / 2 - verticalScale * centerY,
  ];
}

// ---------- 도형 → 경로 데이터 ----------

const attributeNumber = (value: string | null, fallback = 0): number => {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * `rect` · `circle` · `ellipse` · `line` · `polyline` · `polygon`을 `d`로 바꾼다.
 * 아이콘 SVG는 path만으로 되어 있는 경우가 드물어 이 변환이 필요하다.
 */
export function shapeToPathData(tag: string, attribute: (name: string) => string | null): string | null {
  switch (tag) {
    case 'path':
      return attribute('d');
    case 'rect': {
      const x = attributeNumber(attribute('x'));
      const y = attributeNumber(attribute('y'));
      const width = attributeNumber(attribute('width'));
      const height = attributeNumber(attribute('height'));
      if (width <= 0 || height <= 0) return null;
      const rawRx = attribute('rx');
      const rawRy = attribute('ry');
      // 하나만 주면 나머지는 같은 값으로 본다 (SVG 규격)
      let rx = attributeNumber(rawRx, attributeNumber(rawRy, 0));
      let ry = attributeNumber(rawRy, attributeNumber(rawRx, 0));
      rx = Math.min(rx, width / 2);
      ry = Math.min(ry, height / 2);
      if (rx <= 0 || ry <= 0) {
        return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
      }
      return [
        `M ${x + rx} ${y}`,
        `H ${x + width - rx}`,
        `A ${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
        `V ${y + height - ry}`,
        `A ${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
        `H ${x + rx}`,
        `A ${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
        `V ${y + ry}`,
        `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
        'Z',
      ].join(' ');
    }
    case 'circle':
    case 'ellipse': {
      const cx = attributeNumber(attribute('cx'));
      const cy = attributeNumber(attribute('cy'));
      const radius = attributeNumber(attribute('r'));
      const rx = tag === 'circle' ? radius : attributeNumber(attribute('rx'));
      const ry = tag === 'circle' ? radius : attributeNumber(attribute('ry'));
      if (rx <= 0 || ry <= 0) return null;
      return [
        `M ${cx - rx} ${cy}`,
        `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
        `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
        'Z',
      ].join(' ');
    }
    case 'line': {
      const x1 = attributeNumber(attribute('x1'));
      const y1 = attributeNumber(attribute('y1'));
      const x2 = attributeNumber(attribute('x2'));
      const y2 = attributeNumber(attribute('y2'));
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    case 'polyline':
    case 'polygon': {
      const raw = attribute('points');
      if (!raw) return null;
      const numbers = raw
        .split(/[\s,]+/)
        .filter((part) => part !== '')
        .map(Number);
      if (numbers.length < 4 || numbers.some((value) => !Number.isFinite(value))) return null;
      const commands = [`M ${numbers[0]} ${numbers[1]}`];
      for (let i = 2; i + 1 < numbers.length; i += 2) commands.push(`L ${numbers[i]} ${numbers[i + 1]}`);
      if (tag === 'polygon') commands.push('Z');
      return commands.join(' ');
    }
    default:
      return null;
  }
}
