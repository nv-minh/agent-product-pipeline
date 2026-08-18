import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, writeState, hashInputs, isStale } from '../lib/state.js'

function tmpFeature() {
  const d = mkdtempSync(join(tmpdir(), 'pp-'))
  writeFileSync(join(d, '00-brief.md'), 'brief v1\n')
  writeFileSync(join(d, '10-prd.md'), 'prd\n')
  return d
}

test('chưa có STATE.md thì trả state rỗng', () => {
  const d = tmpFeature()
  assert.deepEqual(readState(d).stages, {})
})

test('ghi rồi đọc lại giữ nguyên dữ liệu', () => {
  const d = tmpFeature()
  writeState(d, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'done', attempts: 2 } } })
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'done')
  assert.equal(s.stages['10-prd'].attempts, 2)
})

test('STATE.md có cảnh báo DO NOT EDIT và bảng cho người đọc', () => {
  const d = tmpFeature()
  writeState(d, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'done' } } })
  const txt = readFileSync(join(d, 'STATE.md'), 'utf8')
  assert.match(txt, /DO NOT EDIT/)
  assert.match(txt, /\| 10-prd \|/)
})

test('hashInputs đổi khi nội dung input đổi', () => {
  const d = tmpFeature()
  const inputs = [{ path: '00-brief.md', optional: false }]
  const h1 = hashInputs(d, inputs)
  writeFileSync(join(d, '00-brief.md'), 'brief v2\n')
  assert.notEqual(h1, hashInputs(d, inputs))
})

test('input optional vắng mặt không làm hỏng hash', () => {
  const d = tmpFeature()
  const withOptional = hashInputs(d, [
    { path: '00-brief.md', optional: false },
    { path: 'khong-co.md', optional: true }
  ])
  const withoutOptional = hashInputs(d, [
    { path: '00-brief.md', optional: false }
  ])
  assert.equal(withOptional, withoutOptional)
})

test('input bắt buộc vắng mặt thì ném lỗi', () => {
  const d = tmpFeature()
  assert.throws(() => hashInputs(d, [{ path: 'thieu.md', optional: false }]), /thieu\.md/)
})

test('isStale = true khi input đổi sau khi stage đã done', () => {
  const d = tmpFeature()
  const config = { stages: { '40-testplan': { id: '40-testplan', inputs: [{ path: '10-prd.md', optional: false }] } } }
  const state = { stages: { '40-testplan': { status: 'done', inputs_hash: hashInputs(d, config.stages['40-testplan'].inputs) } } }
  assert.equal(isStale(d, config, state, '40-testplan'), false)
  writeFileSync(join(d, '10-prd.md'), 'prd đã sửa\n')
  assert.equal(isStale(d, config, state, '40-testplan'), true)
})

test('reason với --> không làm hỏng round-trip', () => {
  const d = tmpFeature()
  const original = {
    feature: 'test',
    stages: {
      '10-prd': {
        status: 'done',
        reason: 'already done --> skip'
      }
    }
  }
  writeState(d, original)
  const loaded = readState(d)
  assert.equal(loaded.stages['10-prd'].reason, 'already done --> skip')
})

test('isStale = true khi done mà không có inputs_hash và chưa overridden', () => {
  const d = tmpFeature()
  const config = { stages: { '40-testplan': { inputs: [] } } }
  const state = { stages: { '40-testplan': { status: 'done' } } }
  assert.equal(isStale(d, config, state, '40-testplan'), true)
})

test('isStale = false khi overridden dù không có inputs_hash', () => {
  const d = tmpFeature()
  const config = { stages: { '40-testplan': { inputs: [] } } }
  const state = { stages: { '40-testplan': { status: 'done', overridden: true } } }
  assert.equal(isStale(d, config, state, '40-testplan'), false)
})

test('round-trip với toàn bộ StageState fields và unknown keys', () => {
  const d = tmpFeature()
  const original = {
    feature: 'demo',
    current: '20-design',
    stages: {
      '10-prd': {
        status: 'done',
        attempts: 3,
        gate: 'approval_pending',
        human: 'alice@example.com',
        inputs_hash: 'abc123',
        evidence: 'https://example.com/evidence',
        overridden: true,
        reason: 'approved by CEO',
        custom_field: 'custom_value'
      }
    }
  }
  writeState(d, original)
  const loaded = readState(d)
  assert.deepEqual(loaded.stages['10-prd'], original.stages['10-prd'])
})
