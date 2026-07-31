// 도구 그룹별 공통 메타데이터. 탭 페이지들이 공유한다.

export type ToolTab = { label: string; href: string };

export const devtools = {
  heading: '🧰 개발 도구',
  intro:
    '자주 쓰는 개발 유틸리티 모음입니다. 모든 처리는 브라우저 안에서만 이루어집니다.',
  tabs: [
    { label: '타임스탬프', href: '/devtools/timestamp/' },
    { label: '인코딩', href: '/devtools/encode/' },
    { label: '헥스', href: '/devtools/hex/' },
    { label: 'JSON', href: '/devtools/json/' },
    { label: '정규식', href: '/devtools/regex/' },
    { label: 'Diff', href: '/devtools/diff/' },
    { label: '색상', href: '/devtools/color/' },
    { label: '랜덤', href: '/devtools/random/' },
    { label: 'Cron', href: '/devtools/cron/' },
  ] satisfies ToolTab[],
};

export const thinking = {
  heading: '🧠 생각 정리',
  intro:
    '생각을 눈에 보이는 구조로 정리하는 도구 모음입니다. 작업 내용은 이 브라우저에만 저장되며 서버로 전송되지 않습니다.',
  tabs: [
    { label: '만다라트', href: '/thinking/mandalart/' },
    { label: '마인드맵', href: '/thinking/mindmap/' },
  ] satisfies ToolTab[],
};

export const steganography = {
  heading: '🕵️ 스테가노그래피',
  intro:
    '데이터를 파일이나 글 속에 숨기고 다시 찾아내는 도구 모음입니다. 모든 처리는 브라우저 안에서만 이루어집니다.',
  // 캐리어별로 묶어 둔다: 파일 구조 → 이미지 → 오디오 → 그 밖 → 분석
  tabs: [
    { label: '폴리글랏', href: '/steganography/polyglot/' },
    { label: '메타데이터', href: '/steganography/metadata/' },
    { label: '이미지 LSB', href: '/steganography/image/' },
    { label: '이미지 DCT', href: '/steganography/dct/' },
    { label: '오디오 LSB', href: '/steganography/audio/' },
    { label: '오디오 주파수', href: '/steganography/audio-frequency/' },
    { label: '스펙트로그램', href: '/steganography/spectrogram/' },
    { label: '시각 암호', href: '/steganography/visual-crypto/' },
    { label: '텍스트', href: '/steganography/text/' },
    { label: '분석', href: '/steganography/analyze/' },
  ] satisfies ToolTab[],
};

export const hwtest = {
  heading: '🖥️ 하드웨어 테스트',
  intro:
    '키보드·모니터·반응속도·사운드를 확인하는 도구 모음입니다. 모든 처리는 브라우저 안에서만 이루어집니다.',
  tabs: [
    { label: '키보드', href: '/hwtest/keyboard/' },
    { label: '마우스', href: '/hwtest/mouse/' },
    { label: '터치', href: '/hwtest/touch/' },
    { label: '모니터', href: '/hwtest/monitor/' },
    { label: '반응속도', href: '/hwtest/reaction/' },
    { label: '사운드', href: '/hwtest/sound/' },
    { label: '웹캠', href: '/hwtest/webcam/' },
    { label: '마이크', href: '/hwtest/mic/' },
    { label: '위치', href: '/hwtest/geo/' },
    { label: '네트워크', href: '/hwtest/network/' },
  ] satisfies ToolTab[],
};
