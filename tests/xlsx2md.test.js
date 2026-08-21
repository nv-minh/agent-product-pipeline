// skills/excel-to-md/xlsx2md.mjs — convert .xlsx/.csv sang Markdown, zero-dep.
//
// Fixture .xlsx được DỰNG NGAY TRONG TEST bằng một zip writer STORED tối thiểu
// (local header + central directory + EOCD + CRC32 tự tính) — không check-in
// binary, không thêm dependency, và mọi byte của fixture đều đọc được bằng mắt
// ngay tại đây. Test chạy black-box: spawn script thật, soi stdout/stderr/exit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SCRIPT = new URL('../skills/excel-to-md/xlsx2md.mjs', import.meta.url).pathname

function runX(args) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }), err: '' }
  } catch (e) {
    return { code: e.status, out: e.stdout ?? '', err: e.stderr ?? '' }
  }
}

// ─── zip writer STORED (chỉ cho fixture) ────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStored(entries, { method = 0 } = {}) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text, 'utf8')
    const nameB = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const fixed = (sig, extra) => {
      const b = Buffer.alloc(sig === 0x02014b50 ? 46 : 30)
      b.writeUInt32LE(sig, 0)
      const o = sig === 0x02014b50 ? 6 : 4 // bỏ qua version-made-by ở central
      b.writeUInt16LE(20, o) // version needed
      b.writeUInt16LE(0, o + 2) // flags
      b.writeUInt16LE(method, o + 4) // 0 = stored (cho phép ghi method lạ để test từ chối)
      b.writeUInt32LE(0, o + 6) // time+date
      b.writeUInt32LE(crc, o + 10)
      b.writeUInt32LE(data.length, o + 14) // csize
      b.writeUInt32LE(data.length, o + 18) // usize
      b.writeUInt16LE(nameB.length, o + 22)
      if (sig === 0x02014b50) b.writeUInt32LE(extra, 42) // local header offset
      return b
    }
    locals.push(fixed(0x04034b50), nameB, data)
    centrals.push(fixed(0x02014b50, offset), nameB)
    offset += 30 + nameB.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(centrals.length / 2, 8)
  eocd.writeUInt16LE(centrals.length / 2, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

// ─── fixture SpreadsheetML tối thiểu ────────────────────────────────────────

const WORKBOOK = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Yêu cầu" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const RELS = `<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId1" Type="…/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

// cellXfs: xf[0] numFmtId=0 (General), xf[1] numFmtId=14 (ngày built-in)
const STYLES = `<?xml version="1.0"?>
<styleSheet>
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>
</styleSheet>`

function xlsxWith(sheetXml, { sharedStrings = null, extra = {} } = {}) {
  const entries = {
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheetXml,
    ...extra,
  }
  if (sharedStrings) entries['xl/sharedStrings.xml'] = sharedStrings
  const dir = mkdtempSync(join(tmpdir(), 'pp-xlsx-'))
  const file = join(dir, 'fixture.xlsx')
  writeFileSync(file, zipStored(entries))
  return { dir, file }
}

const sheet = (rowsXml) => `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`

// ─── .xlsx ──────────────────────────────────────────────────────────────────

test('xlsx: shared string + số + inlineStr ra đúng bảng markdown', () => {
  const { file } = xlsxWith(
    sheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>đăng nhập &amp; gửi</t></is></c><c r="B2"><v>42</v></c></row>',
    ),
    { sharedStrings: '<sst><si><t>Hạng mục</t></si><si><r><t>Số </t></r><r><t>lượng</t></r></si></sst>' },
  )
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /## Sheet: Yêu cầu/)
  assert.match(r.out, /\| Hạng mục \| Số lượng \|/) // rich-text <r><t> phải được NỐI
  assert.match(r.out, /\| đăng nhập & gửi \| 42 \|/) // entity được unescape
})

test('xlsx: ô trống và cột nhảy quãng (r="C2") không làm lệch cột', () => {
  const { file } = xlsxWith(sheet(
    '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>' +
    '<row r="2"><c r="C2"><v>9</v></c></row>',
  ))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| {2}\| {2}\| 9 \|/, 'giá trị ở C2 phải nằm cột thứ 3, hai cột đầu trống')
})

test('xlsx: ký tự | trong ô được escape — không phá cấu trúc bảng', () => {
  const { file } = xlsxWith(sheet(
    '<row r="1"><c r="A1" t="inlineStr"><is><t>cột A|B</t></is></c></row>',
  ))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /cột A\\\|B/)
})

test('xlsx: numFmt 14 (ngày built-in) convert serial → ISO; General giữ nguyên số', () => {
  // 45518 = 2024-08-14. Cell A1 style s=1 (numFmtId 14), B1 style General.
  const { file } = xlsxWith(sheet(
    '<row r="1"><c r="A1" s="1"><v>45518</v></c><c r="B1"><v>45518</v></c></row>',
  ))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| 2024-08-14 \| 45518 \|/)
})

test('xlsx: vượt --max-rows thì cắt VÀ nói rõ đã cắt bao nhiêu', () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    `<row r="${i + 1}"><c r="A${i + 1}"><v>${i + 1}</v></c></row>`).join('')
  const { file } = xlsxWith(sheet(rows))
  const r = runX([file, '--max-rows', '5'])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /đã cắt 7 hàng \(hiện 5\/12\)/)
  assert.match(r.out, /--max-rows/)
  assert.doesNotMatch(r.out, /\| 6 \|/, 'hàng 6 trở đi không được in')
})

test('xlsx: formula lấy giá trị cached (t="str"); boolean ra TRUE/FALSE', () => {
  const { file } = xlsxWith(sheet(
    '<row r="1"><c r="A1" t="str"><f>CONCAT(1,2)</f><v>12</v></c><c r="B1" t="b"><v>1</v></c></row>',
  ))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| 12 \| TRUE \|/)
})

test('xlsx: thiếu sharedStrings.xml/styles.xml vẫn đọc được (file tối thiểu hợp lệ)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-xlsx-'))
  const file = join(dir, 'bare.xlsx')
  writeFileSync(file, zipStored({
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1"><v>7</v></c></row>'),
  }))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| 7 \|/)
})

test('xlsx: --out ghi file markdown, stdout không lẫn data', () => {
  const { dir, file } = xlsxWith(sheet('<row r="1"><c r="A1"><v>1</v></c></row>'))
  const out = join(dir, 'ra.md')
  const r = runX([file, '--out', out])
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, '', 'stdout phải rỗng khi có --out')
  assert.match(readFileSync(out, 'utf8'), /\| 1 \|/)
})

// ─── .csv ───────────────────────────────────────────────────────────────────

test('csv: quoted field chứa dấu phẩy + xuống dòng + BOM đều đúng', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-csv-'))
  const file = join(dir, 'a.csv')
  writeFileSync(file, '﻿tên,mô tả\r\n"Nguyễn, Văn A","dòng 1\ndòng 2"\r\n')
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| tên \| mô tả \|/)
  assert.match(r.out, /\| Nguyễn, Văn A \| dòng 1<br>dòng 2 \|/)
})

// ─── từ chối rõ ─────────────────────────────────────────────────────────────

test('.xls đời cũ (magic OLE) bị từ chối exit 2 kèm hướng dẫn save as .xlsx', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-xls-'))
  const file = join(dir, 'cu.xls')
  writeFileSync(file, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))
  const r = runX([file])
  assert.equal(r.code, 2)
  assert.match(r.err, /\.xls định dạng cũ/)
  assert.match(r.err, /Save As \.xlsx/)
  assert.equal(r.out, '', 'stdout phải sạch — lỗi chỉ đi vào stderr')
})

test('file rác (không phải zip/csv) → exit 2, thông điệp nêu đúng sự việc', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-junk-'))
  const file = join(dir, 'rac.xlsx')
  writeFileSync(file, 'đây không phải zip')
  const r = runX([file])
  assert.equal(r.code, 2)
  assert.match(r.err, /không phải file ZIP/)
})

test('zip hợp lệ nhưng không phải xlsx (thiếu workbook.xml) → exit 2 nói thẳng', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-zipx-'))
  const file = join(dir, 'khac.xlsx')
  writeFileSync(file, zipStored({ 'hello.txt': 'xin chào' }))
  const r = runX([file])
  assert.equal(r.code, 2)
  assert.match(r.err, /không có xl\/workbook\.xml/)
})

test('xlsx: sheet trống, cell lỗi (#DIV/0!), và ngày có phần giờ', () => {
  const { file } = xlsxWith(
    sheet('<row r="1"><c r="A1" t="e"><v>#DIV/0!</v></c><c r="B1" s="1"><v>45518.5</v></c></row>'),
  )
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /#DIV\/0!/)
  assert.match(r.out, /2024-08-14 12:00:00/, 'serial lẻ .5 = 12 giờ trưa')

  const empty = xlsxWith(sheet(''))
  const r2 = runX([empty.file])
  assert.equal(r2.code, 0, r2.err)
  assert.match(r2.out, /\(sheet trống\)/)
})

test('xlsx: vượt --max-cols thì cắt cột VÀ nói rõ', () => {
  const { file } = xlsxWith(sheet(
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c><c r="D1"><v>4</v></c></row>',
  ))
  const r = runX([file, '--max-cols', '2'])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| 1 \| 2 \|/)
  assert.doesNotMatch(r.out, /\| 3 \|/)
  assert.match(r.out, /nhiều hơn 2 cột/)
  assert.match(r.out, /--max-cols/)
})

test('xlsx: thiếu file rels — vẫn đọc được bằng đường dẫn sheet mặc định', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-xlsx-'))
  const file = join(dir, 'norels.xlsx')
  writeFileSync(file, zipStored({
    'xl/workbook.xml': WORKBOOK,
    'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1"><v>5</v></c></row>'),
  }))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\| 5 \|/)
})

test('xlsx: workbook trỏ tới sheet không có trong ZIP — nói rõ, không chết cả file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-xlsx-'))
  const file = join(dir, 'matsheet.xlsx')
  writeFileSync(file, zipStored({
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
  }))
  const r = runX([file])
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /\(không đọc được sheet này\)/)
})

test('zip nén bằng method không hỗ trợ (bzip2=12) → exit 2 nêu đúng method', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-xlsx-'))
  const file = join(dir, 'bzip.xlsx')
  writeFileSync(file, zipStored({ 'xl/workbook.xml': WORKBOOK }, { method: 12 }))
  const r = runX([file])
  assert.equal(r.code, 2)
  assert.match(r.err, /method 12/)
})

test('thiếu đối số hoặc --max-rows rác → exit 2 + dòng cách dùng', () => {
  assert.equal(runX([]).code, 2)
  const { file } = xlsxWith(sheet('<row r="1"><c r="A1"><v>1</v></c></row>'))
  const r = runX([file, '--max-rows', 'abc'])
  assert.equal(r.code, 2)
  assert.match(r.err, /cách dùng/)
})
