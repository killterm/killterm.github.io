# 작은 웹 도구 모음

[Astro](https://astro.build)로 만든 정적 웹 도구 모음입니다.

## 개발

```sh
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 정적 사이트 빌드
npm run build

# 빌드 결과 미리보기
npm run preview
```

개발 서버는 기본적으로 `http://localhost:4321`에서 실행됩니다.

## 배포

`master` 또는 `main` 브랜치에 변경 사항을 push하면 GitHub Actions가 사이트를 빌드해
GitHub Pages에 배포합니다.

저장소의 **Settings → Pages → Source**는 **GitHub Actions**로 설정해야 합니다.
