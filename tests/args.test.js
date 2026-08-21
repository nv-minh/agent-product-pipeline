import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../lib/args.js'

test('positional trước flag', () => {
  const { positional, flags } = parseArgs(['demo', '--size', 'S', '--root', '/tmp/x'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { size: 'S', root: '/tmp/x' })
})

test('flag đứng trước positional vẫn không bị nhặt nhầm', () => {
  const { positional, flags } = parseArgs(['--size', 'S', 'demo', '--root', '/tmp/x'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { size: 'S', root: '/tmp/x' })
})

test('flag xen giữa hai positional', () => {
  const { positional, flags } = parseArgs(['--root', '/tmp/x', 'demo'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { root: '/tmp/x' })
})

test('flag ở cuối, không có giá trị theo sau → true', () => {
  const { positional, flags } = parseArgs(['demo', '--root'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { root: true })
})

test('flag theo ngay sau bởi flag khác → true (không nuốt flag kế làm giá trị)', () => {
  const { positional, flags } = parseArgs(['demo', '--root', '--size', 'S'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { root: true, size: 'S' })
})

test('không có flag nào, toàn positional', () => {
  const { positional, flags } = parseArgs(['a', 'b', 'c'])
  assert.deepEqual(positional, ['a', 'b', 'c'])
  assert.deepEqual(flags, {})
})

// FINDING (adversarial review 8c825c9..44c1ecb): parser chỉ hiểu `--k v`, nên
// `--k=v` — dạng GNU phổ biến nhất — tạo key "k=v" và để `flags.k` undefined.
// Hậu quả không phải "flag bị bỏ qua" mà là ĐOÁN THAY người dùng bằng default:
// `--type=bugfix` chạy pipeline feature, `--from=x` mất liên kết, `--tier=t2`
// chạy T1, `--root=/khác` ghi vào repo khác — tất cả exit 0, không một dòng
// cảnh báo. Đúng lớp lỗi mà gate.js:19-27 (B4) và init.js:47-49 tuyên bố chặn.
test('--key=value được tách đúng như --key value', () => {
  const { positional, flags } = parseArgs(['demo', '--type=bugfix', '--root=/tmp/x'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { type: 'bugfix', root: '/tmp/x' })
})

test('--key= (giá trị rỗng tường minh) trả chuỗi rỗng, KHÔNG phải true', () => {
  // Phải là '' để init.js phân biệt được "người dùng gõ rỗng" (exit 2) với
  // "không gõ flag" (default) — `true` sẽ trộn lẫn nó vào ca bare --key.
  const { flags } = parseArgs(['demo', '--from='])
  assert.equal(flags.from, '')
})

test('--key=a=b chỉ tách ở dấu = ĐẦU TIÊN', () => {
  const { flags } = parseArgs(['--reason=vì a=b nên thế'])
  assert.equal(flags.reason, 'vì a=b nên thế')
})

test('--key=value trộn với --key value trên cùng dòng lệnh', () => {
  const { positional, flags } = parseArgs(['demo', '--type=change', '--from', 'old-a'])
  assert.deepEqual(positional, ['demo'])
  assert.deepEqual(flags, { type: 'change', from: 'old-a' })
})
