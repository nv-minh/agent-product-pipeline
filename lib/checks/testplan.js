import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseAcIds } from './prd.js'
import { checkSectionChecklist } from './common.js'

const DEFAULT_ATTRS = ['id', 'ac_ref', 'type', 'priority']
const DEFAULT_FIELDS = ['precondition', 'steps', 'expected']

// B1 (lộ ra ở lần chạy thật đầu tiên) — HAI KHÁI NIỆM KHÁC NHAU, TRƯỚC ĐÂY
// DÙNG CHUNG MỘT HẰNG SỐ, VÀ ĐÓ LÀ LÝ DO GATE TỰ MÂU THUẪN VỚI SPEC.
//
// Spec §5.1 đòi bốn loại test: "mỗi AC có ≥1 `positive` **và** ≥1 `negative`;
// mỗi field số/chuỗi/ngày có ≥1 `boundary`; mỗi endpoint có phân quyền có ≥1
// `permission`". Nhưng code chỉ có một danh sách `['positive','negative']` dùng
// cho CẢ hai việc: (a) giá trị `type` nào là hợp lệ, (b) mỗi AC bắt buộc phải
// có những loại nào. Hệ quả quan sát được khi viết testplan đúng spec:
//
//   TC-017: type "boundary" không hợp lệ — phải là "positive" hoặc "negative"
//   TC-018: type "permission" không hợp lệ — phải là "positive" hoặc "negative"
//
// tức là gate ĐÁNH ĐỎ chính thứ spec BẮT BUỘC. Tách đôi:
//
// VALID_TC_TYPES  — `type` được phép nhận giá trị nào (cả bốn, theo spec).
// REQUIRED_AC_TYPES — mỗi AC bắt buộc có loại nào (chỉ positive + negative).
//
// `boundary`/`permission` CHƯA bị ép định lượng: ép "mỗi field số/chuỗi/ngày"
// đòi suy ra kiểu dữ liệu của từng field từ PRD — việc đó dễ đỏ oan hơn là bắt
// được lỗi thật, nên để rubric T2 chấm (rubric/40-testplan.md tiêu chí mutation
// test đã hỏi đúng câu đó). Ở đây chỉ cần: viết đúng spec thì không bị chặn.
const VALID_TC_TYPES = ['positive', 'negative', 'boundary', 'permission']
const REQUIRED_AC_TYPES = ['positive', 'negative']

function countOccurrences(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

// FINDING 3: strip fenced code blocks before parsing so a <tc> that only appears
// inside a ``` ... ``` example is treated as illustrative, not a real test case.
function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

function tcBlocks(text) {
  return [...stripFences(text).matchAll(/<tc\s+([^>]*)>([\s\S]*?)<\/tc>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
    return { attrs, body: m[2], raw: m[0] }
  })
}

// FINDING 2: parse "field: value" blocks the same way prd.js parses Q/A blocks — a
// value may begin on the line AFTER the field name and continue until the next known
// field name or the end of the tc body, instead of requiring it on the same line.
function parseFieldBlocks(body, fields) {
  const namePattern = fields.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`^\\s*(${namePattern})\\s*:`, 'gm')
  const starts = [...body.matchAll(re)]
  const values = new Map()
  starts.forEach((m, i) => {
    const name = m[1]
    const from = m.index + m[0].length
    const to = i + 1 < starts.length ? starts[i + 1].index : body.length
    if (!values.has(name)) values.set(name, body.slice(from, to).trim())
  })
  return values
}

// FINDING 4: recognize a known type case-insensitively (e.g. "Negative" ==
// "negative"); a value that doesn't match any known kind returns null so callers
// can fail loudly instead of silently treating it as "no type".
function normalizeType(type) {
  return VALID_TC_TYPES.find((k) => k === type?.trim().toLowerCase()) ?? null
}

// REVIEW FINDING 2: traceability must hold in both directions — every AC must be
// covered by at least one TC (forward), AND every TC's ac_ref must name a real AC
// (reverse). A dangling ac_ref (typo, stale reference) must not pass silently.
// ac_ref is trimmed before comparing so incidental whitespace isn't mistaken for a
// dangling reference.
export function checkTraceability(prdText, planText) {
  const acIds = parseAcIds(prdText)
  const acIdSet = new Set(acIds)
  const blocks = tcBlocks(planText)
  const covered = new Set(blocks.map((tc) => tc.attrs.ac_ref?.trim()).filter(Boolean))
  const missing = acIds.filter((id) => !covered.has(id))
  const messages = missing.length
    ? [`${missing.length}/${acIds.length} AC chưa có test case: ${missing.join(', ')}`]
    : []

  blocks.forEach((tc, i) => {
    const ref = tc.attrs.ac_ref?.trim()
    if (ref && !acIdSet.has(ref)) {
      const label = tc.attrs.id ?? `TC #${i + 1}`
      messages.push(`${label}: ac_ref "${ref}" không khớp AC nào trong PRD`)
    }
  })

  return { name: 'traceability', ok: messages.length === 0, messages }
}

export function checkTcSchema(planText, attrs = DEFAULT_ATTRS, fields = DEFAULT_FIELDS) {
  const messages = []
  const blocks = tcBlocks(planText)
  if (blocks.length === 0) messages.push('không tìm thấy test case nào')

  // FINDING 1: duplicate TC ids must fail, not silently overwrite each other in
  // downstream traceability/coverage aggregation.
  const ids = blocks.map((tc) => tc.attrs.id).filter(Boolean)
  for (const [id, count] of countOccurrences(ids)) {
    if (count > 1) messages.push(`TC id "${id}" bị lặp lại ${count} lần`)
  }

  blocks.forEach((tc, i) => {
    const label = tc.attrs.id ?? `TC #${i + 1}`
    for (const a of attrs) if (!tc.attrs[a]) messages.push(`${label}: thiếu thuộc tính "${a}"`)

    // FINDING 4: an unrecognized `type` value must fail loudly, with the bad value
    // named, instead of silently making the AC look uncovered with no explanation.
    if (tc.attrs.type && !normalizeType(tc.attrs.type)) {
      messages.push(`${label}: type "${tc.attrs.type}" không hợp lệ — phải là "${VALID_TC_TYPES.join('" hoặc "')}"`)
    }

    const values = parseFieldBlocks(tc.body, fields)
    for (const f of fields) {
      const value = values.get(f)
      if (value === undefined) messages.push(`${label}: thiếu trường "${f}"`)
      else if (!value) messages.push(`${label}: trường "${f}" bỏ trống`)
    }
  })
  return { name: 'tc-schema', ok: messages.length === 0, messages }
}

export function checkTypeRatio(prdText, planText) {
  const byAc = new Map()
  for (const tc of tcBlocks(planText)) {
    if (!tc.attrs.ac_ref) continue
    const type = normalizeType(tc.attrs.type)
    if (!type) continue
    if (!byAc.has(tc.attrs.ac_ref)) byAc.set(tc.attrs.ac_ref, new Set())
    byAc.get(tc.attrs.ac_ref).add(type)
  }
  const messages = []
  for (const id of parseAcIds(prdText)) {
    const types = byAc.get(id) ?? new Set()
    // Chỉ ép positive + negative. Một AC được phủ thêm bằng boundary/permission
    // là tốt hơn, nhưng không được dùng chúng để THAY THẾ hai loại bắt buộc.
    for (const need of REQUIRED_AC_TYPES) {
      if (!types.has(need)) messages.push(`${id}: thiếu case "${need}"`)
    }
  }
  return { name: 'type-ratio', ok: messages.length === 0, messages }
}

// B3 — `edgeCaseChecklist` (11 mục trong schema/40-testplan.json) TỪNG KHÔNG
// CÓ DÒNG CODE NÀO ĐỌC TỚI.
//
// Nó nằm cạnh `requiredTcAttrs`/`requiredTcFields` — hai key được thi hành thật
// — nên đọc schema thì tưởng cả ba đang là tiêu chí gate. Một config chết trông
// giống config đang thi hành là loại nợ tệ nhất trong repo này: nó làm người đọc
// tin rằng một lớp bảo vệ đang tồn tại.
//
// Hai lối ra, và tôi chọn lối thi hành: dùng ĐÚNG cơ chế của checklist rủi ro ở
// PRD (đã chạy thật trên artifact bootstrap) — không đòi phải CÓ test case cho
// từng mục, chỉ đòi VIẾT RA kết luận cho từng mục, "không áp dụng vì …" cũng
// tính. Đây là chỗ phân vai đúng: "có nghĩ tới biên này chưa" là câu hỏi tất
// định (T1 kiểm được), còn "biên này có thoả đáng không" là phán đoán (rubric
// T2). Ép định lượng theo kiểu dữ liệu của từng field thì phải suy kiểu từ PRD —
// dễ đỏ oan hơn là bắt được lỗi thật, đúng lý do `boundary`/`permission` ở B1
// cũng chỉ được nhận là type hợp lệ chứ không bị ép số lượng.
// Hai nhãn trong schema được viết rõ ra khi nối vào check này: `"rỗng"` →
// `"chuỗi rỗng"` và `"0"` → `"giá trị 0"`. Phép so là `<mục>\s*:\s*<kết luận>`,
// nên một nhãn dài đúng một ký tự số có thể được THOẢ TÌNH CỜ bởi một dòng khác
// trong cùng section (vd. `- số rất lớn: 2^30: tràn` chứa `0:`). Lúc còn là
// config chết thì nhãn viết thế nào cũng không sao; khi nó bắt đầu chặn thật thì
// phải so được chính xác.
export function checkEdgeCases(planText, items) {
  return checkSectionChecklist(planText, '40-testplan.md', {
    name: 'edge-cases',
    heading: '## Edge cases',
    label: 'mục edge case',
    items,
  })
}

// REVIEW FINDING 1: an absent 10-prd.md must never produce a vacuous pass. With no
// PRD, checkTraceability/checkTypeRatio have nothing to require and would otherwise
// report green no matter what the test plan contains — the worst failure mode this
// gate can have. Fail loudly here (same pattern as prd.js's checkQuestionsAnswered),
// naming the missing file, instead of substituting an empty string.
export function testplanChecks(featureDir, schema) {
  const prdPath = join(featureDir, '10-prd.md')
  const prdExists = existsSync(prdPath)
  const prd = prdExists ? readFileSync(prdPath, 'utf8') : ''
  const missingPrd = (name) => ({
    name,
    ok: false,
    messages: ['thiếu 10-prd.md — không thể kiểm tra traceability nếu không có PRD'],
  })
  return [
    { name: 'traceability', run: (t) => (prdExists ? checkTraceability(prd, t) : missingPrd('traceability')) },
    { name: 'tc-schema', run: (t) => checkTcSchema(t, schema.requiredTcAttrs, schema.requiredTcFields) },
    { name: 'type-ratio', run: (t) => (prdExists ? checkTypeRatio(prd, t) : missingPrd('type-ratio')) },
    { name: 'edge-cases', run: (t) => checkEdgeCases(t, schema.edgeCaseChecklist) },
  ]
}
