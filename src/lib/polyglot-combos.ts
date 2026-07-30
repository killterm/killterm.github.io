// 어떤 캐리어 + 페이로드 조합이 실제로 가능한지 판단한다.
//
// 근거는 두 가지다.
//  1. Polydet 폴리글랏 데이터베이스(src/data/polyglot-db.json) — 실물 샘플이 존재하는 조합.
//     단 이 DB는 수집된 표본 모음이라, 없는 조합이 곧 불가능을 뜻하지는 않는다.
//  2. 이 도구로 직접 만들어 실제 프로그램으로 확인한 결과(VERIFIED).
//
// 그리고 DB에 있어도 이 도구의 방식(캐리어 뒤에 이어 붙이기)으로는 만들 수 없는 조합이 있다.
// 예를 들어 JPG+PDF는 PDF 헤더를 JPEG 세그먼트 안에 겹쳐 넣어야 하고, TAR 조합은 TAR 헤더
// 자체를 캐리어 헤더와 겹쳐 만들어야 한다. 이런 것은 'special'로 구분한다.

import db from '../data/polyglot-db.json';
import type { CarrierKind, PayloadKind } from './polyglot';

export type ComboStatus = 'verified' | 'known' | 'expected' | 'special' | 'no' | 'unsupported';

/** 이 도구로 만들 수 있는 조합인지 (초록/빨강 구분 기준) */
export const isSupported = (status: ComboStatus) =>
  status === 'verified' || status === 'known' || status === 'expected';

export interface ComboInfo {
  status: ComboStatus;
  /** 상태를 나타내는 짧은 말 */
  label: string;
  /** 설명 문구 */
  detail: string;
  /** 근거가 된 DB 샘플 파일명 */
  samples: string[];
}

/** DB의 형식 이름을 이 도구의 형식 id로 맞춘다 */
const DB_ALIAS: Record<string, string> = {
  jpg: 'jpeg',
  // DOCX·JAR·ODT·APK는 모두 ZIP 컨테이너다 (DB README 참고)
  jar: 'zip',
  docx: 'zip',
  odt: 'zip',
  apk: 'zip',
};

const normalize = (type: string) => DB_ALIAS[type] ?? type;

/** 이 도구로 만들어 실제 프로그램으로 확인한 조합 */
const VERIFIED = new Map<string, string>([
  ['jpeg|zip', '7-Zip · Windows 탐색기 · bsdtar로 해제 확인'],
  ['jpeg|7z', '7-Zip 무결성 검사 통과'],
  ['pdf|zip', 'poppler 경고 없이 열림 + 7-Zip 무결성 검사 통과'],
  ['pdf|7z', 'poppler 경고 없이 열림 + 7-Zip 무결성 검사 통과'],
  ['jpeg|pdf', 'poppler로 본문 추출 확인 (헤더가 앞 1KB를 벗어나 안내 경고가 함께 뜸)'],
  ['bmp|pdf', 'poppler 경고 없이 열림 (캐리어가 1KB보다 작은 경우)'],
]);

/** 캐리어 뒤에 이어 붙여서 만들 수 있는 페이로드 형식 (ZIP·PDF는 위치 보정을 거친다) */
const APPENDABLE: readonly string[] = ['zip', 'rar', '7z', 'pdf'];

export const FORMAT_LABELS: Record<string, string> = {
  unknown: '지원하지 않는 형식',
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  bmp: 'BMP',
  webp: 'WebP',
  tiff: 'TIFF',
  wav: 'WAV',
  mp3: 'MP3',
  mp4: 'MP4',
  avi: 'AVI',
  webm: 'WebM',
  ogg: 'Ogg',
  flac: 'FLAC',
  pdf: 'PDF',
  zip: 'ZIP',
  rar: 'RAR',
  '7z': '7z',
  tar: 'TAR',
  gzip: 'gzip',
  html: 'HTML',
  js: 'JS',
  php: 'PHP',
  elf: 'ELF',
  exe: 'EXE',
  swf: 'SWF',
  nes: 'NES',
  iso: 'ISO',
  mbr: 'MBR',
  ps: 'PostScript',
  gitbundle: 'git bundle',
};

const label = (id: string) => FORMAT_LABELS[id] ?? id.toUpperCase();

/** 안내에 쓰는 캐리어·페이로드 목록 */
export const CARRIER_CHOICES: CarrierKind[] = [
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'tiff',
  'wav',
  'mp3',
  'mp4',
  'avi',
  'webm',
  'ogg',
  'flac',
  'pdf',
];

export const PAYLOAD_CHOICES: PayloadKind[] = ['zip', 'rar', '7z', 'pdf', 'tar'];

/** DB에서 두 형식이 함께 있는 샘플을 찾는다 */
const pairIndex = (() => {
  const index = new Map<string, string[]>();
  for (const sample of db.samples) {
    const types = [...new Set(sample.types.map(normalize))];
    for (let i = 0; i < types.length; i++) {
      for (let j = i + 1; j < types.length; j++) {
        const key = [types[i], types[j]].sort().join('|');
        const list = index.get(key) ?? [];
        list.push(sample.file);
        index.set(key, list);
      }
    }
  }
  return index;
})();

const dbSamples = (a: string, b: string) => pairIndex.get([a, b].sort().join('|')) ?? [];

export function comboInfo(carrier: string, payload: string): ComboInfo {
  if (carrier === 'unknown' || payload === 'unknown') {
    const which = carrier === 'unknown' ? '캐리어' : '페이로드';
    return {
      status: 'unsupported',
      label: '지원하지 않음',
      detail: `${which}가 이 도구에서 지원하지 않는 형식입니다.`,
      samples: [],
    };
  }

  if (carrier === payload) {
    return {
      status: 'no',
      label: '불가',
      detail: '같은 형식끼리는 폴리글랏이 되지 않습니다.',
      samples: [],
    };
  }

  const samples = dbSamples(carrier, payload);
  const key = `${carrier}|${payload}`;

  if (!APPENDABLE.includes(payload)) {
    if (samples.length > 0) {
      return {
        status: 'special',
        label: '특수 제작 필요',
        detail: `${label(carrier)}+${label(payload)} 조합은 실물 샘플이 있지만, 헤더를 서로 겹쳐 만들어야 해서 이어 붙이기로는 만들 수 없습니다.`,
        samples,
      };
    }
    return {
      status: 'no',
      label: '불가',
      detail: `${label(payload)}는 뒤에 붙일 수 없는 형식입니다.`,
      samples,
    };
  }

  const verified = VERIFIED.get(key);
  if (verified) {
    return { status: 'verified', label: '검증됨', detail: verified, samples };
  }
  if (samples.length > 0) {
    return {
      status: 'known',
      label: 'DB 근거 있음',
      detail: `Polydet DB에 ${label(carrier)}+${label(payload)} 실물 샘플이 ${samples.length}개 있습니다.`,
      samples,
    };
  }
  return {
    status: 'expected',
    label: '가능할 것으로 예상',
    detail: `${label(carrier)}는 뒤쪽 데이터를 무시하고 ${label(payload)}는 파일 안에서 시작 위치를 찾으므로 구조상 가능하지만, 확인된 근거는 없습니다.`,
    samples,
  };
}

export interface ComboOption {
  kind: string;
  label: string;
  info: ComboInfo;
}

/** 이 캐리어에 붙일 수 있는 페이로드 목록 (가능한 것부터) */
export function payloadOptions(carrier: string): ComboOption[] {
  return PAYLOAD_CHOICES.filter((kind) => kind !== carrier) // 같은 형식끼리는 안내하지 않는다
    .map((kind) => ({
      kind,
      label: label(kind),
      info: comboInfo(carrier, kind),
    }))
    .sort((a, b) => rank(a.info.status) - rank(b.info.status));
}

/** 이 페이로드를 붙일 수 있는 캐리어 목록 (가능한 것부터) */
export function carrierOptions(payload: string): ComboOption[] {
  return CARRIER_CHOICES.map((kind) => ({
    kind,
    label: label(kind),
    info: comboInfo(kind, payload),
  })).sort((a, b) => rank(a.info.status) - rank(b.info.status));
}

const ORDER: ComboStatus[] = ['verified', 'known', 'expected', 'special', 'no', 'unsupported'];
const rank = (s: ComboStatus) => ORDER.indexOf(s);

/**
 * DB 샘플에 이 형식과 함께 들어 있지만 이 도구가 다루지 않는 형식들.
 * (HTML·ELF처럼 애초에 이 도구의 대상이 아닌 것들. 여러 형식이 한 파일에 든 샘플에서
 *  같이 등장한 것이므로 "설계된 조합"이라는 뜻은 아니다.)
 */
export function dbOnlyPartners(kind: string): string[] {
  const known = new Set<string>([...CARRIER_CHOICES, ...PAYLOAD_CHOICES]);
  const partners = new Set<string>();
  for (const sample of db.samples) {
    const types = sample.types.map(normalize);
    if (!types.includes(kind)) continue;
    for (const t of types) {
      if (t !== kind && !known.has(t)) partners.add(t);
    }
  }
  return [...partners].sort().map(label);
}

/** 파일 선택 대화상자의 accept 목록에 쓰는 확장자 */
export const FORMAT_EXTENSIONS: Record<string, string[]> = {
  jpeg: ['.jpg', '.jpeg', '.jfif'],
  png: ['.png'],
  gif: ['.gif'],
  bmp: ['.bmp'],
  webp: ['.webp'],
  tiff: ['.tif', '.tiff'],
  wav: ['.wav'],
  mp3: ['.mp3'],
  mp4: ['.mp4', '.m4v', '.mov'],
  avi: ['.avi'],
  webm: ['.webm', '.mkv'],
  ogg: ['.ogg', '.oga', '.ogv'],
  flac: ['.flac'],
  pdf: ['.pdf'],
  zip: ['.zip', '.jar', '.apk', '.docx', '.xlsx', '.pptx', '.odt', '.epub', '.cbz'],
  rar: ['.rar'],
  '7z': ['.7z'],
  tar: ['.tar'],
};

const extensionsOf = (kinds: string[]) =>
  [...new Set(kinds.flatMap((k) => FORMAT_EXTENSIONS[k] ?? []))].join(',');

/**
 * 파일 선택 대화상자에 넘길 accept 문자열.
 * 반대편이 이미 정해져 있으면 그와 조합이 되는 형식만 남긴다.
 */
export function carrierAccept(payload?: string | null): string {
  const kinds = payload
    ? carrierOptions(payload)
        .filter((o) => isSupported(o.info.status))
        .map((o) => o.kind)
    : CARRIER_CHOICES;
  return extensionsOf(kinds);
}

export function payloadAccept(carrier?: string | null): string {
  const kinds = carrier
    ? payloadOptions(carrier)
        .filter((o) => isSupported(o.info.status))
        .map((o) => o.kind)
    : PAYLOAD_CHOICES.filter((k) => APPENDABLE.includes(k));
  return extensionsOf(kinds);
}

export const DB_META = {
  source: db.source,
  license: db.license,
  retrieved: db.retrieved,
  sampleCount: db.samples.length,
};
