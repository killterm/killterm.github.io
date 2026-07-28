// 리퀴드 글래스(굴절) 효과 유틸.
//
// kube.io/blog/liquid-glass-css-svg 기법을 따른다:
// 1. R/G 채널에 픽셀 변위(x/y)를 인코딩한 displacement map 이미지를 캔버스로 생성
//    (128 = 변위 없음, 가장자리 bezel 구간에서 바깥 방향으로 변위가 커져
//    볼록 렌즈의 굴절을 근사한다)
// 2. SVG 필터(feImage + feDisplacementMap)로 만들어 문서에 주입
// 3. 대상 요소에 backdrop-filter: url(#id)로 적용해 뒤 배경을 굴절시킨다
//    (url()에 다른 필터 함수를 체이닝하면 Chromium에서 무시될 수 있으므로 단독 사용)
//
// backdrop-filter의 SVG 필터 참조는 Chromium 전용이라, 미지원 브라우저에서는
// 아무것도 하지 않고 호출부의 CSS 폴백(반투명 + blur)이 그대로 남는다.
//
// 누르는 동안(feDisplacementMap의 scale만 큰 필터로 교체) 굴절이 강해지는
// 프레스 상태를 지원한다. scale 변경은 map 재계산이 없어 비용이 낮다.

export type GlassGeometry = {
  width: number;
  height: number;
  /** 모서리 반경(px). 원이면 width/2 */
  radius: number;
  /** 굴절이 일어나는 가장자리 두께(px) */
  bezel: number;
};

let filterCounter = 0;
let svgRoot: SVGSVGElement | null = null;
const mapCache = new Map<string, string>();

export function supportsLiquidGlass(): boolean {
  return CSS.supports('backdrop-filter', 'url(#liquid-glass-probe)');
}

function ensureSvgRoot(): SVGSVGElement {
  if (svgRoot) return svgRoot;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  document.body.appendChild(svg);
  svgRoot = svg;
  return svg;
}

const GLASS_IOR = 1.5;
const PROFILE_SAMPLES = 128;

// 스넬 법칙 기반 굴절 프로파일 (포스트의 convex squircle 표면).
// x: 가장자리(0) → bezel 안쪽 끝(1), 표면 높이 y = (1-(1-x)^4)^(1/4).
// 각 지점에서 표면 기울기로 법선을 구하고, 수직 입사광이 스넬 법칙으로
// 꺾이는 각도(θ1-θ2)의 tan을 변위 크기로 삼아 [0,1]로 정규화한다.
function buildRefractionProfile(): number[] {
  const surfaceHeight = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);
  const delta = 1 / PROFILE_SAMPLES;
  const magnitudes: number[] = [];
  for (let i = 0; i <= PROFILE_SAMPLES; i++) {
    const x = i / PROFILE_SAMPLES;
    const y0 = surfaceHeight(Math.max(0, x - delta));
    const y1 = surfaceHeight(Math.min(1, x + delta));
    const slope = Math.abs((y1 - y0) / (2 * delta));
    const theta1 = Math.atan(slope);
    const theta2 = Math.asin(Math.min(1, Math.sin(theta1) / GLASS_IOR));
    magnitudes.push(Math.tan(theta1 - theta2));
  }
  const max = Math.max(...magnitudes) || 1;
  return magnitudes.map((m) => m / max);
}

let refractionProfile: number[] | null = null;

// 둥근 사각형 signed distance (음수 = 내부)
function roundedRectDistance(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  radius: number,
): number {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

// bezel 구간의 변위 크기(스넬 프로파일)와 방향(가장 가까운 가장자리의 법선 =
// SDF 기울기)을 픽셀마다 R/G 채널에 인코딩한다. 같은 기하학이면 캐시를 재사용.
function buildDisplacementMap(geometry: GlassGeometry): string {
  const key = `${geometry.width}x${geometry.height}r${geometry.radius}b${geometry.bezel}`;
  const cached = mapCache.get(key);
  if (cached) return cached;

  refractionProfile ??= buildRefractionProfile();
  const { width, height, radius, bezel } = geometry;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const halfW = width / 2;
  const halfH = height / 2;
  const sd = (px: number, py: number) => roundedRectDistance(px, py, halfW, halfH, radius);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      const depth = -sd(px, py);

      let dx = 0;
      let dy = 0;
      if (depth > 0 && depth < bezel) {
        const t = 1 - depth / bezel;
        const magnitude = refractionProfile[Math.round((1 - t) * PROFILE_SAMPLES)] ?? 0;
        // 변위 방향 = SDF 기울기(가장 가까운 가장자리의 바깥쪽 법선)
        const gradX = sd(px + 0.5, py) - sd(px - 0.5, py);
        const gradY = sd(px, py + 0.5) - sd(px, py - 0.5);
        const length = Math.hypot(gradX, gradY) || 1;
        dx = (gradX / length) * magnitude;
        dy = (gradY / length) * magnitude;
      }

      const i = (y * width + x) * 4;
      image.data[i] = 128 + dx * 127;
      image.data[i + 1] = 128 + dy * 127;
      image.data[i + 2] = 128;
      // 바깥 영역도 중립값 + 불투명으로 채워 경계 샘플링 아티팩트를 막는다
      // (실제 표시는 요소의 border-radius로 잘린다)
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const dataUrl = canvas.toDataURL();
  mapCache.set(key, dataUrl);
  return dataUrl;
}

const svgNS = 'http://www.w3.org/2000/svg';

function svgElement(
  name: string,
  attributes: Record<string, string>,
): SVGElement {
  const el = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

// 한 채널만 남기는 feColorMatrix 행렬.
// 주의: feComposite arithmetic은 premultiplied alpha로 연산하므로
// 알파를 0으로 만들면 해당 채널의 색이 통째로 사라진다. 알파는 전부 유지한다.
const CHANNEL_MATRICES: Record<'R' | 'G' | 'B', string> = {
  R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
};

/**
 * strength(px)만큼 가장자리를 굴절시키는 SVG 필터를 주입하고 id를 반환한다.
 * 실제 유리처럼 보이도록 RGB 채널을 서로 다른 굴절량으로 변위시켜(색수차)
 * 가장자리에 미세한 색 번짐을 만든다.
 */
export function createLiquidGlassFilter(geometry: GlassGeometry, strength: number): string {
  const id = `liquid-glass-${filterCounter++}`;

  const filter = svgElement('filter', {
    id,
    // linearRGB로 보간되면 128이 '변위 없음'이 아니게 되므로 sRGB 고정
    'color-interpolation-filters': 'sRGB',
  });

  filter.appendChild(
    svgElement('feImage', {
      href: buildDisplacementMap(geometry),
      x: '0',
      y: '0',
      width: String(geometry.width),
      height: String(geometry.height),
      result: 'map',
    }),
  );

  // 채널값 0~255가 -scale/2~+scale/2로 매핑되므로 strength(px)의 2배가 기준 scale.
  // 채널별 굴절률 차이(색수차): R은 덜, B는 더 꺾인다.
  const channelScales: ['R' | 'G' | 'B', number][] = [
    ['R', strength * 2 * 0.93],
    ['G', strength * 2],
    ['B', strength * 2 * 1.07],
  ];
  for (const [channel, scale] of channelScales) {
    filter.appendChild(
      svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'map',
        scale: String(scale),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: `disp${channel}`,
      }),
    );
    filter.appendChild(
      svgElement('feColorMatrix', {
        in: `disp${channel}`,
        type: 'matrix',
        values: CHANNEL_MATRICES[channel],
        result: `ch${channel}`,
      }),
    );
  }

  // 채널 합성: R+G → B까지 더해 최종 RGB 완성
  filter.appendChild(
    svgElement('feComposite', {
      in: 'chR',
      in2: 'chG',
      operator: 'arithmetic',
      k1: '0',
      k2: '1',
      k3: '1',
      k4: '0',
      result: 'rg',
    }),
  );
  filter.appendChild(
    svgElement('feComposite', {
      in: 'rg',
      in2: 'chB',
      operator: 'arithmetic',
      k1: '0',
      k2: '1',
      k3: '1',
      k4: '0',
    }),
  );

  ensureSvgRoot().appendChild(filter);
  return id;
}

type ApplyOptions = {
  radius: number;
  bezel: number;
  strength: number;
  /** 마우스를 올린 동안의 굴절 강도. 생략하면 호버 상태 없음 */
  hoverStrength?: number;
  /** 누르는 동안의 굴절 강도. 생략하면 프레스 상태 없음 */
  pressedStrength?: number;
};

/**
 * 요소에 리퀴드 글래스 backdrop-filter를 적용한다.
 * hoverStrength/pressedStrength가 있으면 호버·프레스 동안 굴절이 강해진다.
 * 지원 브라우저(Chromium)에서만 적용되고, 성공 여부를 반환한다.
 */
export function applyLiquidGlass(element: HTMLElement, options: ApplyOptions): boolean {
  if (!supportsLiquidGlass()) return false;
  const rect = element.getBoundingClientRect();
  const geometry: GlassGeometry = {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    radius: options.radius,
    bezel: options.bezel,
  };
  const restId = createLiquidGlassFilter(geometry, options.strength);
  const hoverId =
    options.hoverStrength === undefined
      ? null
      : createLiquidGlassFilter(geometry, options.hoverStrength);
  const pressedId =
    options.pressedStrength === undefined
      ? null
      : createLiquidGlassFilter(geometry, options.pressedStrength);

  let hovered = false;
  let pressed = false;

  const update = () => {
    const id = (pressed && pressedId) || (hovered && hoverId) || restId;
    element.style.backdropFilter = `url(#${id})`;
  };
  update();

  if (hoverId || pressedId) {
    element.addEventListener('pointerenter', () => {
      hovered = true;
      update();
    });
    element.addEventListener('pointerleave', () => {
      hovered = false;
      pressed = false;
      update();
    });
    element.addEventListener('pointerdown', () => {
      pressed = true;
      update();
    });
    const release = () => {
      pressed = false;
      update();
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
  }
  return true;
}
