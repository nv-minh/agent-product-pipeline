import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEars, checkIds, checkRiskChecklist, checkQuestionsAnswered } from '../lib/checks/prd.js'

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
