// TrueType(.ttf) 인코더 — 의존성 없이 바이너리 테이블을 직접 쓴다.
//
// 픽셀 편집과 벡터 편집을 모두 담을 수 있도록, 이 라이터는 **컨투어 목록만** 받는다.
// 픽셀 글리프는 사각형 컨투어로, 벡터 글리프는 그대로 넘어온다. 점마다 onCurve
// 플래그가 있어 2차 베지어(TrueType의 곡선)도 처음부터 표현된다.
//
// 참고한 규격: OpenType/TrueType의 필수 테이블
// head · hhea · maxp · hmtx · cmap · glyf · loca · name · OS/2 · post

export interface GlyphPoint {
  x: number;
  y: number;
  /** false면 2차 베지어 제어점 */
  onCurve: boolean;
}

export type Contour = GlyphPoint[];

export interface FontGlyph {
  /** 유니코드 코드포인트. 0이면 .notdef */
  codePoint: number;
  contours: Contour[];
  /** 다음 글자까지의 간격 (폰트 단위) */
  advanceWidth: number;
}

export interface FontMetadata {
  familyName: string;
  styleName: string;
  unitsPerEm: number;
  /** 베이스라인 위 높이 (양수) */
  ascender: number;
  /** 베이스라인 아래 깊이 (양수로 넣고 내부에서 음수로 쓴다) */
  descender: number;
  version?: string;
}

// ---------- 바이트 쓰기 도우미 ----------

class ByteWriter {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  uint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  uint16(value: number): void {
    this.bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  int16(value: number): void {
    this.uint16(value < 0 ? value + 0x10000 : value);
  }

  uint32(value: number): void {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  /** 2.14 고정소수점 (F2Dot14) */
  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.uint8(text.charCodeAt(i));
  }

  utf16be(text: string): void {
    for (let i = 0; i < text.length; i++) this.uint16(text.charCodeAt(i));
  }

  raw(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.bytes.push(values[i] & 0xff);
  }

  /** 4바이트 경계까지 0으로 채운다 */
  padTo4(): void {
    while (this.bytes.length % 4 !== 0) this.bytes.push(0);
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.bytes);
  }
}

/** 테이블 체크섬 — 4바이트씩 uint32로 더한다 (넘침은 버린다) */
function tableChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const value =
      ((bytes[i] ?? 0) << 24) |
      ((bytes[i + 1] ?? 0) << 16) |
      ((bytes[i + 2] ?? 0) << 8) |
      (bytes[i + 3] ?? 0);
    sum = (sum + value) >>> 0;
  }
  return sum >>> 0;
}

// ---------- 개별 테이블 ----------

interface GlyphBounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

function glyphBounds(contours: Contour[]): GlyphBounds {
  if (contours.length === 0 || contours.every((contour) => contour.length === 0)) {
    return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  }
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const contour of contours) {
    for (const point of contour) {
      xMin = Math.min(xMin, point.x);
      yMin = Math.min(yMin, point.y);
      xMax = Math.max(xMax, point.x);
      yMax = Math.max(yMax, point.y);
    }
  }
  return { xMin, yMin, xMax, yMax };
}

/** 글리프 하나를 glyf 테이블 형식으로 쓴다. 컨투어가 없으면 빈 글리프(길이 0). */
function writeGlyf(contours: Contour[]): Uint8Array {
  // glyf 좌표는 정수 단위다. 벡터 편집이 소수를 만들 수 있어 먼저 반올림한다.
  const usable = contours
    .filter((contour) => contour.length > 0)
    .map((contour) =>
      contour.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
        onCurve: point.onCurve,
      })),
    );
  if (usable.length === 0) return new Uint8Array(0);

  const writer = new ByteWriter();
  const bounds = glyphBounds(usable);
  writer.int16(usable.length); // numberOfContours (양수 = 단순 글리프)
  writer.int16(bounds.xMin);
  writer.int16(bounds.yMin);
  writer.int16(bounds.xMax);
  writer.int16(bounds.yMax);

  // endPtsOfContours
  let total = 0;
  for (const contour of usable) {
    total += contour.length;
    writer.uint16(total - 1);
  }
  writer.uint16(0); // instructionLength

  const points = usable.flat();
  // 플래그 — 반복 압축은 생략하고 점마다 하나씩 쓴다(단순함 우선)
  for (const point of points) {
    // bit0: on-curve
    writer.uint8(point.onCurve ? 1 : 0);
  }
  // 좌표는 이전 점과의 차이로 쓴다 (여기서는 항상 int16 형식)
  let previousX = 0;
  for (const point of points) {
    writer.int16(point.x - previousX);
    previousX = point.x;
  }
  let previousY = 0;
  for (const point of points) {
    writer.int16(point.y - previousY);
    previousY = point.y;
  }
  writer.padTo4();
  return writer.toUint8Array();
}

/** cmap format 4 — BMP 범위의 문자를 글리프 번호로 잇는다 */
function writeCmap(mappings: { codePoint: number; glyphId: number }[]): Uint8Array {
  const sorted = [...mappings]
    .filter((entry) => entry.codePoint > 0 && entry.codePoint <= 0xffff)
    .sort((a, b) => a.codePoint - b.codePoint);

  // 연속된 코드포인트를 세그먼트로 묶는다
  interface Segment {
    start: number;
    end: number;
    startGlyph: number;
    /** 글리프 번호가 코드포인트와 나란히 증가하면 delta로 표현할 수 있다 */
    contiguous: boolean;
    glyphIds: number[];
  }
  const segments: Segment[] = [];
  for (const entry of sorted) {
    const last = segments[segments.length - 1];
    if (
      last &&
      entry.codePoint === last.end + 1 &&
      last.contiguous &&
      entry.glyphId === last.startGlyph + (entry.codePoint - last.start)
    ) {
      last.end = entry.codePoint;
      last.glyphIds.push(entry.glyphId);
      continue;
    }
    segments.push({
      start: entry.codePoint,
      end: entry.codePoint,
      startGlyph: entry.glyphId,
      contiguous: true,
      glyphIds: [entry.glyphId],
    });
  }
  // 규격상 마지막 세그먼트는 0xFFFF여야 한다
  segments.push({ start: 0xffff, end: 0xffff, startGlyph: 0, contiguous: true, glyphIds: [0] });

  const segCount = segments.length;
  const subtable = new ByteWriter();
  subtable.uint16(4); // format
  const subtableLength = 16 + segCount * 8;
  subtable.uint16(subtableLength);
  subtable.uint16(0); // language
  subtable.uint16(segCount * 2);
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  subtable.uint16(searchRange);
  subtable.uint16(Math.log2(searchRange / 2));
  subtable.uint16(segCount * 2 - searchRange);
  for (const segment of segments) subtable.uint16(segment.end);
  subtable.uint16(0); // reservedPad
  for (const segment of segments) subtable.uint16(segment.start);
  for (const segment of segments) {
    // idDelta: (glyphId - codePoint) mod 65536
    const delta = (segment.startGlyph - segment.start) & 0xffff;
    subtable.uint16(delta);
  }
  for (let i = 0; i < segCount; i++) subtable.uint16(0); // idRangeOffset (delta만 사용)

  const table = new ByteWriter();
  table.uint16(0); // version
  table.uint16(1); // numTables
  table.uint16(3); // platformID: Windows
  table.uint16(1); // encodingID: Unicode BMP
  table.uint32(12); // offset
  table.raw(subtable.toUint8Array());
  table.padTo4();
  return table.toUint8Array();
}

function writeName(metadata: FontMetadata): Uint8Array {
  const version = metadata.version ?? '1.000';
  const postScriptName = `${metadata.familyName}-${metadata.styleName}`.replace(/[^\x20-\x7e]/g, '');
  const records: { nameId: number; text: string }[] = [
    { nameId: 0, text: 'Generated with Killterm font editor.' },
    { nameId: 1, text: metadata.familyName },
    { nameId: 2, text: metadata.styleName },
    { nameId: 3, text: `${metadata.familyName}:${metadata.styleName}:${version}` },
    { nameId: 4, text: `${metadata.familyName} ${metadata.styleName}` },
    { nameId: 5, text: `Version ${version}` },
    { nameId: 6, text: postScriptName },
  ];

  const storage = new ByteWriter();
  const entries: { nameId: number; offset: number; length: number }[] = [];
  for (const record of records) {
    const offset = storage.length;
    storage.utf16be(record.text);
    entries.push({ nameId: record.nameId, offset, length: storage.length - offset });
  }

  const table = new ByteWriter();
  table.uint16(0); // format
  table.uint16(entries.length);
  table.uint16(6 + entries.length * 12); // stringOffset
  for (const entry of entries) {
    table.uint16(3); // platformID: Windows
    table.uint16(1); // encodingID: Unicode BMP
    table.uint16(0x0409); // languageID: en-US
    table.uint16(entry.nameId);
    table.uint16(entry.length);
    table.uint16(entry.offset);
  }
  table.raw(storage.toUint8Array());
  table.padTo4();
  return table.toUint8Array();
}

// ---------- 폰트 조립 ----------

/**
 * 글리프 목록으로 .ttf 파일 바이트를 만든다.
 * 첫 글리프는 자동으로 .notdef(빈 글리프)가 되고, 넘긴 글리프들이 그 뒤에 온다.
 */
export function encodeTtf(glyphs: FontGlyph[], metadata: FontMetadata): Uint8Array<ArrayBuffer> {
  // 글리프 0 = .notdef
  const allGlyphs: FontGlyph[] = [
    { codePoint: 0, contours: [], advanceWidth: Math.round(metadata.unitsPerEm / 2) },
    ...glyphs.filter((glyph) => glyph.codePoint > 0),
  ];

  // glyf + loca
  const glyfWriter = new ByteWriter();
  const offsets: number[] = [];
  for (const glyph of allGlyphs) {
    offsets.push(glyfWriter.length);
    glyfWriter.raw(writeGlyf(glyph.contours));
  }
  offsets.push(glyfWriter.length);
  const glyfTable = glyfWriter.toUint8Array();

  const locaWriter = new ByteWriter();
  for (const offset of offsets) locaWriter.uint32(offset);
  locaWriter.padTo4();
  const locaTable = locaWriter.toUint8Array();

  // 전체 경계와 최대 점·컨투어 수
  let xMin = 0;
  let yMin = 0;
  let xMax = 0;
  let yMax = 0;
  let maxPoints = 0;
  let maxContours = 0;
  let maxAdvance = 0;
  for (const glyph of allGlyphs) {
    const bounds = glyphBounds(glyph.contours.filter((contour) => contour.length > 0));
    xMin = Math.min(xMin, bounds.xMin);
    yMin = Math.min(yMin, bounds.yMin);
    xMax = Math.max(xMax, bounds.xMax);
    yMax = Math.max(yMax, bounds.yMax);
    const points = glyph.contours.reduce((sum, contour) => sum + contour.length, 0);
    maxPoints = Math.max(maxPoints, points);
    maxContours = Math.max(maxContours, glyph.contours.filter((c) => c.length > 0).length);
    maxAdvance = Math.max(maxAdvance, glyph.advanceWidth);
  }

  // head
  const head = new ByteWriter();
  head.uint32(0x00010000); // version 1.0
  head.uint32(0x00010000); // fontRevision
  head.uint32(0); // checkSumAdjustment — 나중에 채운다
  head.uint32(0x5f0f3cf5); // magicNumber
  head.uint16(0b0000_0000_0000_0011); // flags: baseline at y=0, lsb at x=0
  head.uint16(metadata.unitsPerEm);
  head.uint32(0); // created (상위 32비트)
  head.uint32(0);
  head.uint32(0); // modified
  head.uint32(0);
  head.int16(xMin);
  head.int16(yMin);
  head.int16(xMax);
  head.int16(yMax);
  head.uint16(0); // macStyle
  head.uint16(8); // lowestRecPPEM
  head.int16(2); // fontDirectionHint
  head.int16(1); // indexToLocFormat: long
  head.int16(0); // glyphDataFormat
  const headTable = head.toUint8Array();

  // hhea
  const hhea = new ByteWriter();
  hhea.uint32(0x00010000);
  hhea.int16(metadata.ascender);
  hhea.int16(-metadata.descender);
  hhea.int16(0); // lineGap
  hhea.uint16(maxAdvance);
  hhea.int16(0); // minLeftSideBearing
  hhea.int16(0); // minRightSideBearing
  hhea.int16(xMax);
  hhea.int16(1); // caretSlopeRise
  hhea.int16(0);
  hhea.int16(0);
  for (let i = 0; i < 4; i++) hhea.int16(0); // reserved
  hhea.int16(0); // metricDataFormat
  hhea.uint16(allGlyphs.length); // numberOfHMetrics
  const hheaTable = hhea.toUint8Array();

  // maxp
  const maxp = new ByteWriter();
  maxp.uint32(0x00010000);
  maxp.uint16(allGlyphs.length);
  maxp.uint16(maxPoints);
  maxp.uint16(maxContours);
  maxp.uint16(0); // maxCompositePoints
  maxp.uint16(0); // maxCompositeContours
  maxp.uint16(2); // maxZones
  maxp.uint16(0); // maxTwilightPoints
  maxp.uint16(0); // maxStorage
  maxp.uint16(0); // maxFunctionDefs
  maxp.uint16(0); // maxInstructionDefs
  maxp.uint16(0); // maxStackElements
  maxp.uint16(0); // maxSizeOfInstructions
  maxp.uint16(0); // maxComponentElements
  maxp.uint16(0); // maxComponentDepth
  const maxpTable = maxp.toUint8Array();

  // hmtx
  const hmtx = new ByteWriter();
  for (const glyph of allGlyphs) {
    hmtx.uint16(Math.max(0, Math.round(glyph.advanceWidth)));
    hmtx.int16(0); // leftSideBearing
  }
  hmtx.padTo4();
  const hmtxTable = hmtx.toUint8Array();

  // OS/2 (version 4)
  const os2 = new ByteWriter();
  os2.uint16(4);
  os2.int16(Math.round(metadata.unitsPerEm / 2)); // xAvgCharWidth
  os2.uint16(400); // usWeightClass: normal
  os2.uint16(5); // usWidthClass: medium
  os2.uint16(0); // fsType: installable
  os2.int16(Math.round(metadata.unitsPerEm * 0.13)); // ySubscriptXSize
  os2.int16(Math.round(metadata.unitsPerEm * 0.13));
  os2.int16(0);
  os2.int16(Math.round(metadata.unitsPerEm * 0.07));
  os2.int16(Math.round(metadata.unitsPerEm * 0.13)); // ySuperscript*
  os2.int16(Math.round(metadata.unitsPerEm * 0.13));
  os2.int16(0);
  os2.int16(Math.round(metadata.unitsPerEm * 0.48));
  os2.int16(Math.round(metadata.unitsPerEm * 0.05)); // yStrikeoutSize
  os2.int16(Math.round(metadata.ascender * 0.4));
  os2.int16(0); // sFamilyClass
  for (let i = 0; i < 10; i++) os2.uint8(0); // panose
  for (let i = 0; i < 4; i++) os2.uint32(0); // ulUnicodeRange 1~4
  os2.ascii('KLTM'); // achVendID
  os2.uint16(0); // fsSelection
  os2.uint16(0x20); // usFirstCharIndex
  os2.uint16(0xffff); // usLastCharIndex
  os2.int16(metadata.ascender); // sTypoAscender
  os2.int16(-metadata.descender);
  os2.int16(0); // sTypoLineGap
  os2.uint16(metadata.ascender); // usWinAscent
  os2.uint16(metadata.descender); // usWinDescent
  os2.uint32(1); // ulCodePageRange1: Latin-1
  os2.uint32(0);
  os2.int16(Math.round(metadata.ascender * 0.7)); // sxHeight
  os2.int16(metadata.ascender); // sCapHeight
  os2.uint16(0); // usDefaultChar
  os2.uint16(0x20); // usBreakChar
  os2.uint16(2); // usMaxContext
  const os2Table = os2.toUint8Array();

  // post (3.0 — 글리프 이름 없음)
  const post = new ByteWriter();
  post.uint32(0x00030000);
  post.uint32(0); // italicAngle
  post.int16(-Math.round(metadata.descender / 2)); // underlinePosition
  post.int16(Math.round(metadata.unitsPerEm * 0.05)); // underlineThickness
  post.uint32(0); // isFixedPitch
  for (let i = 0; i < 4; i++) post.uint32(0); // min/max memory
  const postTable = post.toUint8Array();

  const cmapTable = writeCmap(
    allGlyphs
      .map((glyph, index) => ({ codePoint: glyph.codePoint, glyphId: index }))
      .filter((entry) => entry.codePoint > 0),
  );
  const nameTable = writeName(metadata);

  // 테이블 디렉터리는 태그 알파벳 순서로 (규격 권고)
  const tables: { tag: string; data: Uint8Array }[] = [
    { tag: 'OS/2', data: os2Table },
    { tag: 'cmap', data: cmapTable },
    { tag: 'glyf', data: glyfTable },
    { tag: 'head', data: headTable },
    { tag: 'hhea', data: hheaTable },
    { tag: 'hmtx', data: hmtxTable },
    { tag: 'loca', data: locaTable },
    { tag: 'maxp', data: maxpTable },
    { tag: 'name', data: nameTable },
    { tag: 'post', data: postTable },
  ];

  const numTables = tables.length;
  const searchRange = 16 * 2 ** Math.floor(Math.log2(numTables));
  const directory = new ByteWriter();
  directory.uint32(0x00010000); // sfntVersion: TrueType
  directory.uint16(numTables);
  directory.uint16(searchRange);
  directory.uint16(Math.log2(searchRange / 16));
  directory.uint16(numTables * 16 - searchRange);

  let offset = 12 + numTables * 16;
  const records: { tag: string; checksum: number; offset: number; length: number }[] = [];
  for (const table of tables) {
    records.push({
      tag: table.tag,
      checksum: tableChecksum(table.data),
      offset,
      length: table.data.length,
    });
    offset += table.data.length;
    // 표는 4바이트 경계에 놓인다 (data는 이미 패딩되어 있다)
    while (offset % 4 !== 0) offset++;
  }
  for (const record of records) {
    directory.ascii(record.tag);
    directory.uint32(record.checksum);
    directory.uint32(record.offset);
    directory.uint32(record.length);
  }

  const output = new ByteWriter();
  output.raw(directory.toUint8Array());
  for (const table of tables) {
    output.raw(table.data);
    output.padTo4();
  }
  const bytes = output.toUint8Array();

  // checkSumAdjustment = 0xB1B0AFBA - (전체 체크섬)
  const headRecord = records.find((record) => record.tag === 'head')!;
  const total = tableChecksum(bytes);
  const adjustment = (0xb1b0afba - total) >>> 0;
  const view = new DataView(bytes.buffer);
  view.setUint32(headRecord.offset + 8, adjustment);
  return bytes;
}
