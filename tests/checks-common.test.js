import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPlaceholders, checkHeadings, checkCitedPaths } from '../lib/checks/common.js'

test('bắt mọi biến thể placeholder', () => {
  const r = checkPlaceholders('phần này TBD\ncòn đây TODO\nvà {{tên}}', 'x.md')
  assert.equal(r.ok, false)
  assert.equal(r.messages.length, 3)
  assert.match(r.messages[0], /dòng 1/)
})

test('văn bản sạch thì pass', () => {
  assert.equal(checkPlaceholders('nội dung đầy đủ', 'x.md').ok, true)
})

test('thiếu heading bắt buộc thì nêu đúng tên thiếu', () => {
  const r = checkHeadings('## User stories\n', ['## User stories', '## Out of scope'], 'x.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /## Out of scope/)
})

test('đường dẫn cite không tồn tại thì fail', () => {
  const r = checkCitedPaths('xem `src/khong/co/that.ts`', process.cwd(), 'x.md')
  assert.equal(r.ok, false)
  assert.match(r.messages[0], /src\/khong\/co\/that\.ts/)
})

test('backtick không phải path thì bỏ qua', () => {
  assert.equal(checkCitedPaths('chạy `yarn build` rồi `pp status`', process.cwd(), 'x.md').ok, true)
})
