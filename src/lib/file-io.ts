// 파일 읽기·내려받기·크기 표기 — 여러 도구 페이지가 함께 쓴다.

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function formatByteSize(byteCount: number): string {
  if (byteCount >= 1048576) return `${(byteCount / 1048576).toFixed(2)}MB`;
  if (byteCount >= 1024) return `${(byteCount / 1024).toFixed(1)}KB`;
  return `${byteCount}B`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadBytes(bytes: Uint8Array, filename: string, type = ''): void {
  downloadBlob(new Blob([bytes as BlobPart], type ? { type } : undefined), filename);
}
