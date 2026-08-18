// tests/plan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextStage } from '../lib/plan.js'
import { hashInputs } from '../lib/state.js'

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'pp-plan-'))
  writeFileSync(join(d, '00-brief.md'), 'brief\n')
  writeFileSync(join(d, '10-prd.md'), 'prd\n')
  const config = {
    stages: {
      '10-prd': { id: '10-prd', enabled: true, human: true, inputs: [{ path: '00-brief.md', optional: false }] },
      '20-ux': { id: '20-ux', enabled: false, human: false, inputs: [] },
      '40-testplan': { id: '40-testplan', enabled: true, human: false, inputs: [{ path: '10-prd.md', optional: false }] },
    },
  }
  return { d, config }
}

test('state rỗng thì chạy stage bật đầu tiên', () => {
  const { d, config } = setup()
  const r = nextStage(d, config, { stages: {} })
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'run')
})

test('bỏ qua stage đã tắt', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '40-testplan')
})

test('stage cần người duyệt mà gate đã xanh thì chờ người', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'done', gate: 'pass', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'await-human')
})

test('status failed thì retry đúng stage đó', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'failed', attempts: 1 } } }
  const r = nextStage(d, config, state)
  assert.equal(r.action, 'retry')
  assert.match(r.reason, /1\/3/)
})

test('status blocked thì dừng, không nhảy sang stage sau', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'blocked', attempts: 3 } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'blocked')
})

test('input thượng nguồn đổi thì stage hạ nguồn phải regate', () => {
  const { d, config } = setup()
  const state = {
    stages: {
      '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) },
      '40-testplan': { status: 'done', inputs_hash: 'cu-roi' },
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '40-testplan')
  assert.equal(r.action, 'regate')
})

test('mọi stage xong thì complete', () => {
  const { d, config } = setup()
  const state = {
    stages: {
      '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) },
      '40-testplan': { status: 'done', inputs_hash: hashInputs(d, config.stages['40-testplan'].inputs) },
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, null)
  assert.equal(r.action, 'complete')
})
