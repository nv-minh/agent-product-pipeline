import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, cpSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig } from '../lib/config.js'
import { readState, writeState } from '../lib/state.js'
import { runT1, stageDone, requiredTiers } from '../lib/gate.js'

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
  assert.match(readFileSync(join(d, '.evidence/10-prd.t1.log'), 'utf8'), /Exit status: 1/)
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

// FINDING 1: In-memory state reuse should advance attempts
test('FINDING 1: in-memory state reuse nên tăng attempts mỗi lần', () => {
  const d = feature('TBD\n')
  const config = readConfig(d)
  const failing = [{ name: 'x', run: () => ({ name: 'x', ok: false, messages: ['fail'] }) }]
  const inmemState = readState(d) // Capture once
  runT1(d, config, inmemState, '10-prd', failing)
  inmemState.stages = readState(d).stages // Sync back
  runT1(d, config, inmemState, '10-prd', failing)
  inmemState.stages = readState(d).stages
  runT1(d, config, inmemState, '10-prd', failing)
  // Without fix: attempts stays 1; with fix: attempts = 3
  assert.equal(readState(d).stages['10-prd'].attempts, 3)
})

// FINDING 3: Throwing check should be caught and recorded
test('FINDING 3: nếu check throw thì ghi lại và tiếp tục', () => {
  const d = feature('content\n')
  const r = runT1(d, readConfig(d), readState(d), '10-prd', [
    { name: 'thrower', run: () => { throw new Error('boom') } },
    { name: 'ok', run: () => ({ name: 'ok', ok: true, messages: [] }) },
  ])
  assert.equal(r.ok, false) // Run failed because one check threw
  const log = readFileSync(join(d, '.evidence/10-prd.t1.log'), 'utf8')
  assert.match(log, /boom/)
})

// FINDING 4: Missing artifact should be recorded as artifact-exists check
test('FINDING 4: tập tin hiệu ứng thiếu thì ghi lại thất bại', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-gate-'))
  cpSync(new URL('./fixtures/minimal/pipeline.json', import.meta.url).pathname, join(d, 'pipeline.json'))
  writeFileSync(join(d, '00-brief.md'), 'brief\n')
  // Note: 10-prd.md NOT created
  const r = runT1(d, readConfig(d), readState(d), '10-prd', [])
  assert.equal(r.ok, false)
  const s = readState(d)
  assert.equal(s.stages['10-prd'].status, 'failed')
  const log = readFileSync(join(d, '.evidence/10-prd.t1.log'), 'utf8')
  assert.match(log, /artifact-exists/)
  assert.match(log, /10-prd\.md/)
})

// FINDING 6: human field should be cleared on re-gate
test('FINDING 6: human trường nên bị xóa khi chạy lại gate', () => {
  const d = feature('content\n')
  const config = readConfig(d)
  const state = readState(d)
  // Manually set human: 'approved' in the stage
  state.stages = state.stages || {}
  state.stages['10-prd'] = state.stages['10-prd'] || {}
  state.stages['10-prd'].human = 'approved'
  writeState(d, state)

  const r = runT1(d, config, state, '10-prd', [
    { name: 'check', run: () => ({ name: 'check', ok: true, messages: [] }) },
  ])
  const s = readState(d)
  // human field should be cleared/absent
  assert.equal(s.stages['10-prd'].human, undefined)
})

// FINDING 6b: human field cleared on fail path too
test('FINDING 6b: human trường bị xóa ngay cả khi gate đỏ', () => {
  const d = feature('content\n')
  const config = readConfig(d)
  const state = readState(d)
  state.stages = state.stages || {}
  state.stages['10-prd'] = state.stages['10-prd'] || {}
  state.stages['10-prd'].human = 'approved'
  writeState(d, state)

  const r = runT1(d, config, state, '10-prd', [
    { name: 'check', run: () => ({ name: 'check', ok: false, messages: ['failed'] }) },
  ])
  const s = readState(d)
  assert.equal(s.stages['10-prd'].human, undefined)
})

// REVIEW FINDING 1 (task-11 review): an unknown stage id must throw a clear,
// stage-naming Error instead of letting `stage.outputs` (stage === undefined)
// throw an unguarded TypeError. This is the precondition every caller of
// runT1 — gateCmd today, later tasks tomorrow — relies on.
test('REVIEW FINDING 1: stage id không tồn tại thì throw Error nêu tên stage', () => {
  const d = feature('content\n')
  const config = readConfig(d)
  assert.throws(
    () => runT1(d, config, readState(d), '99-nope', []),
    /99-nope/,
  )
})

// ─── Hàm quyết định dùng chung (FIX review cuối, finding 1+3+4) ───

test('stageDone: tier chưa có kết quả thì stage chưa xong và nêu tên tier', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  config.stages['10-prd'].gate = ['t1', 't2']
  const v = stageDone(d, config, readState(d), '10-prd')
  assert.equal(v.done, false)
  assert.deepEqual(v.outstanding, ['t1', 't2'])
})

test('stageDone: T1 pass mà T2 chưa chạy thì vẫn chưa xong', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  config.stages['10-prd'].gate = ['t1', 't2']
  runT1(d, config, readState(d), '10-prd', [{ name: 'x', run: () => ({ name: 'x', ok: true, messages: [] }) }])
  const v = stageDone(d, config, readState(d), '10-prd')
  assert.equal(v.done, false)
  assert.deepEqual(v.outstanding, ['t2'])
  assert.notEqual(readState(d).stages['10-prd'].status, 'done')
})

// Điều 2 — hoàn thành đọc từ đĩa, không từ cờ trong state.
test('stageDone: state ghi pass nhưng log evidence có exit khác 0 thì KHÔNG xong', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  runT1(d, config, readState(d), '10-prd', [{ name: 'x', run: () => ({ name: 'x', ok: true, messages: [] }) }])
  assert.equal(readState(d).stages['10-prd'].status, 'done')
  assert.equal(stageDone(d, config, readState(d), '10-prd').done, true)

  appendFileSync(join(d, '.evidence/10-prd.t1.log'), 'Exit status: 1\n')
  const v = stageDone(d, config, readState(d), '10-prd')
  assert.equal(v.done, false)
  assert.deepEqual(v.outstanding, ['t1'])
})

test('stageDone: state khai pass nhưng KHÔNG có file evidence thì không xong', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  const st = readState(d)
  st.stages = { '10-prd': { status: 'done', tiers: { t1: { result: 'pass' } } } }
  writeState(d, st)
  assert.equal(stageDone(d, config, readState(d), '10-prd').done, false)
})

// `gate: []` không được là cửa hậu tới done mà không cần exit code nào.
test('requiredTiers: gate rỗng vẫn bắt buộc t1', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  config.stages['10-prd'].gate = []
  assert.deepEqual(requiredTiers(config, '10-prd'), ['t1'])
  assert.equal(stageDone(d, config, readState(d), '10-prd').done, false)
})

// ─── FIX review cuối (finding 7): attempts là bộ đếm RETRY, không phải bộ ──
// đếm số lần chạy. Quan sát trong review: T1 pass = attempt 1, T2 pass = 2,
// một lần re-gate = 3, rồi lần đỏ THẬT đầu tiên bị blocked ngay với 0 lượt
// sửa; một lần pass sạch in "attempt 3/3".

test('gate XANH không tiêu ngân sách retry — attempts vẫn 0', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  config.stages['10-prd'].gate = ['t1', 't2'] // chưa done sau T1 → thấy rõ attempts
  runT1(d, config, readState(d), '10-prd', [{ name: 'x', run: () => ({ name: 'x', ok: true, messages: [] }) }])
  const st = readState(d).stages['10-prd']
  assert.equal(st.attempts, 0)
  assert.equal(st.tiers.t1.attempts, 0)
})

test('chỉ lần ĐỎ mới tăng attempts, và pass sạch in "attempt 1/3"', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  const pass = [{ name: 'x', run: () => ({ name: 'x', ok: true, messages: [] }) }]
  const fail = [{ name: 'x', run: () => ({ name: 'x', ok: false, messages: ['đỏ'] }) }]

  const r1 = runT1(d, config, readState(d), '10-prd', pass)
  assert.match(readFileSync(join(d, r1.evidencePath), 'utf8'), /attempt 1\/3/)

  runT1(d, config, readState(d), '10-prd', fail)
  assert.equal(readState(d).stages['10-prd'].attempts, 1)
  runT1(d, config, readState(d), '10-prd', fail)
  assert.equal(readState(d).stages['10-prd'].attempts, 2)

  // lần thứ 3 là lần thử thứ 3 (2 lần đỏ trước) và nó XANH
  const r3 = runT1(d, config, readState(d), '10-prd', pass)
  assert.match(readFileSync(join(d, r3.evidencePath), 'utf8'), /attempt 3\/3/)
  // stage done → ngân sách trả về đầy, nhưng lịch sử tier còn nguyên
  const st = readState(d).stages['10-prd']
  assert.equal(st.status, 'done')
  assert.equal(st.attempts, 0)
  assert.equal(st.tiers.t1.attempts, 2)
})

// ─── FIX review cuối (finding 6b): stage bị tắt phải để lại dấu vết ──────
test('stage enabled=false được ghi {status: skipped, reason: disabled}', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  config.stages['40-testplan'].enabled = false
  runT1(d, config, readState(d), '10-prd', [{ name: 'x', run: () => ({ name: 'x', ok: true, messages: [] }) }])
  const st = readState(d).stages['40-testplan']
  assert.equal(st.status, 'skipped')
  assert.equal(st.reason, 'disabled')
})

test('stage đã chạy rồi mới bị tắt thì KHÔNG bị ghi đè thành skipped', () => {
  const d = feature('nội dung\n')
  const config = readConfig(d)
  const pass = [{ name: 'x', run: () => ({ name: 'x', ok: true, messages: [] }) }]
  writeFileSync(join(d, '40-testplan.md'), 'plan\n')
  runT1(d, config, readState(d), '40-testplan', pass)
  config.stages['40-testplan'].enabled = false
  runT1(d, config, readState(d), '10-prd', pass)
  assert.equal(readState(d).stages['40-testplan'].status, 'done')
})
