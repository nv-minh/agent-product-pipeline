// BOOTSTRAP FINDING — `updated` TRONG STATE.md TỪNG ĐÓNG BĂNG Ở LẦN GHI ĐẦU.
//
// `writeState` cũ viết `state.updated ?? new Date()`. `readState` trả nguyên
// `updated` cũ, nên mọi lần ghi sau đều thấy trường đã có và giữ lại giá trị của
// `pp init`. Quan sát trên feature `archive-command`: STATE.md ghi 08:12:06 (lúc
// init) trong khi lần ghi thật cuối là 08:23:14. Trường duy nhất trả lời "file
// này được ghi lúc nào" lại là trường nói sai.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, writeState } from '../lib/state.js'

function headerUpdated(dir) {
  return readFileSync(join(dir, 'STATE.md'), 'utf8').match(/updated: (\S+)/)[1]
}

test('mỗi lần writeState phải làm mới `updated`, không giữ lại giá trị cũ', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-upd-'))
  writeState(dir, { feature: 'demo', current: null, stages: {} })
  const first = readState(dir).updated
  assert.ok(first, '`updated` phải được ghi')

  // Đọc rồi ghi lại y nguyên — đúng vòng read-modify-write mà recordTierRun dùng.
  await new Promise((r) => setTimeout(r, 5))
  const roundTripped = readState(dir)
  writeState(dir, roundTripped)
  const second = readState(dir).updated

  assert.notEqual(second, first, '`updated` không được giữ nguyên qua một vòng read-modify-write')
  assert.ok(Date.parse(second) > Date.parse(first), `${second} phải sau ${first}`)
})

test('`updated` trong JSON và trong dòng người đọc phải khớp nhau', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-upd-'))
  writeState(dir, { feature: 'demo', current: null, stages: {} })
  assert.equal(headerUpdated(dir), readState(dir).updated)
})

test('`updated` do caller truyền vào cũng bị ghi đè bằng thời điểm ghi thật', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-upd-'))
  const stale = '2020-01-01T00:00:00.000Z'
  writeState(dir, { feature: 'demo', current: null, stages: {}, updated: stale })
  assert.notEqual(readState(dir).updated, stale, 'không được tin `updated` do caller mang tới')
  assert.ok(Date.parse(readState(dir).updated) > Date.parse(stale))
})
