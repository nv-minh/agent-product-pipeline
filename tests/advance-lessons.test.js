// D6 — lessons/ TỪNG LÀ SỔ CHỈ-GHI. README hứa "inject vào prompt stage đó lần
// sau"; grep lib/ + bin/ trước bản vá: 1 writer (override/unblock), 0 reader.
// Vòng học không đóng — bài học nằm im trong một file không ai mở, và feature
// sau đỏ lại đúng chỗ cũ. Test này khoá reader đó: `pp advance` phải đưa bài
// học của stage vào chính chỉ thị mà subagent sẽ đọc.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

function initDemo() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  return r0
}

test('D6: chưa có bài học nào — chỉ thị không có mục "Bài học cũ"', () => {
  const r0 = initDemo()
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /Bài học cũ/)
})

test('D6: lessons/<stage>.md có nội dung — chỉ thị stage ĐÓ chứa nguyên văn bài học', () => {
  const r0 = initDemo()
  mkdirSync(join(r0, 'lessons'), { recursive: true })
  writeFileSync(join(r0, 'lessons', '10-prd.md'),
    '- 2026-08-19 — unblock (khac): chỉ thị không nói trước luật frontmatter\n' +
    '- 2026-08-20 — override (khac): rubric đòi "đồng thời" mà PRD không nhắc\n')
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /Bài học cũ của stage này \(lessons\/10-prd\.md/)
  assert.match(r.out, /luật frontmatter/)
  assert.match(r.out, /rubric đòi "đồng thời"/)
})

test('D6: bài học của stage KHÁC không lẫn vào — 40-testplan.md không xuất hiện ở chỉ thị 10-prd', () => {
  const r0 = initDemo()
  mkdirSync(join(r0, 'lessons'), { recursive: true })
  writeFileSync(join(r0, 'lessons', '40-testplan.md'), '- 2026-08-19 — bài học của testplan\n')
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /bài học của testplan/)
})

test('D6: file lessons phình to — chỉ in 10 dòng CUỐI và nói rõ số dòng bị cắt', () => {
  const r0 = initDemo()
  mkdirSync(join(r0, 'lessons'), { recursive: true })
  const lines = Array.from({ length: 14 }, (_, i) => `- 2026-08-0${(i % 9) + 1} — bài học số ${i + 1}`)
  writeFileSync(join(r0, 'lessons', '10-prd.md'), lines.join('\n') + '\n')
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /4 dòng cũ hơn không in/)
  assert.match(r.out, /bài học số 14/)
  assert.match(r.out, /bài học số 5/)
  assert.doesNotMatch(r.out, /bài học số 4\b/)
})
