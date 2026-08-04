// SVG 문서를 걸어 글리프 윤곽선을 모으는 층.
//
// 수학과 파싱은 `svg-path.ts`(순수, Node 테스트 대상)에 있고, 여기서는 DOM만 다룬다.
// **다루지 못한 요소는 조용히 버리지 않고 경고로 모아 돌려준다** — 글자가 사라진
// 이유를 사용자가 알 수 있어야 한다.

import {
  IDENTITY_MATRIX,
  contourBounds,
  fitTransform,
  multiplyMatrix,
  normalizeWinding,
  parsePathData,
  parseTransformList,
  segmentsToContours,
  shapeToPathData,
  transformContours,
  transformSegments,
  type Bounds,
  type Matrix,
  type PathSegment,
} from './svg-path.ts';
import type { Contour } from './ttf-encode.ts';

export interface SvgFit {
  /** 그림을 담을 사각형 (폰트 좌표) */
  box: Bounds;
  /** 가운데 놓을지, 왼쪽 아래(베이스라인)에 맞출지 */
  align: 'center' | 'bottom-left';
}

export interface SvgImportResult {
  /** 폰트 좌표로 옮기고 채움 방향까지 맞춘 컨투어 */
  contours: Contour[];
  /** 사용자에게 보여줄 안내 — 건너뛴 요소, 읽지 못한 속성 */
  warnings: string[];
  /** 옮긴 뒤의 그림 경계 (폰트 좌표) */
  bounds: Bounds | null;
  viewBox: Bounds | null;
}

const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINER_TAGS = new Set(['svg', 'g', 'a', 'switch']);
/** 화면에 그려지지 않는 요소 — 경고 없이 지나간다 */
const IGNORED_TAGS = new Set([
  'defs',
  'clippath',
  'mask',
  'marker',
  'pattern',
  'symbol',
  'style',
  'title',
  'desc',
  'metadata',
  'lineargradient',
  'radialgradient',
  'filter',
  'animate',
  'animatetransform',
  'script',
]);

const localName = (element: Element): string => element.tagName.replace(/^.*:/, '').toLowerCase();

/** 그려지지 않는 상태인지 — 채움이 없는 도형은 윤곽선이 아니다 */
function isInvisible(element: Element): boolean {
  const style = element.getAttribute('style') ?? '';
  const display = element.getAttribute('display') ?? '';
  if (display.trim() === 'none' || /display\s*:\s*none/.test(style)) return true;
  if (/visibility\s*:\s*hidden/.test(style)) return true;
  const fill = element.getAttribute('fill');
  const fillFromStyle = /fill\s*:\s*([^;]+)/.exec(style)?.[1];
  const effectiveFill = (fillFromStyle ?? fill ?? '').trim();
  return effectiveFill === 'none';
}

function parseViewBox(value: string | null): Bounds | null {
  if (!value) return null;
  const parts = value
    .split(/[\s,]+/)
    .filter((part) => part !== '')
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/**
 * SVG 텍스트에서 컨투어를 모아 폰트 좌표로 옮긴다.
 *
 * **y 뒤집기와 채움 방향 정리를 여기서 함께 한다.** 방향을 먼저 정하고 y를 뒤집으면
 * 부호가 뒤집혀 채움과 구멍이 반대가 되므로 순서가 중요하다.
 * 예외를 던지지 않고 경고에 담아 돌려주므로 호출자는 부분 결과도 그대로 쓸 수 있다.
 */
export function collectSvgContours(
  svgText: string,
  options: { tolerance: number; fit: SvgFit },
): SvgImportResult {
  const warnings: string[] = [];
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const failure = parsed.querySelector('parsererror');
  const root = parsed.documentElement;
  if (failure || !root || localName(root) !== 'svg') {
    return { contours: [], warnings: ['SVG로 읽을 수 없는 파일입니다.'], bounds: null, viewBox: null };
  }

  const segments: PathSegment[] = [];
  const skipped = new Set<string>();

  const walk = (element: Element, inherited: Matrix) => {
    const tag = localName(element);
    if (IGNORED_TAGS.has(tag)) return;
    if (isInvisible(element)) {
      if (SHAPE_TAGS.has(tag)) skipped.add(`${tag}(채움 없음)`);
      return;
    }

    let matrix = inherited;
    const transform = element.getAttribute('transform');
    if (transform) {
      try {
        matrix = multiplyMatrix(inherited, parseTransformList(transform));
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (CONTAINER_TAGS.has(tag)) {
      for (const child of Array.from(element.children)) walk(child, matrix);
      return;
    }

    if (!SHAPE_TAGS.has(tag)) {
      skipped.add(tag);
      return;
    }

    const pathData = shapeToPathData(tag, (name) => element.getAttribute(name));
    if (!pathData) return;
    try {
      segments.push(...transformSegments(parsePathData(pathData), matrix));
    } catch (error) {
      warnings.push(`<${tag}>를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  walk(root, IDENTITY_MATRIX);

  if (skipped.size > 0) {
    warnings.push(`담지 못한 요소는 건너뜁니다: ${[...skipped].join(', ')}`);
  }

  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const raw = segmentsToContours(segments, options.tolerance);
  const source = contourBounds(raw);
  if (!source) {
    if (warnings.length === 0) {
      warnings.push('채워진 도형을 찾지 못했습니다. 획(stroke)만 있는 그림은 윤곽선으로 바꿔 저장해 주세요.');
    }
    return { contours: [], warnings, bounds: null, viewBox };
  }

  const matrix = fitTransform(source, options.fit.box, { flipY: true, align: options.fit.align });
  const contours = normalizeWinding(transformContours(raw, matrix));
  return { contours, warnings, bounds: contourBounds(contours), viewBox };
}

/**
 * 파일명에서 글자를 알아낸다. `A.svg`는 한 글자로, `U+AC00.svg`는 코드포인트로 본다.
 * 알 수 없으면 null — 호출자가 건너뛰고 경고에 남긴다.
 */
export function codePointFromFileName(fileName: string): number | null {
  const name = fileName.replace(/\.svg$/i, '').trim();
  const hex = /^[uU]\+?([0-9a-fA-F]{4,6})$/.exec(name);
  if (hex) {
    const code = Number.parseInt(hex[1], 16);
    return code > 0 && code <= 0x10ffff ? code : null;
  }
  const characters = [...name];
  return characters.length === 1 ? characters[0].codePointAt(0)! : null;
}
