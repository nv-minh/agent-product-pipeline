import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../lib/config.js'
import { readState } from '../lib/state.js'
import { runT1 } from '../lib/gate.js'

function feature(prdText) {
  const d = mkdtempSync(join(tmpdir(), 'pp-gate-'))
  cpSync(new URL('./fixtures/minimal/pipeline.json', import.meta.url).pathname, join(d, 'pipeline.json'))
  writeFileSync(join(d, '00-brief.md'), 'brief\n')
  writeFileSync(join(d, '10-prd.md'), prdText)
  return d
}

test('gate đỏ thì state = failed, attempts tăng, evidence có exit khác 0', () => {
  const d = feature('## User stories\nnội dung TBD\n')
  const r = runT1(d, readConfig(d), readState(d), '10-prd', [
    { name: 'placeholders', run: (t) => ({ name: 'placeholders', ok: !t.includes('TBD'), messages: ['có TBD'] }) },
  ])
  assert.equal(r.ok, false)
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'failed')
  assert.equal(s.stages['10-prd'].attempts, 1)
  assert.match(readFileSync(join(d, '.evidence/10-prd.log'), 'utf8'), /Exit status: 1/)
})

test('gate xanh thì state = done và lưu inputs_hash', () => {
  const d = feature('## User stories\nnội dung đầy đủ\n')
  const r = runT1(d, readConfig(d), readState(d), '10-prd', [
    { name: 'placeholders', run: () => ({ name: 'placeholders', ok: true, messages: [] }) },
  ])
  assert.equal(r.ok, true)
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'done')
  assert.equal(typeof s.stages['10-prd'].inputs_hash, 'string')
})

test('đỏ lần thứ 3 thì chuyển blocked', () => {
  const d = feature('TBD\n')
  const failing = [{ name: 'x', run: () => ({ name: 'x', ok: false, messages: ['hỏng'] }) }]
  for (let i = 0; i < 3; i++) runT1(d, readConfig(d), readState(d), '10-prd', failing)
  assert.equal(readState(d).stages['10-prd'].status, 'blocked')
})
