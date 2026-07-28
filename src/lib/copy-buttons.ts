// data-target이 가리키는 요소의 내용을 클립보드로 복사하는 .copy 버튼들을 활성화한다.
export function setupCopyButtons() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.copy')) {
    btn.addEventListener('click', async () => {
      const target = document.getElementById(btn.dataset.target!)!;
      const text =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
          ? target.value
          : (target.textContent ?? '');
      await navigator.clipboard.writeText(text);
      const label = btn.textContent;
      btn.textContent = '복사됨!';
      setTimeout(() => (btn.textContent = label), 1200);
    });
  }
}
