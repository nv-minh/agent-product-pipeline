// FINDING (adversarial review 8c825c9..44c1ecb): `40-regression` dùng id riêng
// (spec §4.3 — bộ check testplan gắn cứng traceability theo AC mà bugfix không
// có), nên nó không match nhánh nào trong registry và mất TRỌN bộ check của một
// test plan: chỉ còn 4 check chung (frontmatter/placeholders/headings/
// cited-paths). Luật quan trọng nhất của stage này — spec §4.3(3): "MỖI mục
// Unchanged trong 05-diagnosis.md có ít nhất 1 test truy vết về nó" — vì thế
// chỉ nằm trong rubric T2.
//
// Spec nói thẳng: "check đếm/truy vết dạng JS thêm sau nếu rubric T2 tỏ ra không
// đủ — quyết định lúc implement". Một artifact bỏ hẳn một mục Unchanged mà T1
// vẫn xanh là bằng chứng nó không đủ, nên check đó ra đời ở đây.
//
// Cùng hình dạng `testplanChecks`: đọc artifact thượng nguồn từ đĩa, và thiếu nó
// thì ĐỎ có lý do (không bao giờ pass rỗng — REVIEW FINDING 1 của testplan.js).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractSection } from './common.js'

// Mỗi mục Unchanged là một dòng bullet trong `## Unchanged behavior` của
// diagnosis. Truy vết = tên/nội dung mục đó phải được NHẮC trong artifact
// regression; đối chiếu bằng các từ khoá của chính mục (không phải khớp nguyên
// văn cả câu — regression được quyền diễn đạt lại, nhưng không được im lặng bỏ).
function unchangedItems(diagnosisText) {
  const section = extractSection(diagnosisText, '## Unchanged behavior')
  if (section === null) return null
  return section
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('* '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)
}

// Toàn bộ token đủ dài của một mục (chưa cắt top-3): việc lọc từ dùng chung phải
// nhìn ĐẦY ĐỦ bộ token của mọi mục trước, nếu cắt top-3 sớm thì từ chung lại lọt
// vào top của mục này vì nó "dài" — đúng lỗi mà lớp lọc dưới đây tồn tại để sửa.
function tokensCủa(item) {
  return [...new Set(
    item.toLowerCase()
      .replace(/[`*_()[\]{}.,;:!?"']/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  )]
}

// Ngưỡng: ít nhất HAI token đặc trưng phải xuất hiện (một token với mục ngắn chỉ
// có một token). Đòi đủ cả ba là đỏ oan — regression được quyền diễn đạt lại,
// miễn là nhắc đích danh mục nào nó đang bảo vệ (đúng rubric 40-regression tiêu
// chí 2). Đòi một token thì quá lỏng: một chữ như "dung" khớp bừa vào bất cứ đâu.
const CẦN_KHỚP = 2

// FINDING (lab 2026-08-21): token "đại diện" trước đây chỉ là 3 từ dài nhất của
// mục — tức thường là từ PHỔ THÔNG dùng chung giữa các mục ("nguyên", "không",
// "trường"…), và khớp `includes` trên toàn section cho phép token của mục A bắt
// gặp trong test của mục B. Xoá hẳn nội dung test của 2/4 mục Unchanged — gate
// vẫn xanh. Hai lớp sửa:
// (1) một token chỉ còn "đại diện" cho mục X nếu KHÔNG mục anh em nào cũng có
//     nó — từ chung chứng tỏ section nhắc chủ đề chung, không phải test nào
//     nhắc đích danh mục X;
// (2) khớp theo biên từ (unicode), không phải substring — token không được
//     nằm gạch chéo giữa một từ dài hơn.
const stripDấuCâu = (s) => s.toLowerCase().replace(/[`*_()[\]{}.,;:!?"']/g, ' ')

function chứaToken(hay, token) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(hay)
}

function tokensPhânBiệt(items) {
  const perItem = items.map(tokensCủa)
  const lầnXuấtHiện = new Map()
  for (const toks of perItem) for (const t of toks) lầnXuấtHiện.set(t, (lầnXuấtHiện.get(t) ?? 0) + 1)
  // Sau khi bỏ từ chung mới lấy 3 token dài nhất — đủ đặc trưng để không khớp
  // bừa, đủ ít để regression vẫn được quyền diễn đạt lại.
  return perItem.map((toks) =>
    toks.filter((t) => lầnXuấtHiện.get(t) === 1).sort((a, b) => b.length - a.length).slice(0, 3))
}

function phủĐược(hay, tokens, item) {
  if (!tokens.length) {
    // Mọi từ khoá của mục đều dùng chung với mục khác: chỉ còn trích nguyên văn
    // (hoặc diễn đạt kèm đủ cụm đặc trưng) là chứng tỏ được mục này được nhắc.
    return hay.includes(stripDấuCâu(item).replace(/\s+/g, ' ').trim())
  }
  const khớp = tokens.filter((t) => chứaToken(hay, t)).length
  return khớp >= Math.min(CẦN_KHỚP, tokens.length)
}

export function checkUnchangedTraceability(regressionText, featureDir) {
  const name = 'unchanged-traceability'
  const p = join(featureDir, '05-diagnosis.md')
  if (!existsSync(p)) {
    return {
      name,
      ok: false,
      messages: ['thiếu 05-diagnosis.md — không thể kiểm mỗi mục Unchanged behavior có test truy vết'],
    }
  }
  const items = unchangedItems(readFileSync(p, 'utf8'))
  if (items === null) {
    return {
      name,
      ok: false,
      messages: ['05-diagnosis.md không có heading "## Unchanged behavior" — không có gì để truy vết về'],
    }
  }
  if (items.length === 0) {
    return {
      name,
      ok: false,
      messages: [
        '05-diagnosis.md: mục "## Unchanged behavior" rỗng — bugfix nào cũng có hành vi phải giữ nguyên.',
        'Liệt kê từng hành vi thành một dòng bullet, rồi 40-regression phủ mỗi dòng bằng ít nhất một test.',
      ],
    }
  }
  // Chỉ soi trong section "Test bảo vệ unchanged" — không phải toàn artifact.
  // Quét cả file thì một câu ở "Test xác nhận fix" tình cờ dùng chung từ ngữ đã
  // đủ làm mục Unchanged trông như được phủ (đã gặp thật khi viết check này):
  // cùng loại "pass rỗng" mà testplan.js:186-190 gọi là failure mode tệ nhất.
  const bảoVệ = extractSection(regressionText, '## Test bảo vệ unchanged')
  if (bảoVệ === null) {
    return {
      name,
      ok: false,
      messages: ['40-regression.md: thiếu heading "## Test bảo vệ unchanged" — không có chỗ nào truy vết về mục Unchanged của diagnosis'],
    }
  }
  // Làm phẳng khoảng trắng để trích nguyên văn (fallback) vẫn khớp khi mục
  // được chép lại với ngắt dòng khác bản gốc.
  const hay = stripDấuCâu(bảoVệ).replace(/\s+/g, ' ')
  const bộTokens = tokensPhânBiệt(items)
  const messages = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const tokens = bộTokens[i]
    if (phủĐược(hay, tokens, item)) continue
    const gợiÝ = tokens.length
      ? `tìm ≥${Math.min(CẦN_KHỚP, tokens.length)} trong ${tokens.map((t) => `"${t}"`).join(', ')}`
      : 'các từ khoá của mục đều trùng với mục khác — hãy trích nguyên văn nội dung mục'
    messages.push(
      `40-regression.md: mục Unchanged behavior "${item}" không được test nào phủ — ` +
      `phải có test nhắc đích danh nó (${gợiÝ})`,
    )
  }
  return { name, ok: messages.length === 0, messages }
}

export function regressionChecks(featureDir) {
  return [
    { name: 'unchanged-traceability', run: (t) => checkUnchangedTraceability(t, featureDir) },
  ]
}
