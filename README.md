# killterm.github.io

[Astro](https://astro.build)로 만든 작은 웹 도구 모음입니다.

## 페이지

- `/` — 런치패드 스타일 랜딩 페이지
- `/mandalart/` — 9×9 만다라트 작성 후 PNG 이미지로 저장

## 개발

```sh
npm install
npm run dev      # 개발 서버 (http://localhost:4321)
npm run build    # 정적 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기
```

## 배포

`master`(또는 `main`) 브랜치에 push하면 GitHub Actions가 자동으로 빌드해서
GitHub Pages에 배포합니다. 저장소 설정에서 **Settings → Pages → Source**를
**GitHub Actions**로 지정해야 합니다.
