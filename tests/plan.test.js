// tests/plan.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
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

// R4: `done` không còn là một cờ được tin — mỗi lần đọc, `nextStage` hỏi lại
// `stageDone`, và `stageDone` đọc `.evidence/` trên đĩa. Nên một stage "đã
// xong" trong test phải mang đúng dấu vết mà một lần gate xanh để lại.
// (Các stage trong config trên KHÔNG khai báo `outputs` — không có artifact
// nào để chứng nhận nên cũng không có `artifact_hash`; luật hash artifact
// được kiểm riêng ở tests/gate.test.js.)
function doneStage(d, stageId, extra = {}) {
  mkdirSync(join(d, '.evidence'), { recursive: true })
  writeFileSync(
    join(d, '.evidence', `${stageId}.t1.log`),
    '$ pp-check x\nExit status: 0\nRESULT: PASS (t1) — attempt 1/3\n',
  )
  return { status: 'done', gate: 'pass', tiers: { t1: { result: 'pass' } }, ...extra }
}

test('state rỗng thì chạy stage bật đầu tiên', () => {
  const { d, config } = setup()
  const r = nextStage(d, config, { stages: {} })
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'run')
})

test('bỏ qua stage đã tắt', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': doneStage(d, '10-prd', { human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) }) } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '40-testplan')
})

test('stage cần người duyệt mà gate đã xanh thì chờ người', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': doneStage(d, '10-prd', { inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) }) } }
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
      '10-prd': doneStage(d, '10-prd', { human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) }),
      '40-testplan': doneStage(d, '40-testplan', { inputs_hash: 'cu-roi' }),
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
      '10-prd': doneStage(d, '10-prd', { human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) }),
      '40-testplan': doneStage(d, '40-testplan', { inputs_hash: hashInputs(d, config.stages['40-testplan'].inputs) }),
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, null)
  assert.equal(r.action, 'complete')
})

test('status failed với attempts >= MAX_ATTEMPTS thì blocked (enforce cap)', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'failed', attempts: 3 } } }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '10-prd')
  assert.equal(r.action, 'blocked')
  assert.match(r.reason, /3\/3/)
})

test('status failed với attempts < MAX_ATTEMPTS thì retry', () => {
  const { d, config } = setup()
  const state = { stages: { '10-prd': { status: 'failed', attempts: 2 } } }
  const r = nextStage(d, config, state)
  assert.equal(r.action, 'retry')
  assert.match(r.reason, /2\/3/)
})

test('overridden stage không phải regate dù inputs đã thay đổi', () => {
  const { d, config } = setup()
  const state = {
    stages: {
      '10-prd': { status: 'done', human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs), overridden: true },
      '40-testplan': { status: 'done', inputs_hash: 'cu-roi', overridden: true },
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, null)
  assert.equal(r.action, 'complete')
})

test('done stage không có inputs_hash và chưa overridden thì regate', () => {
  const { d, config } = setup()
  const state = {
    stages: {
      '10-prd': doneStage(d, '10-prd', { human: 'approved', inputs_hash: hashInputs(d, config.stages['10-prd'].inputs) }),
      '40-testplan': { status: 'done' },
    },
  }
  const r = nextStage(d, config, state)
  assert.equal(r.stage, '40-testplan')
  assert.equal(r.action, 'regate')
})
