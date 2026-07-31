# AGENTS.md

## 개인 정보 금지 (최우선)

- 이 저장소의 어떤 파일에도 **개인 정보를 절대 넣지 않는다.** 이메일, 실명, 연락처, 소속,
- 계정 자격 증명, 로컬 컴퓨터 정보, 개인의 습관·선호·작업 방식 등 일체 금지.
  커밋 메시지·코드 주석·문서 모두 해당.
- 이 파일(AGENTS.md)을 수정할 때도 같은 원칙을 지킨다.

## 작업 방식

- UI 문구·주석·문서는 한국어를 기본으로 한다.
- 변경 후에는 반드시 `npm run build`로 빌드가 깨지지 않는지 확인한다.
- 커밋·push는 명시적으로 요청받았을 때만 한다.
- 에이전트가 preview 서버를 띄웠다면 작업 후 정리한다.

## 프로젝트 개요와 결정 사항

- Astro 정적 사이트. GitHub Pages 사용자 사이트(저장소 이름 = `killterm.github.io`)라서
  **base 경로 없이 루트로 서비스**된다. `astro.config.mjs`의 `site`만 설정.
- 배포는 `.github/workflows/deploy.yml`이 담당 (`release` 브랜치 push 시 자동).
  저장소 설정에서 Pages Source를 "GitHub Actions"로 지정해야 동작한다.
- 랜딩 페이지(`src/pages/index.astro`)는 런치패드 스타일 타일 그리드. 새 도구를
  추가하면 `apps` 배열에 타일을 추가한다.
- 사이트 표기 브랜드명은 **Killterm**(첫 글자 대문자). localStorage 키(`killterm-*`)와
  도메인 식별자는 소문자 유지.
- 외부 도메인 링크의 `utm_source=killterm.github.io`는 `Layout.astro`의 전역
  스크립트가 로드 시 자동으로 붙인다. 개별 페이지에서 직접 붙이지 말 것.
- 리퀴드 글래스(굴절): `src/lib/liquid-glass.ts` — displacement map을 캔버스로
  생성해 SVG 필터(feImage+feDisplacementMap)로 주입하고 `backdrop-filter: url()`로
  적용한다(kube.io/blog/liquid-glass-css-svg 기법). 주의: url()에 다른 필터 함수를
  체이닝하면 Chromium에서 무시될 수 있어 단독으로 쓴다. Chromium 전용이므로 적용
  대상에는 반드시 CSS 폴백(반투명 + blur)을 함께 둔다. 누르는 동안 scale이 큰
  필터로 교체해 굴절이 강해지는 프레스 상태를 지원한다(map 재계산 없음).
- range 슬라이더는 `src/components/GlassSlider.astro` 공용 컴포넌트를 쓴다
  (스타일·프레스 동작·썸 굴절이 한 곳에서 관리, `--thumb-glass` CSS 변수 경유).
  페이지 쪽에서 폭 등을 조정할 때는 컴포넌트 요소라 `:global(.glass-slider)`로
  선택해야 한다. 테마 토글 버튼은 Layout에서 `applyLiquidGlass`로 직접 적용.
- 테마: 다크 기본 + 라이트 지원. `Layout.astro`의 `:root` CSS 변수 팔레트
  (+`--danger`)를 라이트에서 재정의하고, OS 설정 추종(`prefers-color-scheme`) +
  수동 토글(우상단 고정 버튼, localStorage `killterm-theme`, FOUC 방지 인라인
  스크립트) 구조다. 새 스타일은 하드코딩 색 대신 CSS 변수를 쓰고, 변수로 안 되는
  테마별 색은 `light-dark()`를 쓴다(color-scheme이 테마별로 설정되어 있어 동작).

### 스타일 규칙

- 페이지/컴포넌트 스타일은 Astro **스코프 `<style>`이 기본**이다.
  이유: 스타일이 마크업 옆에 있어야 수정 시 영향 범위가 그 파일로 한정되고
  (낮은 결합도), 페이지를 지우면 스타일도 함께 사라져 죽은 CSS가 쌓이지
  않으며, 전역 캐스케이드 충돌을 원천 차단할 수 있다.
- 여러 페이지에서 똑같이 보여야 하는 공용 프리미티브(`.btn`, `.chip`,
  `.hint`, `.status`, 공용 input)는 **전역 한 곳으로 모으는 방향**이다.
  이유: 페이지별 복제는 한 곳만 고치고 나머지를 빠뜨리는 시각적 드리프트를
  낳는다 (실제로 페이지 간 버튼 패딩이 미묘하게 어긋난 전례가 있음).
  현재는 여러 페이지에 복제되어 있는데, 새 페이지를 만들 때 복제를 더
  늘리지 말고 기회가 될 때 전역 시트로 걷어낸다.
- **SCSS는 도입하지 않는다.**
  이유: SCSS의 주요 이점이 이 프로젝트에서는 이미 대체되어 있다 — 변수는
  CSS 커스텀 프로퍼티(다크/라이트 테마 시스템이 여기 의존), 중첩은 네이티브
  CSS nesting으로 충분하다. 남는 것은 mixin/함수뿐인데 그걸 쓸 만큼 스타일
  로직이 복잡하지 않아, 빌드 의존성만 늘어난다. mixin이 실제로 필요해지는
  시점이 오면 재검토한다.
- 스타일만을 위한 컴포넌트는 만들지 않는다. **마크업+동작이 함께 반복될
  때만** 컴포넌트화한다 (선례: GlassSlider, ToolPage).
  이유: 스타일 재사용만이 목적이면 CSS 클래스로 충분하고, 컴포넌트 간접화는
  파일 이동·props 정의 비용만 추가한다. 컴포넌트의 가치는 마크업 구조와
  스크립트 동작을 한 곳에서 관리할 때 생긴다.
- JS로 동적 생성하는 노드에는 스코프 해시 속성이 붙지 않으므로 `:global()`로
  스타일링한다. `hidden` 속성과 명시적 `display`를 함께 쓰는 요소에는
  `[hidden] { display: none }` 오버라이드를 잊지 말 것.
  이유: 스코프 CSS는 빌드 시점 마크업에만 해시를 부여하고, 명시적 display는
  UA 스타일시트의 `[hidden]` 규칙보다 우선한다 — 둘 다 이 저장소에서 실제로
  밟았던 함정이다 (만다라트 preview, glb anim-row 등).

### 탭형 도구 페이지 공통 구조 (개발 도구 · 하드웨어 테스트 · 스테가노그래피)

- 탭 하나가 곧 정적 페이지 하나다 (해시 대신 고유 URL 경로):
  `/devtools/{timestamp,json,regex,diff,color,random,cron}/`,
  `/hwtest/{keyboard,mouse,touch,monitor,reaction,sound,webcam,mic,geo,network}/`,
  `/steganography/{polyglot,metadata,image,dct,audio,audio-frequency,spectrogram,visual-crypto,text,analyze}/`.
- 공용 셸은 `src/components/ToolPage.astro` — 홈 링크·소개·링크형 탭 바·본문
  슬롯. 공통 컨트롤 스타일(.btn/.chip/.status/.hint/.field-row/textarea)은
  여기의 `<style is:global>`에 `.tool-main` 프리픽스로 선언되어 있다.
- 탭 목록·소개 문구는 `src/lib/tool-tabs.ts`에서 공유하고, 각 페이지는
  `active`로 자기 경로를 넘긴다. 탭 마크업·스크립트·스타일은
  `src/components/{devtools,hwtest,steganography}/*Tab.astro`에 있다.
- `/devtools/`·`/hwtest/` index는 옛 해시 링크(`/hwtest/#keyboard`) 호환용
  리다이렉트 페이지다 (해시를 경로로 매핑). `/steganography/` index는 첫 탭으로 보낸다.
- JS로 동적 생성하는 노드(키 로그 행, 매치 테이블 등)에는 scoped 해시가 안
  붙으므로 `:global()` 셀렉터로 스타일링한다.

### 개발 도구 (`src/pages/devtools/`)

- 타임스탬프 자동 감지: 정수부 10자리 이하 초, 11자리 이상 밀리초 (배지로 표시).
  [지금] 버튼은 밀리초를 넣는다.
- JSON 에러 위치는 브라우저별 메시지(position/line·column)에서 추출하고,
  추출 실패 시 메시지만 표시하는 강등 경로가 있다.
- 정규식은 제로 폭 매치 무한 루프를 피하려고 matchAll만 쓰고, 매치 5,000개 상한.
- Diff: 줄 단위 LCS(공통 앞뒤 구간 제외 후 DP). DP 셀 400만 개 상한으로
  브라우저 멈춤을 방지한다.
- 색상: 파싱은 canvas fillStyle 정규화 + CSS.supports 검증. 대비는 WCAG
  상대 휘도 공식.
- 랜덤: crypto 기반. 문자열은 modulo 편향을 피하는 rejection sampling.
- Cron: 5필드(분 시 일 월 요일), 일·요일이 모두 제한되면 표준 cron처럼 OR.
  다음 실행은 날짜 단위로 건너뛰며 최대 5년 탐색.

### 하드웨어 테스트 (`src/pages/hwtest/`)

- 키보드: 전용 페이지라 포커스 없이 항상 캡처(Esc 포함). F5/F11/Ctrl·Cmd 조합만
  기본 동작 유지. Meta keyup·blur 시 눌린 키 집합 초기화(keyup 유실 대응).
  배열 시각화(104키)는 본문 컬럼 밖으로 브레이크아웃해 뷰포트 폭까지 쓴다.
- 마우스: 버튼 5개 시각화(눌림/눌렀던 기록), 같은 버튼 클릭 간격 80ms 미만은
  의심 더블클릭으로 표시, 휠 카운트, 폴링레이트(250ms 창 이벤트 수 × 4,
  지원 시 pointerrawupdate). 테스트 영역 안에서만 기본 동작 차단.
- 터치: Pointer Events 기반 멀티터치 시각화. 궤적은 누적 캔버스에 남겨
  데드존을 확인한다(리사이즈 시 초기화). `touch-action: none` 필수.
- 모니터: 전체화면 종료 감지는 `fullscreenchange`, 미지원 환경은 fixed 오버레이
  폴백. 주사율은 rAF 간격의 중앙값으로 산출해 일반 주사율에 ±3% 스냅.
- 반응속도: pointerdown 계측, 시작 시각은 rAF 안에서 기록. 역대 최고 기록은
  localStorage `killterm-hwtest-reaction-v1` = `{best: number}`.
- 사운드: AudioContext는 첫 클릭에서 지연 생성(자동재생 정책), 오실레이터는
  재생마다 새로 생성, 시작/정지에 20ms 게인 램프(팝 방지). 출력 장치 선택은
  `AudioContext.setSinkId`(Chromium 전용, 미지원 브라우저는 disabled)이고,
  장치 라벨 노출을 위해 임시 오디오 권한을 받았다 즉시 닫는다.
- 웹캠/마이크: getUserMedia 기반(HTTPS/localhost 필수), 장치 라벨은 권한 승인
  후에만 얻을 수 있어 시작 후 장치 목록을 갱신한다. "브라우저 밖으로 전송되지
  않음" 안내 문구를 유지할 것. 마이크 모니터링은 게인 0/1 전환으로 구현.
- 위치: Geolocation API + permissions.query로 권한 상태 표시. 지도(OSM 임베드)는
  좌표가 외부로 전달되므로 반드시 명시적 버튼으로만 연다.

### 3D 뷰어 (`src/pages/3d.astro`)

- three.js 기반 3D 모델 뷰어(GLB·GLTF·OBJ·STL·FBX). 파일은 로컬에서
  `URL.createObjectURL`로만 읽고 서버 업로드 없음(안내 문구 유지).
  three는 이 페이지에서만 import되어 다른 페이지 번들에 영향 없다.
- 원래 GLB 뷰어(`/glb/`)였다가 OBJ/STL/FBX 로더를 추가하며 `/3d/`로 개명.
  옛 링크 호환을 위해 `src/pages/glb.astro`는 `/3d/` 리다이렉트로 남겨 둔다.
- 확장자별 로더 분기는 `parseByExtension()` 하나로 모으고 결과를
  `{ scene, animations }`로 통일한다. OBJ는 .mtl 등 외부 파일을 지원하지
  않아 기본 재질로 표시(안내 문구 있음), STL은 geometry만 오므로 직접
  Mesh(MeshStandardMaterial)로 감싸고 normal이 없으면 계산한다.
  FBX는 애니메이션 클립까지 지원.
- DRACO 압축 지원: 디코더는 `public/draco/`에 커밋되어 있다
  (three 패키지의 `examples/jsm/libs/draco/gltf/`에서 복사, CDN 의존 없음).
  three 업그레이드 시 함께 갱신할 것.
- Box3 바운딩으로 카메라·그리드 자동 프레이밍, 배경색은 --bg-soft를 읽어
  테마 연동(MutationObserver로 data-theme 감시). 새 모델 로드 시 이전
  geometry/material을 dispose한다.
- 기본 모델 3개가 `public/models/`에 내장되어 있다 — Fox.glb(PixelMannen·
  @tomkranis, CC BY 4.0), RobotExpressive.glb(Tomás Laulhé, CC0),
  Duck.gltf(base64 내장형 단일 .gltf, Sony, SCEA Shared Source License).
  페이지의 출처 표기를 유지할 것. 애니메이션 컨트롤은 숨기지 않고
  disabled + 음영으로 표시한다.
- 애니메이션이 없는 모델에는 뷰어가 KeyframeTrack으로 기본 클립(회전/둥실)을
  런타임 생성해 제공한다 (자동 재생은 하지 않음).

### 이미지 편집 (`src/pages/image.astro`)

- 포토샵/GIMP식 전폭 에디터 레이아웃: 좌측 툴바(이동 V/자르기 C + undo/redo) ·
  중앙 캔버스(체커보드) · 우측 패널(레이어/캔버스/내보내기/EXIF) · 하단 상태 바.
  다른 도구 페이지와 달리 본문 폭 제한이 없다. UI 명칭은 "문서" 대신 "캔버스".
- undo/redo: 스냅숏 기반(Ctrl+Z / Ctrl+Shift+Z·Ctrl+Y, 상한 30개). 레이어
  픽셀(canvas)은 편집 시 새 객체로 교체될 뿐 변형되지 않으므로 스냅숏은
  레이어 객체만 복제하고 canvas 참조를 공유한다. 이 불변 규칙을 깨는
  기능(예: 레이어 픽셀 직접 그리기)을 추가하면 스냅숏 방식도 함께 바꿀 것.
- **레이어 시스템**: 파일 선택·드래그&드롭·붙여넣기가 전부 새 레이어로 추가된다.
  첫 이미지가 문서 크기를 정의, 이후 레이어는 중앙 배치. 레이어별 표시 토글·
  순서 이동·삭제. 이동 도구는 활성 레이어를 드래그로 옮긴다.
- 레이어는 표시 크기(w/h)를 따로 가진다 — 스케일은 원본 픽셀(canvas)을 건드리지
  않는 **비파괴** 방식(합성 시 drawImage로 리샘플). 이동 도구에서 활성 레이어에
  점선 외곽선 + 모서리 핸들이 표시되고, 핸들 드래그로 비율 유지 스케일.
- 텍스트 도구(T): 캔버스 클릭 위치에 **인플레이스 입력 박스**(textarea, 실제
  렌더링과 같은 폰트·크기·색)를 띄워 그 자리에서 입력한다 (Enter 확정 ·
  Shift+Enter 줄바꿈 · Esc 취소, 기존 텍스트 레이어 클릭 = 수정). 편집 중인
  레이어는 합성에서 제외된다. 텍스트는 캔버스에 베이크되지만 원본 속성을
  layer.text에 보관해 재베이크 수정이 가능하다 (canvas 교체라 불변 규칙 유지).
  크기/색 옵션 조작 시 blur로 편집이 닫히지 않도록 relatedTarget을 확인한다.
- 폰트: 시스템 서체 프리셋(고딕/명조/고정폭/궁서/Impact) + 사용자 폰트 첨부
  (FontFace API, TTF/OTF/WOFF, 세션 한정 — 새로고침 시 사라짐).
- 자르기 = 캔버스 크기 축소 + 전 레이어 오프셋 이동(픽셀 보존, GIMP 스타일 안쪽
  브래킷 핸들·비율 프리셋). 캔버스 리사이즈 = 레이어 표시 크기·오프셋만 스케일.
- 오버레이/선택 좌표는 전부 **문서 픽셀 기준**이고, 핸들·선 두께만 표시 배율로
  나눠 화면에서 일정하게 보이게 한다.
- 내보내기는 보이는 레이어 합성(flatten) → PNG/JPG/WebP/AVIF. toBlob은 미지원
  형식을 조용히 PNG로 대체하므로 반드시 blob.type을 검증한다 (AVIF는 Chromium만,
  WebP는 Safari 미지원). canvas 재인코딩이라 EXIF가 제거된다(보호 기능으로 안내).
- EXIF 파서는 `src/lib/exif.ts` — JPEG APP1의 TIFF IFD를 직접 파싱(의존성 없음),
  레이어별로 저장하고 GPS 좌표는 sensitive로 경고 표시.

### 스프라이트 시트 플레이어 (`src/pages/sprite.astro`)

- 스프라이트 시트 PNG를 격자로 잘라 canvas에서 애니메이션 재생. 격자 모드
  (폭/높이/여백/간격/프레임 수, 행 우선, 실시간 격자 오버레이)와 메타데이터
  모드(Aseprite/TexturePacker JSON — 프레임 좌표·프레임별 duration·frameTags
  클립)를 지원한다. 프레임별 duration이 있으면 FPS 입력은 비활성.
- 재생: 루프/핑퐁/한 번, 프레임 스텝, 배율, `image-rendering: pixelated` 토글.
  백그라운드 복귀 시 누적 시간을 1초로 제한해 몰아 돌지 않게 한다.
- 예시 시트는 `public/sprites/` — 자체 제작(CC0): ball.png(48×48×8, squash
  데모), coin.png(32×32×6), ball.json(Aseprite 형식, 클립·가변 duration 데모).
  생성 스크립트는 의존성 없는 최소 PNG 인코더로 만들었다(재생성 시 참고).
- 내보내기: ① 재생 시퀀스를 균일 그리드 PNG로 재베이크(최대 16열 래핑) —
  Aseprite Import Sprite Sheet용이며 프레임 크기 안내 문구를 함께 표시.
  ② GIF(gifenc, rgba4444 팔레트로 투명도 유지) — Aseprite가 프레임 시간까지
  애니메이션으로 가져오는 유일한 경로. Aseprite JSON은 역방향 임포트가 없어
  내보내지 않는다.

### 레트로 SFX 생성기 (`src/pages/sfx.astro`)

- **원본 오디오 파일 없이 파라미터 합성만으로 소리를 만든다.** 레트로 SFX는
  애초에 샘플 재생이 아니라 절차적 합성 장르 — 오실레이터(사각/톱니/사인/
  노이즈)를 수식으로 직접 샘플 배열에 쓰고, 피치 슬라이드(점프=위, 레이저=
  아래)·비브라토·아르페지오(동전의 "삐리링")·듀티·페이저·필터를 시간축에
  건 뒤, attack/sustain/decay 엔벨로프로 볼륨 곡선을 씌운다. 원조는
  sfxr(DrPetter, 2007)이고 Bfxr/jsfxr/ChipTone이 그 계보다. sfxr은 퍼블릭
  도메인 취지로 공개되어 파라미터 모델을 따라도 라이선스 문제 없음.
- **외부 의존성 0개**: 합성 엔진은 `src/lib/sfx-synth.ts`(sfxr SynthSample의
  TS 포팅, 계수까지 원본 그대로 유지해 비교 가능), WAV 내보내기는
  `src/lib/wav-encode.ts`(RIFF 헤더 44바이트 + 16-bit PCM mono를 DataView로
  직접 기록). 스프라이트 예시 PNG를 인코더 없이 만든 것과 같은 접근.
- Web Audio API는 **재생에만** 쓴다 — 합성이 결정적인 순수 계산이라
  OfflineAudioContext가 필요 없고, Node로 그대로 검증할 수 있다(프리셋별
  NaN/범위/무음 검사 + WAV 헤더 필드 검증을 거침). AudioContext는 자동재생
  정책 때문에 첫 사용자 제스처에서 lazy 생성.
- 프리셋(동전/레이저/폭발/파워업/피격/점프/블립)·랜덤·변형(mutate)의 랜덤
  범위는 sfxr 원본을 따른다. 단 mutate는 freqLimit을 건드리지 않는다 —
  시작 주파수보다 높아지면 첫 샘플에서 종료되어 무음이 되기 때문(원본도
  제외). 슬라이더 메타데이터(`PARAM_GROUPS`)는 빌드 시 렌더링과 클라이언트
  범위 클램프가 공유한다.
- 원리 설명은 두 곳에 역할을 나눠 둔다: 페이지의 접이식 `<details>`는
  방문자용 3단계 요약, 이 문서는 유지보수자용 설계 근거.
- 파형에 `triangle`을 추가했다(Bfxr가 sfxr에 추가한 파형). `WAVE_TYPES`의
  앞 4개 순서는 sfxr 원본 그대로 유지해야 한다 — 프리셋/랜덤의 정수 매핑이
  이 순서에 의존한다. 출력은 원래 16-bit/44.1kHz라 "8비트 느낌"은 비트
  심도가 아니라 파형의 단순함에서 온다 (음색 확장 = 파형/합성 추가).
- **SFX 보관함**(`src/lib/sfx-store.ts`): localStorage `killterm-sfx-sounds`에
  `{id, name, params}[]` 저장. 읽을 때 `defaultParams()` 위에 덮어 이후
  파라미터가 추가돼도 옛 저장본이 동작한다. 칩튠 작곡기가 악기 목록으로 공유.

### 칩튠 작곡기 (`src/pages/composer.astro`)

- SFX 보관함의 소리를 **악기**로 써서 곡을 만드는 패턴 기반 시퀀서.
  용어 주의: 소리를 타임라인에 배치하는 것은 믹싱이 아니라
  **시퀀싱** — 믹싱은 트랙 볼륨/밸런스 후반 작업.
- **음정 매핑**(`src/lib/composer-engine.ts`): sfxr 파라미터에서 baseFreq만
  음표 주파수로 치환해 재합성하면 같은 음색으로 모든 음정이 나온다.
  sfxr 내부 스텝이 초당 44100×8이고 period = 100/(baseFreq²+0.001)이므로
  `freq = 3528×(baseFreq²+0.001)`, 역산 `baseFreqForHz = √(hz/3528 − 0.001)`
  (유효 ~3.5Hz–3528Hz, 피아노롤 C3~B5는 여유). Node에서 사인파
  zero-crossing으로 정확도 검증함.
- **채널 4개, 모노포닉(스텝당 한 음), 노트는 원샷**(길이는 엔벨로프가 결정)
  — 칩튠 하드웨어/LC 관례이자 구현 단순화. 화음이 필요하면 채널을 나눠 쓴다.
- **곡 구조**: 패턴(32스텝 = 16분음표×2마디) 여러 개 + 시퀀스(패턴 인덱스
  나열). 곡 JSON에는 악기를 참조가 아니라 **파라미터로 내장**한다 — JSON
  파일 하나로 다른 브라우저에서도 완전 재생 가능.
- **재생은 룩어헤드 스케줄러**: setInterval(25ms)로 0.12초 앞까지
  AudioBufferSource를 오디오 클록 기준 예약("tale of two clocks" 패턴).
  setTimeout/rAF 직접 발음은 째깍임이 밀린다. 노트 렌더는 파라미터
  JSON+노트를 키로 캐시(노이즈 파형이 Math.random 기반이라 캐시가 세션 내
  일관성도 담보), AudioBuffer는 Float32Array를 키로 WeakMap 캐시.
- **WAV 내보내기**는 실시간 녹음이 아니라 `mixSong()` 오프라인 믹스다운
  (채널 볼륨 × 마스터 × 0.5 헤드룸, 클램프) — 순수 함수라 Node 검증 공유.
- 곡은 localStorage `killterm-composer-song`에 자동 저장 + JSON
  내보내기/가져오기(만다라트 관례). 가져오기는 `normalizeSong()`으로 형태
  검증·기본값 보강.
- **예시 곡**(자체 제작 · CC0): `public/songs/demo.json` — C장조 8마디,
  패턴 A(C→G)·B(Am→F), 시퀀스 [A,A,B,A]. 내장 악기 파라미터를 그대로 쓰도록
  생성 스크립트에서 `BUILTIN_INSTRUMENTS`를 임베드해 만들었다(재생성 시
  스크립트로). 버튼은 현재 곡을 덮어쓰므로 confirm 후 곡 모드로 자동 재생.

### 루프 스테이션 (`src/pages/looper.astro`)

- 마이크 오디오 루퍼(RC-505류): 첫 녹음 길이가 마스터 루프가 되고,
  이후 트랙 녹음은 루프 위치에 접어 넣는 오버더브. 트랙 4개.
- **캡처는 AudioWorklet** (MediaRecorder 아님) — MediaRecorder는 압축·
  디코딩 지연 때문에 샘플 정확도가 없어 루프 경계가 어긋난다. 워클릿
  코드는 Blob URL로 `addModule`해 페이지에 자체 포함(빌드 설정 불필요).
  입력 mono를 `{frame: currentFrame, samples}`로 상시 전송하고 메인
  스레드가 녹음 중일 때만 소비한다. 워클릿 출력은 무음이지만 게인 0을
  거쳐 destination까지 이어야 process가 돈다(그래프 풀링).
- **샘플 정렬**(`src/lib/looper-engine.ts`, 순수 로직·Node 검증):
  `position = (chunkFrame − loopStartFrame − latencyFrames) mod loopLength`.
  latencyFrames = 자동 추정(baseLatency+outputLatency) + 수동 슬라이더 —
  마이크 경로 지연은 브라우저가 알려주지 않아 완전 자동 보정이 불가능하므로
  수동 보정(-200~+200ms)을 둔다(박수 테스트 안내 포함). 이게 방식의 한계.
- **오버더브 = 복제 후 합산, 버퍼는 교체만**(이미지 편집기의 스냅숏
  불변 규칙과 동일) — previousBuffer 스냅숏으로 1단계 실행취소.
  재생 중 교체는 다음 루프 경계 시각에 old.stop(t)/new.start(t).
- 트랙 재생은 `AudioBufferSourceNode(loop=true)`를 공통 기준 시각에
  시작해 동기 유지. **음소거는 소스를 멈추지 않고 게인만 0** (동기 보존).
- getUserMedia에서 echoCancellation/noiseSuppression/autoGainControl을
  전부 끈다 — 통화용 음성 처리는 음악 녹음을 왜곡한다. 그래서 스피커
  청취 시 재유입이 그대로 들어오므로 **이어폰 권장 안내 + 입력 모니터링
  기본 꺼짐**이 필수다. autoGainControl이 꺼져 녹음이 작을 수 있어
  **입력 게인**(GainNode, 0~300%)을 워클릿 앞에 둔다 — 녹음·모니터링·
  레벨 미터 모두에 반영된다. 마이크 중지 버튼은 스트림만 놓아주고
  루프/재생은 유지한다.
- 내보내기는 mixTracks() 오프라인 믹스다운(루프 1회) → encodeWav 재사용.

### 스테가노그래피 (`src/pages/steganography/`)

데이터를 파일·글 속에 숨기고 찾는 탭 그룹. 전부 브라우저 안에서 처리한다.
**URL에 약어(`/steg/`)를 쓰지 않는다** — 경로만 보고 무엇인지 알 수 있어야 한다.

**기법을 층위별로 모아 둔 것이 이 그룹의 핵심**이다. 같은 기법을 캐리어만 바꿔
반복하지 말고, 은닉 위치가 실제로 다른 것을 추가한다:

| 탭 | 어디에 숨기나 | 성질 |
| --- | --- | --- |
| 폴리글랏 | 파일 **뒤에** 이어 붙임 | 원본 무손실, 검사 도구가 쉽게 발견 |
| 메타데이터 | 파일 구조의 **빈 자리** | 재인코딩 없음(화질 그대로), exiftool로 즉시 발견 |
| 이미지 LSB | 픽셀 **최하위 비트** | 용량 큼, 재압축하면 소멸 |
| 이미지 DCT | 8×8 블록 **주파수 계수** | 용량 작음, **JPEG 재압축 생존** |
| 오디오 LSB | 샘플 최하위 비트 | 용량 큼, 변환하면 소멸 |
| 오디오 주파수 | 위상 · FSK · 에코 | 각각 다른 트레이드오프(아래) |
| 스펙트로그램 | 소리의 **그림** | 데이터 복원용이 아닌 보여주기 |
| 시각 암호 | 조각 두 장으로 **분산** | 한 장은 정보 0(정보이론적 안전) |
| 텍스트 | 제로폭 · 호모글리프 · 공백 | 글 자체에 숨김 |

- **공용 프레임**(`src/lib/steganography-frame.ts`):
  `magic "KSTG"(4) | version(1) | kind(1) | nameLen(1) | name | dataLen(4, BE) |
  data`. 자기 기술적이라 추출 시 검증할 수 있고, 모든 기법과 분석 탭이 공유한다.
  LSB 함수(`lsbWrite/lsbRead/readFrameFrom`)는 **컨테이너 + 슬롯 인덱스 목록**으로
  일반화해 이미지(RGB, 알파 제외)와 오디오(Int16)가 같은 코드를 쓴다.
  WAV는 재인코딩하지 않고 data 청크만 in-place 패치한다(16-bit PCM 전용,
  `wavSampleView`는 byteOffset 홀수면 복사본을 주므로 쓰기 후 되반영 필요).
- **FFT·DCT를 직접 구현한 이유**(`src/lib/fft.ts`, `dct.ts`): 브라우저에 임의
  배열용 FFT가 없고 AnalyserNode는 실시간·크기 전용이라 위상을 주지 않는다.
  JPEG 양자화 계수에도 접근할 수 없어 픽셀에서 DCT를 직접 계산한다.
- **이미지 DCT**(`steganography-dct.ts`): 파랑 채널(눈이 가장 둔감) 8×8 블록의
  중간 주파수 계수 3개에 QIM(Δ=32) + 비트당 3블록 반복·다수결. Δ가 크고 반복이
  있어야 JPEG가 버리는 미세 차이를 이긴다. 저주파는 눈에 띄고 고주파는 압축에
  먼저 버려지므로 중간대만 쓴다. 8×8 격자를 쓰는 이유는 JPEG 블록과 일치시켜
  재압축 시 계수 위치가 어긋나지 않게 하기 위함이다.
- **오디오 주파수**(`steganography-audio.ts`) 세 기법의 트레이드오프:
  위상 코딩은 구간 1024샘플당 1비트(약 5바이트/초)로 용량이 작고 구간 경계가
  어긋나면 복원이 깨진다(겹치지 않게 자르는 대신 경계에서 약한 클릭 가능).
  FSK는 캐리어에 숨기는 게 아니라 소리 자체가 데이터이며, 프리앰블로 심볼 경계를
  찾고 Goertzel로 복조한다 — 초음파(18.5/19.5kHz)는 대부분의 성인에게 들리지 않아
  기기 간 마이크 수신 시연이 가능하지만 하드웨어에 따라 실패한다. 에코는 켑스트럼
  피크로 읽으며 용량이 가장 작다(4096샘플당 1비트).
- **메타데이터**(`steganography-metadata.ts`): PNG는 텍스트를 표준 iTXt(UTF-8),
  파일을 사설 청크 `stEg`(ancillary·private·safe-to-copy)에 넣는다. JPEG는 COM
  세그먼트를 쓰고 64KB를 넘으면 분할·재조립한다. 어느 쪽도 이미지 데이터를 다시
  압축하지 않는다.
- **시각 암호**(`visual-crypto.ts`): Naor–Shamir 2-of-2, 픽셀당 2×2 확장.
  흰색은 두 share에 같은 패턴·검정은 보수 패턴 → 겹치면(OR) 검정만 완전히 채워진다.
  조각은 반드시 무손실(PNG)로 주고받아야 한다.
- **스펙트로그램**(`spectrogram.ts`): 프레임별 IFFT + 무작위 위상 + Hann
  overlap-add. 위상이 무작위라 소리는 잡음처럼 들리고 스펙트로그램 모양만 남는다.
- **텍스트 3종**(`steganography-text.ts`): 제로폭(어디든 넣지만 필터가 잘 지움),
  호모글리프(필터 통과하지만 라틴 글자 수만큼만 담김 — **피싱에 악용되는 기법이라
  경고 문구 유지**), 줄 끝 공백(안 보이지만 편집기가 지울 수 있음).
- **분석 탭은 여러 기법을 한 번에 검사**한다(LSB·DCT·메타데이터·파일 끝 잔여
  데이터) + 비트플레인·LSB 통계. 숨기기 도구와 같은 그룹에 두어 **얼마나 쉽게
  들키는지 스스로 확인**하게 하는 것이 의도다.
- **암호화는 넣지 않았다** — 넣으면 "안전하다"는 오해를 만들고 키 관리까지 따라온다.
  대신 각 탭이 "기밀 보호 수단이 아니다, 중요하면 암호화한 파일을 숨기라"고 안내한다.
- **비디오 주파수 기법은 제외**했다: 의미 있는 방식은 H.264/VP9의 DCT 계수를
  건드려야 하는데 브라우저(WebCodecs 포함)가 계수를 노출하지 않는다. 프레임 밝기
  시간축 변조는 손실 압축이 지워버려 실용성이 없다.
- 폴리글랏은 원래 `/polyglot/` 단독 페이지였다가 이 그룹으로 옮겼다(옛 경로는
  리다이렉트 유지). 옮기면서 ToolPage 전역과 겹치던 `.btn`/`.status` 기본형을
  지우고, `main {}`에 있던 색 변수는 스코프가 닿지 않으므로 `.polyglot` 래퍼로
  옮겼다.
- 탭들이 같은 카드 레이아웃을 쓰므로 스코프 스타일을 복제하지 않고
  `src/styles/steganography.css`(`.steganography` 프리픽스) 하나로 모아 import한다.
  파일 읽기·내려받기·크기 표기는 `src/lib/file-io.ts`로 공유한다.

### P2P 화상 통화 (`src/pages/call.astro`)

- **수동 시그널링** WebRTC: SDP를 사람이 메신저로 복사/붙여넣기 교환.
  trickle ICE를 쓸 수 없으므로 `icegatheringstatechange === 'complete'`(+4초
  안전 타임아웃)까지 기다린 완성 SDP를 교환한다.
- 교환 코드 포맷은 `src/lib/sdp-code.ts` — deflate-raw 압축 + base64url,
  프리픽스 `kc1:` (CompressionStream 미지원 폴백 `kc0:`). QR은 npm `qrcode`로
  생성하고 용량 초과 시 QR만 생략한다.
- 구글 공개 STUN만 사용, TURN 없음 — 대칭 NAT 등에서 연결 불가를 페이지에
  명시할 것. DataChannel 'chat'은 offer 쪽이 생성한다.
- 통화 종료는 상태가 많아 location.reload()로 초기화한다.
- **1:1 전용으로 유지한다.** 다자 화상은 브라우저가 미디어를 중계(SFU)할 수
  없어 메시(전원 상호 연결)만 가능한데, 수동 시그널링에서는 코드 교환이
  N(N-1)/2쌍×2회로 조합 폭발하고(3인=6회, 4인=12회) 업로드 대역폭도 인원수
  배로 늘어난다. 다자 화상이 필요하면 서버(SFU)가 있어야 하므로 이 사이트
  범위 밖이다.

### 공동 메모장 (`src/pages/note.astro`)

- CRDT(Yjs) 메모장 + 수동 시그널링 P2P 공동 편집. 연결 로직은
  `src/lib/p2p-session.ts`(피어 생성·ICE 대기·초대/응답 코드)를 사용한다 —
  통화 페이지(call.astro)와 같은 코드 포맷(kc1:)이며, call.astro의 인라인
  로직도 추후 이 모듈로 통합할 수 있다.
- 동기화 프로토콜: DataChannel로 연결 직후 서로 state vector를 보내고
  차분 update를 회신, 이후 로컬 변경(origin === 'local')만 update로 전송.
  origin 규칙이 루프 방지의 핵심이므로 transact/applyUpdate의 origin을
  바꾸지 말 것.
- textarea 바인딩: 로컬 입력은 공통 앞/뒤 제외 구간만 delete/insert,
  원격 변경은 delta로 커서를 보정. **한글 조합(composition) 중에는 원격
  반영을 미뤘다가 compositionend에 적용**한다 (조합 깨짐 방지).
- 영속성은 y-indexeddb(`killterm-note-v1`), 브라우저에만 저장.
- 원격 커서 표시: 닉네임(기본 User 1/2, localStorage `killterm-note-name`)과
  커서 인덱스를 'cur' 메시지로 전송(80ms 스로틀). 좌표 계산은 textarea와 같은
  레이아웃의 숨긴 미러 div로 하며, 텍스트 변경 시 delta로 상대 커서 인덱스를
  이동시킨다 — 미러 CSS는 textarea와 폰트·패딩·줄바꿈이 정확히 일치해야 한다.
- 현재 1:1이지만 **3인 이상은 호스트-스타 구조로 확장 가능**: 새 참가자는
  호스트와만 코드를 교환하고(참가자당 2회), 호스트가 Yjs 업데이트를 다른
  채널로 중계하면 된다 — CRDT 업데이트는 멱등이라 중계가 안전하고 텍스트라
  대역폭 부담이 없다. 단점은 호스트 이탈 시 세션 종료(로컬 사본은 남고
  재연결 시 병합되므로 데이터 손실은 없음). 화상 통화와 달리 확장 가치가
  있는 이유다.

### 만다라트 페이지 (`src/pages/mandalart.astro`)

- **범용 도구로 유지한다.** 특정 용도(목표, 게임 장르 등)를 암시하는 문구·예시·
  placeholder를 넣지 않는다. 다음 조건을 유지한다:
  - 셀 placeholder 없음
  - 설명 문구는 "주제 → 하위 주제 → 항목"의 중립적 표현만 사용
- 입력 칸: 글자 기본 18px(보드 위 슬라이더/숫자 입력으로 12~28px 조절, 화면 표시에만
  적용되고 생성 이미지에는 영향 없음), 수직·수평 가운데 정렬(`align-content: center`).
- 칸별 체크: 각 칸 오른쪽 위의 체크 버튼을 누르면 초록 테두리 표시. 바깥 블록의
  가운데 칸(또는 짝이 되는 가운데 블록의 하위 주제 칸)을 체크하면 그 묶음 전체가
  함께 체크/해제되고, 이 두 칸은 묶음 8칸이 모두 체크됐을 때만 체크 상태를
  유지한다(하나라도 해제되면 자동 해제). 묶음 맞바꾸기 시 체크 상태도 함께 이동하고,
  전체 지우기·프리셋 로드 시 모두 해제된다.
- 저장: localStorage 키 `killterm-mandalart-v1`, 형식
  `{cells: string[81], source: string, checks: boolean[81], fontSize: number,
  cellTransparency: number}` (예전 배열-only 형식과 일부 필드가 없는 형식도
  restore에서 하위 호환 처리).
  배경 이미지는 용량 문제로 저장하지 않는다.
- JSON 내보내기/가져오기: 내보내기는 하위 주제별 묶음 구조(v4)
  `{format: 'killterm-mandalart', version: 4, topic: {text, checked},
  groups: [{title: {text, checked}, items: [{text, checked}×8]}×8], source}`.
  순서가 필요한 groups·items만 list이고 칸 하나는 {text, checked} dict.
  title의 checked는 items에서 유도되는 값이라 가져올 때는 무시하고 다시 계산한다.
  묶음/칸 순서는 가운데(4)를 제외한 읽는 순서(`AROUND = [0,1,2,3,5,6,7,8]`).
  가져오기는 v4, v3(문자열 칸 + 병렬 checks[8] + topicChecked),
  v2(checks 없음 → 전부 해제), v1(`{cells: string[81]}`), 배열-only 모두 허용한다.
- 묶음 맞바꾸기 UI: 두 셀렉트로 묶음(1~8)을 골라 하위 주제 칸 + 바깥 블록 내용을
  통째로 교환. 셀렉트 옵션에는 현재 하위 주제 텍스트가 표시된다.
- 프리셋: `src/presets/*.json` (JSON 내보내기 형식 그대로)을 mandalart.astro
  frontmatter에서 import해 `presets` 배열에 등록하면 상단에 정사각 버튼이 생긴다.
  클릭 시 보드에 로드되며, 작성 중인 내용이 있으면 confirm으로 덮어쓰기 확인.
- 생성 이미지 스타일 (여러 차례 조정 끝에 확정된 값이니 임의로 바꾸지 말 것):
  - 테두리 선 없는 **그라데이션 카드 스타일**. 둥근 모서리 5px, 칸 간격(INSET) 4px.
    라운딩을 키우면 칸 사이에 다이아몬드 착시가 생기므로 크게 하지 말 것.
  - 기본 배경은 중간 톤 슬레이트(#3a4254) — 극단적으로 어둡게 하지 말 것.
    이때 출처 글자는 밝은 색.
  - 가운데 칸: 파랑(#4263eb)→보라(#7048e8) 그라데이션, 하위 주제 칸: 옅은 틴트,
    일반 칸: 연회색(#f2f4f9).
  - 글자: 32px에서 시작해 28→25→22→19→16px로 내용이 들어갈 때까지 자동 축소.
  - 칸 투명도: 슬라이더/숫자 입력으로 0~80% 조절, 기본 0%(완전 불투명).
    일반 칸 alpha = 1 - 투명도이고, 하위 주제(+0.04)·가운데(+0.16)는 상대 차이를
    유지한 채 함께 움직인다(상한 1.0). 배경을 은은하게 비치게 하려면 투명도를 올린다.
  - 체크된 칸은 테두리 대신 면 색이 초록 계열로 바뀐다(테두리는 잘 안 보여서 폐기).
    일반 칸: 연초록(#d3f9d8), 하위 주제 칸: 초록(#b2f2bb)→민트(#c3fae8) 틴트,
    가운데 칸: 초록(#37b24d)→틸(#0ca678) 그라데이션. 불투명도는 기존 값 그대로.
  - 출처 텍스트: 진한 색 + 배경 이미지 위에서는 반투명 흰 띠. 흐린 회색이나
    외곽선(stroke) 방식은 뿌옇게 보여서 쓰지 않기로 했다.
