import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PLACEHOLDER = /\bTBD\b|\bTODO\b|\bFIXME\b|\bXXX\b|\?\?\?|\{\{[^}]*\}\}/

// ─────────────────────────────────────────────────────────────────────────
// B2 — SPEC §5.1 LIỆT KÊ FRONTMATTER LÀ LUẬT CHUNG CHO MỌI ARTIFACT, VÀ
// KHÔNG CÓ DÒNG CODE NÀO KIỂM NÓ.
//
// "Chung mọi artifact: file tồn tại & khác rỗng · frontmatter hợp lệ
// (`feature, stage, updated, source`) · đủ heading bắt buộc · …" — `grep -rn
// frontmatter lib/` trả về 0 dòng. Quan sát được: một PRD KHÔNG có frontmatter
// nào đi qua T1 xanh sạch.
//
// Vì sao nó đáng kiểm chứ không phải thủ tục giấy tờ: `stage` và `feature` là
// hai dữ kiện mà `pp` BIẾT CHẮC (thư mục feature, id stage đang gate), nên đối
// chiếu được — và lỗi hay gặp nhất khi một agent viết artifact là copy nguyên
// file từ feature/stage khác rồi sửa nội dung mà quên sửa đầu file. Khi đó
// artifact tự khai nó thuộc về chỗ khác, và mọi thứ đọc nó (kể cả người) bị dẫn
// sai. Đây là loại lỗi tất định, đúng tầng T1.
const DEFAULT_FRONTMATTER = ['feature', 'stage', 'updated', 'source']
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/
const KV = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/
// Chỉ ép DẠNG ngày, không ép giá trị: `pp` không biết "đúng ngày" là ngày nào
// (nó không được ghi artifact), nên đòi hơn thế là đỏ oan.
const DATEISH = /^\d{4}-\d{2}-\d{2}([T ].*)?$/

export { DEFAULT_FRONTMATTER }

export function parseFrontmatter(text) {
  const m = BLOCK.exec(text)
  if (!m) return null
  const values = new Map()
  for (const line of m[1].split('\n')) {
    const kv = KV.exec(line.trim())
    // Frontmatter của artifact ở đây là danh sách key: value phẳng (spec §5.1
    // liệt kê đúng bốn key vô hướng). Dòng không phải `key: value` — comment,
    // dòng trống, một khối YAML lồng — bị bỏ qua chứ không làm cả khối vô hiệu.
    if (kv && !values.has(kv[1])) values.set(kv[1], kv[2].trim())
  }
  return values
}

export function checkFrontmatter(text, required, expected, file) {
  const values = parseFrontmatter(text)
  if (values === null) {
    return {
      name: 'frontmatter',
      ok: false,
      messages: [
        `${file}: thiếu frontmatter ở đầu file — cần khối \`---\` … \`---\` với: ${required.join(', ')}`,
      ],
    }
  }
  const messages = []
  for (const k of required) {
    if (!values.has(k)) messages.push(`${file}: frontmatter thiếu "${k}"`)
    else if (!values.get(k)) messages.push(`${file}: frontmatter "${k}" bỏ trống`)
  }
  // Đối chiếu với dữ kiện `pp` đã biết. Chỉ so khi CÓ giá trị để so — thiếu key
  // đã được báo ở trên rồi, không báo hai lần cùng một chuyện.
  for (const [k, want] of Object.entries(expected)) {
    const got = values.get(k)
    if (want === undefined || !got) continue
    if (got !== want) {
      messages.push(
        `${file}: frontmatter ${k}: "${got}" không khớp "${want}" — artifact này nằm trong ${want}, ` +
        'sửa đầu file hoặc bạn đang copy từ chỗ khác',
      )
    }
  }
  const updated = values.get('updated')
  if (updated && !DATEISH.test(updated)) {
    messages.push(`${file}: frontmatter updated: "${updated}" không phải ngày dạng YYYY-MM-DD`)
  }
  return { name: 'frontmatter', ok: messages.length === 0, messages }
}

// ─────────────────────────────────────────────────────────────────────────
// B3 — CƠ CHẾ "MỘT SECTION, MỘT CHECKLIST, MỖI MỤC PHẢI CÓ KẾT LUẬN".
//
// `checkRiskChecklist` (lib/checks/prd.js) đã chứng minh cơ chế này chạy được
// trên artifact thật: nó không đòi giải quyết rủi ro, chỉ đòi VIẾT RA kết luận
// cho từng mục — kể cả "không áp dụng vì …". Nhờ vậy nó không đỏ oan mà vẫn ép
// người viết đi qua từng mục một.
//
// `schema/40-testplan.json` khai `edgeCaseChecklist` 11 mục mà KHÔNG code nào
// đọc: nó trông như một gate criterion đang được thi hành, và không phải. Tách
// cơ chế ra đây để cả hai checklist dùng chung một bản, thay vì viết bản thứ hai
// (rồi hai bản trôi khỏi nhau).
export function extractSection(text, heading) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

export function checkSectionChecklist(text, file, { name, heading, label, items = [] }) {
  const messages = []
  const section = extractSection(text, heading)
  if (section === null) {
    for (const item of items) {
      messages.push(`${file}: thiếu ${label} "${item}" — không tìm thấy heading "${heading}"`)
    }
    return { name, ok: items.length === 0, messages }
  }
  // Ví dụ trong khối ``` không được tính là đã kết luận.
  const scoped = section.replace(/```[\s\S]*?```/g, '')
  // LỖI CÓ SẴN, lộ ra khi cơ chế này được dùng lần thứ hai (B3): bản cũ so một
  // regex `<mục>\s*:\s*(.*)` trên CẢ KHỐI văn bản. `\s*` sau dấu hai chấm ăn
  // luôn ký tự xuống dòng, nên `(.*)` bắt được nội dung của DÒNG SAU — một mục
  // bỏ trống ở GIỮA section âm thầm "mượn" kết luận của mục kế tiếp và qua gate.
  // Nhánh "bỏ trống" vì thế gần như không bao giờ chạy: nó chỉ bắt được đúng
  // trường hợp mục bỏ trống nằm ở DÒNG CUỐI section (đúng hình dạng của test
  // `mục rủi ro bỏ trống thì fail`, nên lỗi này chưa từng bị phát hiện).
  //
  // Quét theo TỪNG DÒNG, và chỉ nhận khoảng trắng cùng dòng (`[ \t]*`): kết luận
  // của một mục là phần còn lại của chính dòng đó, không phải dòng sau nó.
  const lines = scoped.split('\n')
  for (const item of items) {
    const re = new RegExp(`${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:(.*)$`, 'i')
    const hit = lines.map((l) => re.exec(l)).find(Boolean)
    if (!hit) messages.push(`${file}: thiếu ${label} "${item}"`)
    else if (!hit[1].trim()) {
      messages.push(`${file}: ${label} "${item}" bỏ trống — phải có kết luận, kể cả "không áp dụng vì …"`)
    }
  }
  return { name, ok: messages.length === 0, messages }
}

export function checkPlaceholders(text, file) {
  const messages = []
  text.split('\n').forEach((line, i) => {
    const m = line.match(PLACEHOLDER)
    if (m) messages.push(`${file} dòng ${i + 1}: còn placeholder "${m[0]}"`)
  })
  return { name: 'placeholders', ok: messages.length === 0, messages }
}

// FINDING (review 8c825c9..44c1ecb): bản cũ dùng `text.includes(h)` — không neo
// dòng, không strip code fence, không phân biệt cấp heading. Ba đường lọt, tất
// cả đều xanh: `### Delta` (vì "### Delta".includes("## Delta")), một
// `## Delta` nằm trong khối ```, và câu văn xuôi "phần ## Delta sẽ viết sau".
// Heading là một DÒNG, nên so theo dòng — cùng cách `extractSection` đã làm
// (`line.trim() === heading`), để hai bên không nói khác nhau về "có heading".
export function checkHeadings(text, required, file) {
  const lines = text.replace(/```[\s\S]*?```/g, '').split('\n')
  const present = new Set(lines.map((l) => l.trim()))
  const messages = required
    .filter((h) => !present.has(h))
    .map((h) => `${file}: thiếu heading bắt buộc "${h}"`)
  return { name: 'headings', ok: messages.length === 0, messages }
}

const LOOKS_LIKE_PATH = /^[\w./@-]+\/[\w./@-]+\.[a-z]{1,5}$/i

export function checkCitedPaths(text, repoRoot, file) {
  const messages = []
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const candidate = m[1].trim()
    if (!LOOKS_LIKE_PATH.test(candidate)) continue

    // FINDING 5: Skip non-repo-relative paths
    // Skip if contains a scheme (://)
    if (candidate.includes('://')) continue
    // Skip if starts with @ (scoped package)
    if (candidate.startsWith('@')) continue
    // Skip if first path segment contains a dot (hostname-like)
    const firstSegment = candidate.split('/')[0]
    if (firstSegment.includes('.')) continue

    if (!existsSync(join(repoRoot, candidate))) {
      messages.push(`${file}: cite đường dẫn không tồn tại "${candidate}"`)
    }
  }
  return { name: 'cited-paths', ok: messages.length === 0, messages }
}
