import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, stageOrder } from '../lib/config.js'

const DIR = new URL('./fixtures/minimal/', import.meta.url).pathname

test('đọc được config tối thiểu', () => {
  const c = readConfig(DIR)
  assert.equal(c.feature, 'demo')
  assert.equal(c.stages['10-prd'].enabled, true)
  assert.deepEqual(c.stages['10-prd'].skills, ['prd-epic'])
})

test('hậu tố ? đánh dấu input optional', () => {
  const c = readConfig(DIR)
  assert.deepEqual(c.stages['40-testplan'].inputs, [
    { path: '10-prd.md', optional: false },
    { path: '30-contract.md', optional: true },
  ])
})

test('stage thiếu field bắt buộc thì ném lỗi nêu rõ tên stage', () => {
  assert.throws(
    () => readConfig(new URL('./fixtures/broken/', import.meta.url).pathname),
    /50-security.*outputs/s,
  )
})

test('stageOrder sắp xếp theo tiền tố số', () => {
  assert.deepEqual(stageOrder(readConfig(DIR)), ['10-prd', '40-testplan'])
})

test('outputs null ném lỗi validation', () => {
  assert.throws(
    () => readConfig(new URL('./fixtures/broken-null-outputs/', import.meta.url).pathname),
    /20-test.*outputs/s,
  )
})

test('inputs string instead of array ném lỗi validation', () => {
  assert.throws(
    () => readConfig(new URL('./fixtures/broken-string-inputs/', import.meta.url).pathname),
    /30-test.*inputs/s,
  )
})

test('stageOrder sắp xếp số khi điều kiện string sort khác', () => {
  const config = {
    feature: 'test',
    size: 'S',
    stages: {
      '10-b': { id: '10-b', enabled: true, skills: [], inputs: [], outputs: [], gate: [], human: false },
      '5-a': { id: '5-a', enabled: true, skills: [], inputs: [], outputs: [], gate: [], human: false },
      '40-c': { id: '40-c', enabled: true, skills: [], inputs: [], outputs: [], gate: [], human: false },
    },
  }
  assert.deepEqual(stageOrder(config), ['5-a', '10-b', '40-c'])
})
