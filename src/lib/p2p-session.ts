// 수동 시그널링 P2P 연결 헬퍼 (데이터 채널용).
// SDP 교환 코드는 sdp-code.ts 포맷(kc1:)을 그대로 쓴다.
// trickle ICE를 쓸 수 없으므로 후보 수집이 끝난 SDP를 통째로 교환한다.
import { encodeSignal, decodeSignal } from './sdp-code';

export function createDataPeer(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
}

export function waitIceComplete(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', check);
    // 일부 환경에서 complete 이벤트가 늦거나 안 오므로 안전장치
    setTimeout(resolve, 4000);
  });
}

async function parseSignal(code: string, expected: 'offer' | 'answer'): Promise<RTCSessionDescription> {
  const signal = (await decodeSignal(code)) as { type?: string; sdp?: string };
  if (signal?.type !== expected || typeof signal.sdp !== 'string') {
    throw new Error(
      expected === 'offer'
        ? '초대 코드가 아닙니다. 방을 만든 쪽의 코드를 붙여넣어주세요.'
        : '응답 코드가 아닙니다. 초대를 받은 쪽의 코드를 붙여넣어주세요.',
    );
  }
  return new RTCSessionDescription({ type: signal.type, sdp: signal.sdp });
}

/** 호스트: offer를 만들고 초대 코드를 반환한다 (데이터 채널은 호출 전에 생성해둘 것) */
export async function createOfferCode(peer: RTCPeerConnection): Promise<string> {
  await peer.setLocalDescription(await peer.createOffer());
  await waitIceComplete(peer);
  const description = peer.localDescription!;
  return encodeSignal({ type: description.type, sdp: description.sdp });
}

/** 게스트: 초대 코드를 수락하고 응답 코드를 반환한다 */
export async function acceptOfferCode(peer: RTCPeerConnection, code: string): Promise<string> {
  await peer.setRemoteDescription(await parseSignal(code, 'offer'));
  await peer.setLocalDescription(await peer.createAnswer());
  await waitIceComplete(peer);
  const description = peer.localDescription!;
  return encodeSignal({ type: description.type, sdp: description.sdp });
}

/** 호스트: 상대의 응답 코드를 수락한다 */
export async function acceptAnswerCode(peer: RTCPeerConnection, code: string): Promise<void> {
  await peer.setRemoteDescription(await parseSignal(code, 'answer'));
}
