// P2P 통화의 수동 시그널링 교환 코드.
// SDP(JSON)를 deflate-raw로 압축해 base64url로 인코딩한다 (프리픽스 kc1:).
// CompressionStream 미지원 브라우저는 비압축(kc0:)으로 폴백하며,
// 디코딩은 두 형식을 모두 받는다.

const PREFIX_DEFLATE = 'kc1:';
const PREFIX_PLAIN = 'kc0:';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeSignal(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  if (typeof CompressionStream === 'undefined') {
    return PREFIX_PLAIN + bytesToBase64Url(json);
  }
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return PREFIX_DEFLATE + bytesToBase64Url(compressed);
}

export async function decodeSignal(code: string): Promise<unknown> {
  const trimmed = code.trim();
  if (trimmed.startsWith(PREFIX_PLAIN)) {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(trimmed.slice(PREFIX_PLAIN.length))));
  }
  if (!trimmed.startsWith(PREFIX_DEFLATE)) {
    throw new Error('형식이 올바르지 않은 코드입니다. 복사한 코드 전체를 붙여넣었는지 확인해주세요.');
  }
  const bytes = base64UrlToBytes(trimmed.slice(PREFIX_DEFLATE.length));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}
