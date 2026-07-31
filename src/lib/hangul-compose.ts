// 한글 자모 조합 — 자모를 그려 음절 11,172자를 만든다.
//
// **자모는 위치에 따라 모양이 달라진다.** 초성 ㄱ은 '가'(세로 모음)와 '고'(가로 모음),
// '각'(받침 있음)에서 폭·높이·위치가 모두 다르고, 같은 ㄱ이 받침으로 갈 때는 또 다른
// 모양이다. 그래서 조합형 폰트는 자모마다 여러 "벌"을 그려 둔다.
//
// 이 라이브러리는 두 단계를 지원한다:
//  1. **기본 벌만 그린 상태** — 자모 67자(초성 19·중성 21·종성 27)만 그리면 배치
//     규칙에 맞춰 늘려 찍는다. 비율이 완벽하진 않지만 바로 글자가 나온다.
//  2. **벌을 채운 상태** — 위치별 벌을 그려 두면 **변형 없이 그대로 겹쳐(OR)** 쓴다.
//     작성자가 의도한 획 두께와 위치가 유지된다.
//
// 벌 구분 (중성 모양 3그룹 × 받침 유무에서 나온다):
//  · 초성 6벌 — 세로/가로/복합 모음 × 받침 없음/있음
//  · 중성 2벌 — 받침 없음/있음 (받침이 있으면 위로 눌린다)
//  · 종성 3벌 — 위에 온 모음이 세로/가로/복합인지에 따라 폭이 달라진다

export const SYLLABLE_BASE = 0xac00;
export const SYLLABLE_COUNT = 11172;
export const MEDIAL_COUNT = 21;
export const FINAL_COUNT = 28;

/** 초성 19자 (조합 음절에 쓰이는 순서) */
export const INITIALS = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 중성 21자 */
export const MEDIALS = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];

/** 종성 27자 (없음은 제외) */
export const FINALS = [
  'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ',
  'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ',
  'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

export type MedialShape = 'vertical' | 'horizontal' | 'mixed';

/** 중성의 모양 분류 — 배치를 결정한다 */
export function medialShape(medialIndex: number): MedialShape {
  const medial = MEDIALS[medialIndex];
  if (['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅣ'].includes(medial)) return 'vertical';
  if (['ㅗ', 'ㅛ', 'ㅜ', 'ㅠ', 'ㅡ'].includes(medial)) return 'horizontal';
  return 'mixed';
}

export interface Decomposed {
  initialIndex: number;
  medialIndex: number;
  /** 0이면 종성 없음. 1 이상이면 FINALS[finalIndex - 1] */
  finalIndex: number;
}

/** 음절 코드포인트를 자모 인덱스로 분해한다. 음절이 아니면 null */
export function decomposeSyllable(codePoint: number): Decomposed | null {
  const offset = codePoint - SYLLABLE_BASE;
  if (offset < 0 || offset >= SYLLABLE_COUNT) return null;
  return {
    initialIndex: Math.floor(offset / (MEDIAL_COUNT * FINAL_COUNT)),
    medialIndex: Math.floor(offset / FINAL_COUNT) % MEDIAL_COUNT,
    finalIndex: offset % FINAL_COUNT,
  };
}

/** 자모 인덱스를 음절 코드포인트로 되돌린다 */
export function composeCodePoint(parts: Decomposed): number {
  return (
    SYLLABLE_BASE +
    parts.initialIndex * MEDIAL_COUNT * FINAL_COUNT +
    parts.medialIndex * FINAL_COUNT +
    parts.finalIndex
  );
}

export interface Placement {
  /** 0~1 비율 — 그리드 크기와 무관하게 규칙을 표현한다 */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 자모를 음절 안에 어디에 놓을지 정한다.
 * 비율(0~1)로 돌려주므로 그리드 크기가 달라도 같은 규칙이 적용된다.
 */
export function placements(
  medialIndex: number,
  hasFinal: boolean,
): { initial: Placement; medial: Placement; final: Placement | null } {
  const shape = medialShape(medialIndex);
  // 종성이 있으면 위쪽 영역을 눌러 아래에 자리를 만든다
  const topHeight = hasFinal ? 0.72 : 1;
  const finalPlacement: Placement | null = hasFinal
    ? { x: 0, y: 0.72, width: 1, height: 0.28 }
    : null;

  if (shape === 'vertical') {
    // 초성 왼쪽 · 중성 오른쪽
    return {
      initial: { x: 0, y: 0, width: 0.62, height: topHeight },
      medial: { x: 0.62, y: 0, width: 0.38, height: topHeight },
      final: finalPlacement,
    };
  }
  if (shape === 'horizontal') {
    // 초성 위 · 중성 아래
    return {
      initial: { x: 0.1, y: 0, width: 0.8, height: topHeight * 0.62 },
      medial: { x: 0, y: topHeight * 0.62, width: 1, height: topHeight * 0.38 },
      final: finalPlacement,
    };
  }
  // 복합형 — 초성은 왼쪽 위, 중성은 오른쪽과 아래를 함께 쓴다
  return {
    initial: { x: 0, y: 0, width: 0.58, height: topHeight * 0.62 },
    medial: { x: 0, y: 0, width: 1, height: topHeight },
    final: finalPlacement,
  };
}

/**
 * 자모 비트맵을 배치 영역에 맞춰 축소·이동해 그려 넣는다 (최근접 이웃).
 * 자모는 그리드 전체를 쓰도록 그렸다고 보고, 실제로 칠한 영역만 잡아 늘린다.
 */
function stamp(
  target: Uint8Array,
  grid: number,
  source: Uint8Array,
  placement: Placement,
): void {
  // 자모에서 칠한 영역의 경계를 찾는다 — 여백까지 축소하면 자모가 너무 작아진다
  let minX = grid;
  let minY = grid;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (!source[y * grid + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return; // 빈 자모

  const sourceWidth = maxX - minX + 1;
  const sourceHeight = maxY - minY + 1;
  const boxX = Math.round(placement.x * grid);
  const boxY = Math.round(placement.y * grid);
  const boxWidth = Math.max(1, Math.round(placement.width * grid));
  const boxHeight = Math.max(1, Math.round(placement.height * grid));

  for (let y = 0; y < boxHeight; y++) {
    for (let x = 0; x < boxWidth; x++) {
      // 목표 칸에 대응하는 원본 픽셀 (최근접)
      const sourceX = minX + Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / boxWidth));
      const sourceY = minY + Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / boxHeight));
      if (!source[sourceY * grid + sourceX]) continue;
      const targetX = boxX + x;
      const targetY = boxY + y;
      if (targetX < 0 || targetY < 0 || targetX >= grid || targetY >= grid) continue;
      target[targetY * grid + targetX] = 1;
    }
  }
}

export type JamoKind = 'initial' | 'medial' | 'final';

/** 자모 종류별 벌 수 */
export const VARIANT_COUNT: Record<JamoKind, number> = {
  initial: 6,
  medial: 2,
  final: 3,
};

/** 각 벌이 어떤 자리에 쓰이는지 — UI 설명과 예시 글자 */
export const VARIANT_LABELS: Record<JamoKind, { label: string; sample: string }[]> = {
  initial: [
    { label: '세로 모음 · 받침 없음', sample: '가' },
    { label: '가로 모음 · 받침 없음', sample: '고' },
    { label: '복합 모음 · 받침 없음', sample: '과' },
    { label: '세로 모음 · 받침 있음', sample: '간' },
    { label: '가로 모음 · 받침 있음', sample: '곤' },
    { label: '복합 모음 · 받침 있음', sample: '관' },
  ],
  medial: [
    { label: '받침 없음', sample: '가' },
    { label: '받침 있음', sample: '간' },
  ],
  final: [
    { label: '세로 모음 아래', sample: '간' },
    { label: '가로 모음 아래', sample: '곤' },
    { label: '복합 모음 아래', sample: '관' },
  ],
};

const shapeIndex = (medialIndex: number): number => {
  const shape = medialShape(medialIndex);
  return shape === 'vertical' ? 0 : shape === 'horizontal' ? 1 : 2;
};

/** 초성 벌 — 중성 모양(3) × 받침 유무(2) */
export function initialVariant(medialIndex: number, hasFinal: boolean): number {
  return shapeIndex(medialIndex) + (hasFinal ? 3 : 0);
}

/** 중성 벌 — 받침 유무 */
export function medialVariant(hasFinal: boolean): number {
  return hasFinal ? 1 : 0;
}

/** 종성 벌 — 위에 온 모음의 모양 */
export function finalVariant(medialIndex: number): number {
  return shapeIndex(medialIndex);
}

/**
 * 그려 둔 자모를 찾아 주는 함수.
 * 해당 벌이 없으면 null을 돌려주면 되고, 그때는 기본 벌(0)을 배치 규칙으로 늘려 쓴다.
 */
export type JamoLookup = (kind: JamoKind, index: number, variant: number) => Uint8Array | null;

/** 배열 세 개로 만든 간단한 조회기 (기본 벌만 있는 경우) */
export function baseLookup(jamo: {
  initials: (Uint8Array | null)[];
  medials: (Uint8Array | null)[];
  finals: (Uint8Array | null)[];
}): JamoLookup {
  return (kind, index, variant) => {
    if (variant !== 0) return null;
    if (kind === 'initial') return jamo.initials[index] ?? null;
    if (kind === 'medial') return jamo.medials[index] ?? null;
    return jamo.finals[index] ?? null;
  };
}

/** 그대로 겹치기 — 벌을 그려 둔 경우엔 변형 없이 OR로 합친다 */
function overlay(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length && i < source.length; i++) {
    if (source[i]) target[i] = 1;
  }
}

/**
 * 음절 하나의 비트맵을 조합한다. 필요한 자모(기본 벌)가 없으면 null.
 *
 * 벌이 그려져 있으면 변형 없이 겹치고, 없으면 기본 벌을 배치 규칙에 맞춰 늘려 찍는다.
 */
export function composeSyllable(
  lookup: JamoLookup,
  codePoint: number,
  grid: number,
): Uint8Array | null {
  const parts = decomposeSyllable(codePoint);
  if (!parts) return null;
  const hasFinal = parts.finalIndex > 0;
  const layout = placements(parts.medialIndex, hasFinal);
  const output = new Uint8Array(grid * grid);

  /** 벌이 있으면 그대로, 없으면 기본 벌을 자리에 맞춰 늘려 찍는다 */
  const place = (kind: JamoKind, index: number, variant: number, placement: Placement): boolean => {
    const exact = lookup(kind, index, variant);
    if (exact) {
      overlay(output, exact);
      return true;
    }
    const base = lookup(kind, index, 0);
    if (!base) return false;
    stamp(output, grid, base, placement);
    return true;
  };

  if (!place('initial', parts.initialIndex, initialVariant(parts.medialIndex, hasFinal), layout.initial)) {
    return null;
  }
  if (!place('medial', parts.medialIndex, medialVariant(hasFinal), layout.medial)) return null;
  if (hasFinal && layout.final) {
    if (!place('final', parts.finalIndex - 1, finalVariant(parts.medialIndex), layout.final)) {
      return null;
    }
  }
  return output;
}

/** 글에 쓰인 한글 음절 코드포인트를 모은다 */
export function syllablesInText(text: string): number[] {
  const found = new Set<number>();
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (decomposeSyllable(code)) found.add(code);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * 조합 가능한 음절 전부 — 그려 둔 자모로 만들 수 있는 것만 돌려준다.
 * 개수가 많으면(수천 자) TTF가 커지므로 호출부에서 상한을 둔다.
 */
export function composableSyllables(lookup: JamoLookup, limit = SYLLABLE_COUNT): number[] {
  const result: number[] = [];
  // 기본 벌이 있으면 조합 가능하다 (벌이 없으면 늘려 찍는 경로로 처리된다)
  for (let initialIndex = 0; initialIndex < INITIALS.length; initialIndex++) {
    if (!lookup('initial', initialIndex, 0)) continue;
    for (let medialIndex = 0; medialIndex < MEDIALS.length; medialIndex++) {
      if (!lookup('medial', medialIndex, 0)) continue;
      for (let finalIndex = 0; finalIndex < FINAL_COUNT; finalIndex++) {
        if (finalIndex > 0 && !lookup('final', finalIndex - 1, 0)) continue;
        result.push(composeCodePoint({ initialIndex, medialIndex, finalIndex }));
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}
