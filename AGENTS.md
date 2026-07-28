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
- 테마: 다크 기본 + 라이트 지원. `Layout.astro`의 `:root` CSS 변수 팔레트
  (+`--danger`)를 라이트에서 재정의하고, OS 설정 추종(`prefers-color-scheme`) +
  수동 토글(우상단 고정 버튼, localStorage `killterm-theme`, FOUC 방지 인라인
  스크립트) 구조다. 새 스타일은 하드코딩 색 대신 CSS 변수를 쓰고, 변수로 안 되는
  테마별 색은 `light-dark()`를 쓴다(color-scheme이 테마별로 설정되어 있어 동작).

### 탭형 도구 페이지 공통 구조 (개발 도구 · 하드웨어 테스트)

- 탭 하나가 곧 정적 페이지 하나다 (해시 대신 고유 URL 경로):
  `/devtools/{timestamp,json,regex}/`, `/hwtest/{keyboard,monitor,reaction,sound}/`.
- 공용 셸은 `src/components/ToolPage.astro` — 홈 링크·소개·링크형 탭 바·본문
  슬롯. 공통 컨트롤 스타일(.btn/.chip/.status/.hint/.field-row/textarea)은
  여기의 `<style is:global>`에 `.tool-main` 프리픽스로 선언되어 있다.
- 탭 목록·소개 문구는 `src/lib/tool-tabs.ts`에서 공유하고, 각 페이지는
  `active`로 자기 경로를 넘긴다. 탭 마크업·스크립트·스타일은
  `src/components/{devtools,hwtest}/*Tab.astro`에 있다.
- `/devtools/`·`/hwtest/` index는 옛 해시 링크(`/hwtest/#keyboard`) 호환용
  리다이렉트 페이지다 (해시를 경로로 매핑).
- JS로 동적 생성하는 노드(키 로그 행, 매치 테이블 등)에는 scoped 해시가 안
  붙으므로 `:global()` 셀렉터로 스타일링한다.

### 개발 도구 (`src/pages/devtools/`)

- 타임스탬프 자동 감지: 정수부 10자리 이하 초, 11자리 이상 밀리초 (배지로 표시).
  [지금] 버튼은 밀리초를 넣는다.
- JSON 에러 위치는 브라우저별 메시지(position/line·column)에서 추출하고,
  추출 실패 시 메시지만 표시하는 강등 경로가 있다.
- 정규식은 제로 폭 매치 무한 루프를 피하려고 matchAll만 쓰고, 매치 5,000개 상한.

### 하드웨어 테스트 (`src/pages/hwtest/`)
- 키보드: 전용 페이지라 포커스 없이 항상 캡처(Esc 포함). F5/F11/Ctrl·Cmd 조합만
  기본 동작 유지. Meta keyup·blur 시 눌린 키 집합 초기화(keyup 유실 대응).
  배열 시각화(104키)는 본문 컬럼 밖으로 브레이크아웃해 뷰포트 폭까지 쓴다.
- 모니터: 전체화면 종료 감지는 `fullscreenchange`, 미지원 환경은 fixed 오버레이
  폴백. 주사율은 rAF 간격의 중앙값으로 산출해 일반 주사율에 ±3% 스냅.
- 반응속도: pointerdown 계측, 시작 시각은 rAF 안에서 기록. 역대 최고 기록은
  localStorage `killterm-hwtest-reaction-v1` = `{best: number}`.
- 사운드: AudioContext는 첫 클릭에서 지연 생성(자동재생 정책), 오실레이터는
  재생마다 새로 생성, 시작/정지에 20ms 게인 램프(팝 방지).

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
