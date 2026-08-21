import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEars, checkIds, checkRiskChecklist, checkQuestionsAnswered, parseAcIds } from '../lib/checks/prd.js'

const OK_PRD = `## User stories
<us id="US-1">Là người dùng, tôi muốn gửi phản hồi</us>
<ac id="AC-1-1" story="US-1">
WHEN người dùng submit form hợp lệ THE SYSTEM SHALL lưu phản hồi và trả 201
</ac>
<ac id="AC-1-2" story="US-1">
IF form thiếu trường bắt buộc THE SYSTEM SHALL trả 400 kèm danh sách trường lỗi
</ac>

## Out of scope
- Không làm export CSV

## Rủi ro
- migrate dữ liệu cũ: không có dữ liệu cũ, feature mới hoàn toàn
- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint
`

test('AC đúng EARS thì pass', () => {
  assert.equal(checkEars(OK_PRD, 'p.md').ok, true)
})

test('AC không có SHALL thì fail và nêu id', () => {
  const bad = OK_PRD.replace('THE SYSTEM SHALL lưu phản hồi và trả 201', 'thì lưu phản hồi')
  const r = checkEars(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /AC-1-1/)
})

test('AC có hai SHALL thì fail vì bị gộp', () => {
  const bad = OK_PRD.replace(
    'THE SYSTEM SHALL lưu phản hồi và trả 201',
    'THE SYSTEM SHALL lưu phản hồi và THE SYSTEM SHALL gửi email',
  )
  const r = checkEars(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /gộp|hai/i)
})

test('AC trỏ tới US không tồn tại thì fail', () => {
  const bad = OK_PRD.replace('story="US-1"', 'story="US-9"')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /US-9/)
})

test('mục rủi ro bỏ trống thì fail', () => {
  const bad = OK_PRD.replace('- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint', '- ai không được phép:')
  const r = checkRiskChecklist(bad, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /ai không được phép/)
})

// LỖI CÓ SẴN, lộ ra khi cơ chế checklist được dùng lần thứ hai cho
// `edgeCaseChecklist` (B3): bản cũ so regex `<mục>\s*:\s*(.*)` trên CẢ KHỐI, và
// `\s*` ăn luôn ký tự xuống dòng — nên một mục bỏ trống ở GIỮA section mượn được
// kết luận của mục ngay sau nó và qua gate. Test ngay trên đây không bắt được vì
// nó bỏ trống đúng mục CUỐI section (không có dòng sau để mượn) — cùng một lỗi,
// hai vị trí khác nhau, chỉ một vị trí bị canh.
test('mục rủi ro bỏ trống Ở GIỮA section cũng fail — không mượn được kết luận của mục sau', () => {
  const bad = OK_PRD.replace(
    '- migrate dữ liệu cũ: không có dữ liệu cũ, feature mới hoàn toàn',
    '- migrate dữ liệu cũ:',
  )
  const r = checkRiskChecklist(bad, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /migrate dữ liệu cũ" bỏ trống/)
  // Mục sau vẫn phải được tính là đã kết luận — không đỏ lan.
  assert.doesNotMatch(r.messages.join('\n'), /ai không được phép/)
})

test('questions chưa trả lời hết thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  const qs = Array.from({ length: 8 }, (_, i) => `Q${i + 1}: câu hỏi ${i + 1}\nA: trả lời`).join('\n\n')
  writeFileSync(join(d, '10-questions.md'), qs.replace('A: trả lời', 'A:'))
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /Q1/)
})

test('đủ 8 câu và trả lời hết thì pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(join(d, '10-questions.md'), Array.from({ length: 8 }, (_, i) => `Q${i + 1}: hỏi\nA: đáp`).join('\n\n'))
  assert.equal(checkQuestionsAnswered(d).ok, true)
})

test('dưới 8 câu hỏi thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(join(d, '10-questions.md'), 'Q1: hỏi\nA: đáp\n')
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /8/)
})

// ─── Bản 2026-08-21 (trụ cột 2, đường b): khối "## Tự đánh giá độ rõ" ───
// Khi brief + refs đủ rõ, agent KHAI thay vì hỏi 8 câu. T1 chỉ kiểm cấu trúc
// của lời khai; tính trung thực của nó là việc của T2 (rubric #7) + human gate.

const CLEAR_BLOCK = `## Tự đánh giá độ rõ

Lý do đủ rõ: brief nêu đủ hiện trạng, phạm vi và ranh giới.
Giả định đã xác minh: bảng mới hoàn toàn, không chặn migration cũ (đã đọc schema hiện có).
`

test('khai khối tự đánh giá + 0 câu hỏi thì pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(join(d, '10-questions.md'), `# Câu hỏi\n\n${CLEAR_BLOCK}`)
  assert.equal(checkQuestionsAnswered(d).ok, true)
})

test('khai khối tự đánh giá + 2 câu verify trả lời đủ thì pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(
    join(d, '10-questions.md'),
    `# Câu hỏi\n\n${CLEAR_BLOCK}\nQ1: hỏi một?\nA: đáp một.\n\nQ2: hỏi hai?\nA: đáp hai.\n`,
  )
  assert.equal(checkQuestionsAnswered(d).ok, true)
})

test('khai khối tự đánh giá nhưng hỏi 3 câu thì fail — mâu thuẫn với lời khai', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(
    join(d, '10-questions.md'),
    `# Câu hỏi\n\n${CLEAR_BLOCK}\nQ1: hỏi?\nA: đáp.\n\nQ2: hỏi?\nA: đáp.\n\nQ3: hỏi?\nA: đáp.\n`,
  )
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /tối đa 2 câu verify/)
  assert.match(r.messages.join('\n'), /xoá khối/)
})

test('khối tự đánh giá thiếu dòng "Lý do đủ rõ" thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(
    join(d, '10-questions.md'),
    '# Câu hỏi\n\n## Tự đánh giá độ rõ\n\nGiả định đã xác minh: bảng mới hoàn toàn.\n',
  )
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /Lý do đủ rõ/)
})

test('dòng "Giả định đã xác minh" bỏ trống thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(
    join(d, '10-questions.md'),
    '# Câu hỏi\n\n## Tự đánh giá độ rõ\n\nLý do đủ rõ: brief nêu đủ phạm vi.\nGiả định đã xác minh:\n',
  )
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /Giả định đã xác minh/)
})

// Cùng luật "cùng dòng" của checkSectionChecklist (xem test "mục rủi ro bỏ trống
// Ở GIỮA section"): giá trị nhãn là phần còn lại của CHÍNH dòng đó — không mượn
// được nội dung dòng sau, nếu không một nhãn bỏ trống sẽ qua gate.
test('giá trị nhãn viết ở dòng sau không được tính — không mượn được dòng kế', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(
    join(d, '10-questions.md'),
    '# Câu hỏi\n\n## Tự đánh giá độ rõ\n\nLý do đủ rõ:\nbrief nêu đủ phạm vi ở dòng này nhưng không tính.\nGiả định đã xác minh: bảng mới hoàn toàn.\n',
  )
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.equal(r.messages.length, 1)
  assert.match(r.messages[0], /Lý do đủ rõ/)
})

test('khai khối tự đánh giá + câu verify chưa có câu trả lời thì fail', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  writeFileSync(join(d, '10-questions.md'), `# Câu hỏi\n\n${CLEAR_BLOCK}\nQ1: hỏi?\nA:\n`)
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /Q1 chưa có câu trả lời/)
})

// FINDING 1: literal space in EARS patterns false-fails a multi-line AC
test('AC có xuống dòng trước THE SYSTEM SHALL vẫn pass', () => {
  const withNewline = OK_PRD.replace(
    'hợp lệ THE SYSTEM SHALL lưu phản hồi',
    'hợp lệ\nTHE SYSTEM SHALL lưu phản hồi',
  )
  assert.equal(checkEars(withNewline, 'p.md').ok, true)
})

// FINDING (lab 2026-08-21): bộ đếm SHALL dùng literal "THE SYSTEM SHALL" trong
// khi regex EARS phía trên dùng \s+ — wrap dòng GIỮA ba chữ đó bị báo "thiếu" oan.
test('AC xuống dòng giữa THE / SYSTEM / SHALL vẫn được đếm là một SHALL', () => {
  for (const wrapped of [
    'hợp lệ THE\nSYSTEM SHALL lưu phản hồi',
    'hợp lệ THE SYSTEM\nSHALL lưu phản hồi',
  ]) {
    const r = checkEars(OK_PRD.replace('hợp lệ THE SYSTEM SHALL lưu phản hồi', wrapped), 'p.md')
    assert.equal(r.ok, true, r.messages.join('\n'))
  }
})

// FINDING 2: duplicate US-*/AC-* ids are not detected
test('US id bị lặp thì fail và nêu số lần', () => {
  const bad = OK_PRD.replace(
    '## Out of scope',
    '<us id="US-1">Là người dùng, tôi muốn xem lịch sử</us>\n\n## Out of scope',
  )
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /US-1/)
  assert.match(r.messages.join('\n'), /2/)
})

test('AC id bị lặp thì fail và nêu số lần', () => {
  const bad = OK_PRD.replace('<ac id="AC-1-2" story="US-1">', '<ac id="AC-1-1" story="US-1">')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /AC-1-1/)
  assert.match(r.messages.join('\n'), /2/)
})

test('id duy nhất thì vẫn pass', () => {
  assert.equal(checkIds(OK_PRD, 'p.md').ok, true)
})

// FINDING 3: risk checklist must be scoped to the ## Rủi ro section, code fences stripped
test('mục rủi ro chỉ xuất hiện trong code fence thì vẫn fail', () => {
  const bad = OK_PRD.replace(
    '- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint',
    '```\n- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint\n```',
  )
  const r = checkRiskChecklist(bad, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /ai không được phép/)
})

test('mục rủi ro chỉ xuất hiện ngoài section Rủi ro thì fail', () => {
  const bad = OK_PRD.replace(
    '- Không làm export CSV',
    '- Không làm export CSV\n- ai không được phép: đã ghi ở đây nhưng nằm ngoài section Rủi ro',
  ).replace('- ai không được phép: người dùng chưa đăng nhập không gọi được endpoint\n', '')
  const r = checkRiskChecklist(bad, 'p.md', ['ai không được phép'])
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /ai không được phép/)
})

test('mục rủi ro đầy đủ đúng trong section Rủi ro thì pass', () => {
  const r = checkRiskChecklist(OK_PRD, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, true)
})

test('thiếu hẳn heading Rủi ro thì đỏ bằng MỘT dòng gộp (không lặp mỗi mục cùng lý do)', () => {
  const bad = OK_PRD.replace(/## Rủi ro[\s\S]*/, '')
  const r = checkRiskChecklist(bad, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, false)
  assert.equal(r.messages.length, 1)
  assert.match(r.messages[0], /không tìm thấy heading "## Rủi ro"/)
  assert.match(r.messages[0], /2 mục rủi ro chưa kiểm được/)
})

// FINDING 4: answer written on the line after "A:" must still count as answered
test('câu trả lời viết ở dòng sau A: vẫn được tính là đã trả lời', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  const qs = Array.from({ length: 8 }, (_, i) => `Q${i + 1}: hỏi ${i + 1}\nA:\ntrả lời ở dòng sau`).join('\n\n')
  writeFileSync(join(d, '10-questions.md'), qs)
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, true)
})

// FINDING 5: count DISTINCT question numbers, not matched pairs
test('8 bản sao Q1 giống hệt thì fail vì đếm theo số câu hỏi phân biệt', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-q-'))
  const qs = Array.from({ length: 8 }, () => `Q1: hỏi\nA: đáp`).join('\n\n')
  writeFileSync(join(d, '10-questions.md'), qs)
  const r = checkQuestionsAnswered(d)
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /Q1/)
})

// BUG FIX: the old <ac>/<us> regexes only matched the exact literal shapes
// `<ac id="X">`, `<ac id="X" story="Y">` and `<us id="X">` (id first). Any other
// attribute shape — a typo'd attribute name, id missing, id not first — made the
// whole block invisible to every check. Now blocks are parsed generically by tag
// name and their attributes validated explicitly instead of silently skipped.

test('AC với thuộc tính story-x (lỗi gõ) thì checkIds fail và nêu cả id lẫn tên thuộc tính sai', () => {
  const bad = OK_PRD.replace('<ac id="AC-1-1" story="US-1">', '<ac id="AC-1-1" story-x="US-1">')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  const joined = r.messages.join('\n')
  assert.match(joined, /AC-1-1/)
  assert.match(joined, /story-x/)
})

test('AC với thuộc tính story-x (lỗi gõ) thì body vẫn được checkEars kiểm tra, không bị bỏ qua', () => {
  const bad = OK_PRD.replace('<ac id="AC-1-1" story="US-1">', '<ac id="AC-1-1" story-x="US-1">').replace(
    'THE SYSTEM SHALL lưu phản hồi và trả 201',
    'thì lưu phản hồi',
  )
  const r = checkEars(bad, 'p.md')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /AC-1-1/)
})

test('AC không có id thì checkIds fail với thông báo xác định được block', () => {
  const bad = OK_PRD.replace('<ac id="AC-1-1" story="US-1">', '<ac story="US-1">')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  const joined = r.messages.join('\n')
  assert.match(joined, /thiếu thuộc tính id/)
  assert.match(joined, /AC #1|WHEN người dùng submit/)
})

test('US thiếu id (chỉ có name) thì fail thay vì âm thầm cho ra 0 story', () => {
  const bad = OK_PRD.replace('<us id="US-1">', '<us name="US-1">')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  const joined = r.messages.join('\n')
  assert.match(joined, /thiếu thuộc tính id|không tìm thấy user story/)
  assert.match(joined, /name/)
})

test('US có thuộc tính lạ "note" thì fail và nêu tên thuộc tính', () => {
  const bad = OK_PRD.replace('<us id="US-1">', '<us id="US-1" note="x">')
  const r = checkIds(bad, 'p.md')
  assert.equal(r.ok, false)
  const joined = r.messages.join('\n')
  assert.match(joined, /US-1/)
  assert.match(joined, /note/)
})

test('tài liệu hợp lệ <ac id/story> và <us id> vẫn pass như trước', () => {
  assert.equal(checkEars(OK_PRD, 'p.md').ok, true)
  assert.equal(checkIds(OK_PRD, 'p.md').ok, true)
})

test('parseAcIds vẫn lấy được id của block có thuộc tính lỗi kèm theo', () => {
  const bad = OK_PRD.replace('<ac id="AC-1-1" story="US-1">', '<ac id="AC-1-1" story-x="US-1">')
  const ids = parseAcIds(bad)
  assert.deepEqual(ids, ['AC-1-1', 'AC-1-2'])
})
