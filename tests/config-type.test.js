// Task 1 (pp-bugfix/pp-change): readConfig phải trả các field mới với default
// đúng — template cũ (không có type/schema/reads_workspace) giữ nguyên hành vi.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../lib/config.js'

function dirWith(json) {
  const d = mkdtempSync(join(tmpdir(), 'pp-cfg-'))
  writeFileSync(join(d, 'pipeline.json'), JSON.stringify(json))
  return d
}

const STAGE = { enabled: true, inputs: ['00-brief.md'], outputs: ['x.md'], gate: ['t1'] }

test('pipeline.json không có type/from → type mặc định "feature", from undefined', () => {
  const c = readConfig(dirWith({ feature: 'demo', stages: { '10-prd': STAGE } }))
  assert.equal(c.type, 'feature')
  assert.equal(c.from, undefined)
})

test('type/from trong pipeline.json đi ra nguyên vẹn', () => {
  const c = readConfig(dirWith({ feature: 'demo', type: 'change', from: 'old-widget', stages: { '05-impact': STAGE } }))
  assert.equal(c.type, 'change')
  assert.equal(c.from, 'old-widget')
})

test('stage không khai schema/reads_workspace → schema undefined, readsWorkspace false', () => {
  const c = readConfig(dirWith({ feature: 'demo', stages: { '10-prd': STAGE } }))
  assert.equal(c.stages['10-prd'].schema, undefined)
  assert.equal(c.stages['10-prd'].readsWorkspace, false)
})

test('stage khai schema + reads_workspace → đọc được qua config', () => {
  const c = readConfig(dirWith({
    feature: 'demo',
    stages: { '10-prd': { ...STAGE, schema: '10-prd.change', reads_workspace: true } },
  }))
  assert.equal(c.stages['10-prd'].schema, '10-prd.change')
  assert.equal(c.stages['10-prd'].readsWorkspace, true)
})
