// 도구 그룹별 공통 메타데이터. 탭 페이지들이 공유한다.

export type ToolTab = { label: string; href: string };

export const devtools = {
  heading: '🧰 개발 도구',
  intro: '자주 쓰는 개발 유틸리티 모음입니다. 모든 처리는 브라우저 안에서만 이루어집니다.',
  tabs: [
    { label: '타임스탬프', href: '/devtools/timestamp/' },
    { label: 'JSON', href: '/devtools/json/' },
    { label: '정규식', href: '/devtools/regex/' },
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
