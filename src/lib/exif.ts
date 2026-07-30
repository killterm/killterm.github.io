// JPEG EXIF 파서 (의존성 없음).
// APP1 세그먼트의 TIFF 구조(IFD0 → Exif SubIFD, GPS IFD)에서 자주 쓰는 태그만 읽는다.
// 개인정보 확인이 목적이므로 GPS 좌표를 특히 신경 써서 다룬다.

export type ExifEntry = {
  label: string;
  value: string;
  /** 위치 정보 등 개인정보성 항목 표시용 */
  sensitive?: boolean;
};

type TagFormatter = (value: unknown) => string;

const IFD0_TAGS: Record<number, [string, TagFormatter?]> = {
  0x010f: ['제조사'],
  0x0110: ['카메라 모델'],
  0x0131: ['소프트웨어'],
  0x0132: ['수정 일시'],
  0x0112: ['방향(Orientation)', (v) => String(v)],
};

const EXIF_TAGS: Record<number, [string, TagFormatter?]> = {
  0x9003: ['촬영 일시'],
  0x829a: [
    '노출 시간',
    (v) => {
      const n = v as number;
      return n >= 1 ? `${n}초` : `1/${Math.round(1 / n)}초`;
    },
  ],
  0x829d: ['조리개', (v) => `f/${(v as number).toFixed(1)}`],
  0x8827: ['ISO', (v) => String(v)],
  0x920a: ['초점 거리', (v) => `${v as number}mm`],
  0xa405: ['초점 거리(35mm 환산)', (v) => `${v as number}mm`],
  0xa434: ['렌즈 모델'],
};

export function parseExif(buffer: ArrayBuffer): ExifEntry[] | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  // APP1(0xFFE1) 세그먼트에서 "Exif\0\0" 헤더 찾기
  let offset = 2;
  let tiffStart = -1;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength) {
      if (view.getUint32(offset + 4) === 0x45786966) {
        tiffStart = offset + 10;
        break;
      }
    }
    if ((marker & 0xff00) !== 0xff00 || size < 2) break;
    offset += 2 + size;
  }
  if (tiffStart < 0) return null;

  const little = view.getUint16(tiffStart) === 0x4949;
  const u16 = (o: number) => view.getUint16(tiffStart + o, little);
  const u32 = (o: number) => view.getUint32(tiffStart + o, little);
  const i32 = (o: number) => view.getInt32(tiffStart + o, little);
  if (u16(2) !== 42) return null;

  // IFD 엔트리 하나의 값을 읽는다
  function readValue(entryOffset: number): unknown {
    const type = u16(entryOffset + 2);
    const count = u32(entryOffset + 4);
    const typeSizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const size = (typeSizes[type] ?? 1) * count;
    const valueOffset = size <= 4 ? entryOffset + 8 : u32(entryOffset + 8);

    if (type === 2) {
      const bytes = new Uint8Array(buffer, tiffStart + valueOffset, count);
      return new TextDecoder('ascii').decode(bytes).replace(/\0+$/, '').trim();
    }
    const readOne = (index: number): number => {
      if (type === 3) return u16(valueOffset + index * 2);
      if (type === 4) return u32(valueOffset + index * 4);
      if (type === 5) return u32(valueOffset + index * 8) / (u32(valueOffset + index * 8 + 4) || 1);
      if (type === 10) return i32(valueOffset + index * 8) / (i32(valueOffset + index * 8 + 4) || 1);
      if (type === 9) return i32(valueOffset + index * 4);
      return new Uint8Array(buffer, tiffStart + valueOffset, count)[index];
    };
    if (count === 1) return readOne(0);
    return Array.from({ length: count }, (_, i) => readOne(i));
  }

  // IFD를 순회하며 태그 맵을 만든다
  function readIfd(ifdOffset: number): Map<number, unknown> {
    const tags = new Map<number, unknown>();
    if (tiffStart + ifdOffset + 2 > view.byteLength) return tags;
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (tiffStart + entry + 12 > view.byteLength) break;
      try {
        tags.set(u16(entry), readValue(entry));
      } catch {
        /* 손상된 엔트리는 건너뜀 */
      }
    }
    return tags;
  }

  const ifd0 = readIfd(u32(4));
  const exifIfd = ifd0.has(0x8769) ? readIfd(ifd0.get(0x8769) as number) : new Map();
  const gpsIfd = ifd0.has(0x8825) ? readIfd(ifd0.get(0x8825) as number) : new Map();

  const entries: ExifEntry[] = [];
  const collect = (tags: Map<number, unknown>, table: Record<number, [string, TagFormatter?]>) => {
    for (const [tag, [label, format]] of Object.entries(table)) {
      const value = tags.get(Number(tag));
      if (value === undefined) continue;
      entries.push({ label, value: format ? format(value) : String(value) });
    }
  };
  collect(ifd0, IFD0_TAGS);
  collect(exifIfd, EXIF_TAGS);

  // GPS: 도/분/초 배열 → 십진수 좌표
  const dmsToDecimal = (dms: number[], ref: string) => {
    const decimal = dms[0] + (dms[1] ?? 0) / 60 + (dms[2] ?? 0) / 3600;
    return ref === 'S' || ref === 'W' ? -decimal : decimal;
  };
  const latValue = gpsIfd.get(2) as number[] | undefined;
  const lonValue = gpsIfd.get(4) as number[] | undefined;
  if (latValue && lonValue) {
    const lat = dmsToDecimal(latValue, String(gpsIfd.get(1) ?? 'N'));
    const lon = dmsToDecimal(lonValue, String(gpsIfd.get(3) ?? 'E'));
    entries.push({
      label: 'GPS 좌표',
      value: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      sensitive: true,
    });
  }
  const altitude = gpsIfd.get(6) as number | undefined;
  if (altitude !== undefined) {
    entries.push({ label: 'GPS 고도', value: `${altitude.toFixed(1)}m`, sensitive: true });
  }

  return entries;
}
