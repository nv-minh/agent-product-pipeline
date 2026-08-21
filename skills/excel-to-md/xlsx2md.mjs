#!/usr/bin/env node
// xlsx2md — convert .xlsx/.csv sang Markdown để AI (và người) đọc được.
//
// Vì sao tồn tại: đầu vào của pipeline có thể là file Excel (định nghĩa item,
// bảng yêu cầu…). Một agent "đọc" thẳng file .xlsx là đọc một ZIP nhị phân —
// kết quả hoặc là rác hoặc là bịa. Script này chuyển nó thành bảng Markdown
// tất định, để phần "hiểu nội dung" tách khỏi phần "giải mã định dạng".
//
// Zero-dep là ràng buộc thiết kế (CI của repo ép "zero runtime dependency"):
// .xlsx = ZIP chứa XML, nên tự đọc ZIP bằng zlib builtin + parse XML bằng
// regex CÓ CHỦ ĐÍCH (chỉ đúng các cấu trúc SpreadsheetML cần, không phải một
// XML parser tổng quát — xem giới hạn trong SKILL.md).
//
// Lỗi ghi ra STDERR (khác quy ước stdout của `pp`, có chủ ý: stdout của tool
// này là DỮ LIỆU markdown, người dùng có thể pipe — trộn lỗi vào là hỏng data).
// Exit: 0 = ok, 2 = input sai/không hỗ trợ.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

// ─── ZIP ────────────────────────────────────────────────────────────────────

// Tìm End Of Central Directory: signature 0x06054b50, nằm trong 65557 byte
// cuối (comment tối đa 65535). Quét ngược để lấy EOCD THẬT (cuối cùng) thay
// vì một chuỗi trùng hợp trong data.
function readZip(buf) {
  const min = Math.max(0, buf.length - 65557)
  let eocd = -1
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd === -1) throw new Error('không phải file ZIP (thiếu End Of Central Directory)')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central directory hỏng')
    const method = buf.readUInt16LE(off + 10)
    const csize = buf.readUInt32LE(off + 20)
    const nlen = buf.readUInt16LE(off + 28)
    const xlen = buf.readUInt16LE(off + 30)
    const clen = buf.readUInt16LE(off + 32)
    const lho = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nlen)
    entries.set(name, { method, csize, lho })
    off += 46 + nlen + xlen + clen
  }
  return {
    // Đọc lười từng entry: local header có name/extra len RIÊNG (có thể khác
    // central), data bắt đầu sau đó. Size lấy từ central — local có thể ghi 0
    // khi dùng data descriptor.
    read(name) {
      const e = entries.get(name)
      if (!e) return null
      const nlen = buf.readUInt16LE(e.lho + 26)
      const xlen = buf.readUInt16LE(e.lho + 28)
      const start = e.lho + 30 + nlen + xlen
      const raw = buf.subarray(start, start + e.csize)
      if (e.method === 0) return raw
      if (e.method === 8) return inflateRawSync(raw)
      throw new Error(`entry ${name} nén bằng method ${e.method} — chỉ hỗ trợ stored/deflate`)
    },
  }
}

// ─── XML helpers (chủ đích, không tổng quát) ───────────────────────────────

function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`))
  return m ? unescapeXml(m[1]) : null
}

// Gộp mọi <t>…</t> trong một khối (shared string có thể là rich-text nhiều
// <r><t> — nội dung là phần NỐI của chúng).
function textOf(xmlChunk) {
  let out = ''
  for (const m of xmlChunk.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1])
  return out
}

// ─── SpreadsheetML ──────────────────────────────────────────────────────────

// numFmtId built-in là NGÀY/GIỜ theo spec ECMA-376. numFmt custom không đoán
// (formatCode tuỳ tiện) — giá trị giữ nguyên serial, xem giới hạn ở SKILL.md.
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

// Serial Excel (hệ 1900) → ISO. Epoch 25569 = 1970-01-01. Serial < 61 dính
// "ngày 29/02/1900 không tồn tại" của Excel — lệch 1 ngày, chấp nhận và ghi
// thành văn: dữ liệu ticket thật không sống ở tháng 2 năm 1900.
function serialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const iso = d.toISOString()
  return serial % 1 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
}

function colIndex(ref) {
  let n = 0
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

function parseSharedStrings(xml) {
  if (!xml) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
}

// cellXfs theo THỨ TỰ là bảng style s= của cell trỏ vào; chỉ cần numFmtId.
function parseStyles(xml) {
  if (!xml) return []
  const block = xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)
  if (!block) return []
  return [...block[0].matchAll(/<xf\b[^>]*>/g)].map((m) => Number(attr(m[0], 'numFmtId') ?? 0))
}

function parseSheetList(workbookXml, relsXml) {
  const targets = new Map()
  for (const m of (relsXml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    let t = attr(m[0], 'Target') ?? ''
    if (t.startsWith('/')) t = t.slice(1)
    else t = `xl/${t}`
    targets.set(id, t)
  }
  const sheets = []
  for (const m of (workbookXml ?? '').matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`
    const rid = attr(m[0], 'id')
    sheets.push({ name, path: targets.get(rid) ?? `xl/worksheets/sheet${sheets.length + 1}.xml` })
  }
  return sheets
}

function cellValue(tag, inner, shared, styleFmts) {
  const t = attr(tag, 't')
  if (t === 's') return shared[Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1)] ?? ''
  if (t === 'inlineStr') return textOf(inner)
  const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
  if (v === undefined) return ''
  if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE'
  if (t === 'e' || t === 'str') return unescapeXml(v)
  // Số: nếu style của cell là định dạng ngày built-in thì convert serial.
  const s = Number(attr(tag, 's') ?? -1)
  if (s >= 0 && DATE_FMT_IDS.has(styleFmts[s])) return serialToIso(Number(v))
  return unescapeXml(v)
}

function parseSheet(xml, shared, styleFmts) {
  const rows = []
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${cm[1]}>`
      const ref = attr(tag, 'r')
      const idx = ref ? colIndex(ref) : cells.length
      cells[idx] = cellValue(tag, cm[2] ?? '', shared, styleFmts)
    }
    rows.push(cells)
  }
  return rows
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [[]]
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { rows[rows.length - 1].push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      rows[rows.length - 1].push(field); field = ''
      rows.push([])
    } else field += ch
  }
  rows[rows.length - 1].push(field)
  // Dòng cuối rỗng do file kết thúc bằng newline: bỏ.
  if (rows.length > 1 && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return rows
}

// ─── Markdown ───────────────────────────────────────────────────────────────

const mdCell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')

function renderTable(rows, { maxRows, maxCols }) {
  if (rows.length === 0) return '(sheet trống)\n'
  const shown = rows.slice(0, maxRows)
  const width = Math.min(Math.max(...shown.map((r) => r.length), 1), maxCols)
  const anyColCut = rows.some((r) => r.length > maxCols)
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => mdCell(r[i])).join(' | ')} |`
  const out = [line(shown[0]), `|${' --- |'.repeat(width)}`, ...shown.slice(1).map(line)]
  // Cắt thì NÓI — một bảng bị cắt im lặng đọc như "đủ cả" trong khi không phải.
  if (rows.length > maxRows) {
    out.push('', `> ⚠ đã cắt ${rows.length - maxRows} hàng (hiện ${maxRows}/${rows.length}) — tăng bằng --max-rows`)
  }
  if (anyColCut) {
    out.push('', `> ⚠ có hàng nhiều hơn ${maxCols} cột — phần vượt đã cắt, tăng bằng --max-cols`)
  }
  return `${out.join('\n')}\n`
}

// ─── main ───────────────────────────────────────────────────────────────────

function convert(file, opts) {
  const buf = readFileSync(file)
  // Magic OLE compound file = .xls đời 2003. Nói thẳng thay vì "không phải ZIP".
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    throw new Error('file này là .xls định dạng cũ (OLE) — chưa hỗ trợ. Mở bằng Excel/LibreOffice rồi Save As .xlsx')
  }
  const parts = [`# ${basename(file)}\n`]
  if (extname(file).toLowerCase() === '.csv') {
    parts.push(renderTable(parseCsv(buf.toString('utf8')), opts))
    return parts.join('\n')
  }
  const zip = readZip(buf)
  const workbook = zip.read('xl/workbook.xml')?.toString('utf8')
  if (!workbook) throw new Error('ZIP không có xl/workbook.xml — đây không phải file .xlsx')
  const shared = parseSharedStrings(zip.read('xl/sharedStrings.xml')?.toString('utf8'))
  const styleFmts = parseStyles(zip.read('xl/styles.xml')?.toString('utf8'))
  const sheets = parseSheetList(workbook, zip.read('xl/_rels/workbook.xml.rels')?.toString('utf8'))
  if (sheets.length === 0) throw new Error('workbook không khai báo sheet nào')
  for (const s of sheets) {
    const xml = zip.read(s.path)?.toString('utf8')
    parts.push(`## Sheet: ${s.name}\n`)
    parts.push(xml ? renderTable(parseSheet(xml, shared, styleFmts), opts) : '(không đọc được sheet này)\n')
  }
  return parts.join('\n')
}

function main(argv) {
  const opts = { maxRows: 300, maxCols: 40, out: null }
  let file = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--max-rows') opts.maxRows = Number(argv[++i])
    else if (a === '--max-cols') opts.maxCols = Number(argv[++i])
    else if (!a.startsWith('--')) file = a
  }
  if (!file || !(opts.maxRows > 0) || !(opts.maxCols > 0)) {
    process.stderr.write('cách dùng: node xlsx2md.mjs <file.xlsx|file.csv> [--out <file.md>] [--max-rows N] [--max-cols N]\n')
    return 2
  }
  let md
  try {
    md = convert(file, opts)
  } catch (err) {
    process.stderr.write(`xlsx2md: ${err.message}\n`)
    return 2
  }
  if (opts.out) {
    writeFileSync(opts.out, md)
    process.stderr.write(`đã ghi ${opts.out}\n`)
  } else {
    process.stdout.write(md)
  }
  return 0
}

process.exit(main(process.argv.slice(2)))
