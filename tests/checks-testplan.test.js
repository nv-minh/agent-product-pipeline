import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTraceability, checkTcSchema, checkTypeRatio } from '../lib/checks/testplan.js'

const PRD = `
<ac id="AC-1-1" story="US-1">WHEN a THE SYSTEM SHALL b</ac>
<ac id="AC-1-2" story="US-1">IF c THE SYSTEM SHALL d</ac>
`

const PLAN = `
<tc id="TC-001" ac_ref="AC-1-1" type="positive" priority="high">
precondition: đã đăng nhập
steps: submit form hợp lệ
expected: trả 201
</tc>
<tc id="TC-002" ac_ref="AC-1-1" type="negative" priority="high">
precondition: đã đăng nhập
steps: submit form thiếu trường
expected: trả 400
</tc>
`

const FULL_PLAN = `${PLAN}
<tc id="TC-003" ac_ref="AC-1-2" type="positive" priority="low">
precondition: -
steps: c xảy ra
expected: d
</tc>
<tc id="TC-004" ac_ref="AC-1-2" type="negative" priority="low">
precondition: -
steps: c không xảy ra
expected: không d
</tc>
`

test('AC không được phủ thì fail và liệt kê đúng id', () => {
  const r = checkTraceability(PRD, PLAN)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /AC-1-2/)
  assert.doesNotMatch(r.messages.join(' '), /AC-1-1/)
})

test('phủ đủ thì pass', () => {
  assert.equal(checkTraceability(PRD, FULL_PLAN).ok, true)
})

test('TC thiếu field bắt buộc thì fail và nêu tên field', () => {
  const bad = PLAN.replace(' priority="high">', '>')
  const r = checkTcSchema(bad)
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /priority/)
})

test('TC thiếu expected trong thân thì fail', () => {
  const bad = PLAN.replace('expected: trả 201\n', '')
  const r = checkTcSchema(bad)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /expected/)
})

test('AC chỉ có case thuận thì fail vì thiếu negative', () => {
  const onlyPositive = PLAN.replace('type="negative"', 'type="positive"')
  const r = checkTypeRatio(PRD, onlyPositive)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /AC-1-1.*negative/s)
})

// FINDING 1: duplicate TC-* ids must fail, naming the id and its occurrence count —
// left undetected, they silently corrupt traceability/coverage aggregation.
test('TC id bị lặp thì fail và nêu số lần', () => {
  const bad = PLAN.replace('id="TC-002"', 'id="TC-001"')
  const r = checkTcSchema(bad)
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /TC-001/)
  assert.match(r.messages.join('\n'), /2/)
})

// FINDING 2: a field value that begins on the line AFTER "field:" must still count
// as non-empty, the same way prd.js's Q/A parser accepts an answer on the next line.
test('giá trị field viết xuống dòng tiếp theo vẫn được tính là không rỗng', () => {
  const wrapped = PLAN.replace(
    'steps: submit form hợp lệ\n',
    'steps:\nsubmit form hợp lệ, dữ liệu dài\nvẫn tiếp tục ở dòng sau\n',
  )
  const r = checkTcSchema(wrapped)
  assert.equal(r.ok, true)
})

test('field để trống dù giá trị hụt sang dòng sau thì vẫn fail', () => {
  const bad = PLAN.replace('steps: submit form hợp lệ\n', 'steps:\n')
  const r = checkTcSchema(bad)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /steps/)
})

// FINDING 3: a <tc> that only appears inside a fenced code block is an illustrative
// example, not a real test case — it must not count for traceability or schema checks.
test('tc chỉ nằm trong code fence không được tính là test case thật (traceability)', () => {
  const planWithFencedExample = `${PLAN}
Ví dụ minh hoạ:
\`\`\`
<tc id="TC-999" ac_ref="AC-1-2" type="positive" priority="low">
precondition: -
steps: minh hoạ
expected: minh hoạ
</tc>
\`\`\`
`
  const r = checkTraceability(PRD, planWithFencedExample)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /AC-1-2/)
})

test('tc lỗi schema nhưng nằm trong code fence thì không bị tính là test case thật', () => {
  const planWithBadFencedTc = `${PLAN}
\`\`\`
<tc id="TC-BAD" ac_ref="AC-1-1" type="positive">
precondition: -
</tc>
\`\`\`
`
  const r = checkTcSchema(planWithBadFencedTc)
  assert.equal(r.ok, true)
})

// FINDING 4: `type` must be compared case-insensitively for known kinds, and an
// unrecognized value must fail loudly rather than silently leave the AC "uncovered".
test('type viết hoa/thường khác nhau vẫn được tính đúng loại (case-insensitive)', () => {
  const mixedCase = FULL_PLAN.replace('type="negative"', 'type="Negative"')
  const r = checkTypeRatio(PRD, mixedCase)
  assert.equal(r.ok, true)
})

test('type không thuộc positive/negative thì fail rõ ràng, không bị bỏ qua âm thầm', () => {
  const badType = PLAN.replace('type="negative"', 'type="Negativee"')
  const r = checkTcSchema(badType)
  assert.equal(r.ok, false)
  assert.match(r.messages.join(' '), /Negativee/)
})
