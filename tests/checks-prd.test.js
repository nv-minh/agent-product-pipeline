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

// FINDING 1: literal space in EARS patterns false-fails a multi-line AC
test('AC có xuống dòng trước THE SYSTEM SHALL vẫn pass', () => {
  const withNewline = OK_PRD.replace(
    'hợp lệ THE SYSTEM SHALL lưu phản hồi',
    'hợp lệ\nTHE SYSTEM SHALL lưu phản hồi',
  )
  assert.equal(checkEars(withNewline, 'p.md').ok, true)
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

test('thiếu hẳn heading Rủi ro thì mọi mục fail và báo thiếu heading', () => {
  const bad = OK_PRD.replace(/## Rủi ro[\s\S]*/, '')
  const r = checkRiskChecklist(bad, 'p.md', ['migrate dữ liệu cũ', 'ai không được phép'])
  assert.equal(r.ok, false)
  assert.equal(r.messages.length, 2)
  assert.match(r.messages[0], /Rủi ro/)
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
