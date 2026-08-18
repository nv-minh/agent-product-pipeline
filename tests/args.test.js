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
