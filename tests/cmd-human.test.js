import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readState, writeState, isStale } from '../lib/state.js'
import { readConfig } from '../lib/config.js'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname

function run(args, opts = {}) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8', ...opts }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-h-'))
  writeFileSync(join(d, 'constitution.md'), '# c\n')
  mkdirSync(join(d, 'lessons'), { recursive: true })
  cpSync(join(REPO, 'templates'), join(d, 'templates'), { recursive: true })
  run(['init', 'demo', '--size', 'S', '--root', d])
  return d
}

// --- pp approve --------------------------------------------------------

test('approve bị từ chối khi gate chưa pass', () => {
  const r0 = root()
  const r = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /gate/)
})

test('approve thành công khi gate pass', () => {
  const r0 = root()
  const dir = join(r0, 'features/demo')
  const s = readState(dir); s.stages = { '10-prd': { status: 'done', gate: 'pass' } }; writeState(dir, s)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(readState(dir).stages['10-prd'].human, 'approved')
})

test('approve: stage lạ báo rõ tên stage và liệt kê stage thật, exit 2', () => {
  const r0 = root()
  const r = run(['approve', 'demo', '99-nope', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"99-nope"/)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /40-testplan/)
})

test('approve: không có root thì exit 2, không throw', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-h-noroot-'))
  const r = run(['approve', 'demo', '10-prd'], { cwd: noRoot })
  assert.equal(r.code, 2)
  assert.match(r.out, /không tìm thấy gốc repo/)
})

// --- pp override ---------------------------------------------------------

test('override không có --reason thì exit 2', () => {
  const r0 = root()
  assert.equal(run(['override', 'demo', '10-prd', '--root', r0]).code, 2)
})

// CORRECTION so với brief: `--reason` đứng cuối dòng lệnh (không có giá trị
// theo sau) parseArgs trả `flags.reason = true` (boolean), không phải chuỗi
// rỗng. Phải bị từ chối giống hệt trường hợp thiếu hẳn --reason, không được
// để `true.trim()` ném TypeError ra ngoài.
test('override --reason không có giá trị (flag cuối dòng) thì exit 2, không throw', () => {
  const r0 = root()
  const r = run(['override', 'demo', '10-prd', '--reason', '--root', r0])
  assert.equal(r.code, 2)
  assert.doesNotMatch(r.out, /TypeError/)
})

test('override --reason chỉ toàn khoảng trắng thì exit 2', () => {
  const r0 = root()
  const r = run(['override', 'demo', '10-prd', '--reason', '   ', '--root', r0])
  assert.equal(r.code, 2)
})

test('override có lý do thì đánh dấu overridden và ghi lessons', () => {
  const r0 = root()
  const r = run(['override', 'demo', '10-prd', '--reason', 'gate nhận nhầm định dạng bảng', '--root', r0])
  assert.equal(r.code, 0)
  const st = readState(join(r0, 'features/demo')).stages['10-prd']
  assert.equal(st.overridden, true)
  assert.equal(st.status, 'done')
  assert.ok(existsSync(join(r0, 'lessons/10-prd.md')))
  assert.match(readFileSync(join(r0, 'lessons/10-prd.md'), 'utf8'), /nhận nhầm định dạng bảng/)
})

// CARRY-FORWARD 1: `overridden: true` là thứ DUY NHẤT ngăn `isStale` coi một
// stage `done` không có `inputs_hash` là stale mãi mãi (vòng lặp vô hạn).
// Test này khẳng định trực tiếp tính chất "load-bearing" đó, không chỉ đọc
// lại cờ trong STATE.md.
test('CARRY-FORWARD: override khiến isStale trả về false dù không có inputs_hash', () => {
  const r0 = root()
  run(['override', 'demo', '10-prd', '--reason', 'x', '--root', r0])
  const dir = join(r0, 'features/demo')
  const state = readState(dir)
  const config = readConfig(dir)
  assert.equal(state.stages['10-prd'].inputs_hash, undefined)
  assert.equal(isStale(dir, config, state, '10-prd'), false)
})

test('override: đường dẫn value trùng feature vẫn được nhận diện đúng theo VỊ TRÍ, không theo GIÁ TRỊ', () => {
  // `root()` luôn init feature tên "demo" — dùng đúng chữ đó làm --reason để
  // tái hiện chính xác kịch bản mà brief.md nêu ra: "--reason text happens to
  // equal the feature name". parseArgs (dựa vào vị trí token) không được nhầm
  // giá trị --reason này với positional[0] (feature).
  const r0 = root()
  const r = run(['override', 'demo', '10-prd', '--reason', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  const st = readState(join(r0, 'features/demo')).stages['10-prd']
  assert.equal(st.overridden, true)
  assert.equal(st.reason, 'demo')
  assert.match(readFileSync(join(r0, 'lessons/10-prd.md'), 'utf8'), /override \(demo\): demo/)
})

test('override: stage lạ báo rõ tên stage và liệt kê stage thật, exit 2', () => {
  const r0 = root()
  const r = run(['override', 'demo', '99-nope', '--reason', 'x', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"99-nope"/)
  assert.match(r.out, /10-prd/)
})

test('override: không có root thì exit 2, không throw', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-h-noroot-'))
  const r = run(['override', 'demo', '10-prd', '--reason', 'x'], { cwd: noRoot })
  assert.equal(r.code, 2)
  assert.match(r.out, /không tìm thấy gốc repo/)
})

// --- pp unblock ------------------------------------------------------------

test('unblock không có --reason thì exit 2', () => {
  const r0 = root()
  assert.equal(run(['unblock', 'demo', '10-prd', '--root', r0]).code, 2)
})

test('unblock --reason không có giá trị thì exit 2, không throw', () => {
  const r0 = root()
  const r = run(['unblock', 'demo', '10-prd', '--reason', '--root', r0])
  assert.equal(r.code, 2)
  assert.doesNotMatch(r.out, /TypeError/)
})

test('unblock có lý do thì reset attempts/status và ghi lessons', () => {
  const r0 = root()
  const dir = join(r0, 'features/demo')
  const s = readState(dir)
  s.stages = { '10-prd': { status: 'blocked', attempts: 3, gate: 'fail' } }
  writeState(dir, s)

  const r = run(['unblock', 'demo', '10-prd', '--reason', 'gate cũ nhận nhầm', '--root', r0])
  assert.equal(r.code, 0)
  const st = readState(dir).stages['10-prd']
  assert.equal(st.status, 'pending')
  assert.equal(st.attempts, 0)
  assert.ok(existsSync(join(r0, 'lessons/10-prd.md')))
  assert.match(readFileSync(join(r0, 'lessons/10-prd.md'), 'utf8'), /gate cũ nhận nhầm/)
})

test('unblock: stage lạ báo rõ tên stage và liệt kê stage thật, exit 2', () => {
  const r0 = root()
  const r = run(['unblock', 'demo', '99-nope', '--reason', 'x', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"99-nope"/)
  assert.match(r.out, /10-prd/)
})

test('unblock: không có root thì exit 2, không throw', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-h-noroot-'))
  const r = run(['unblock', 'demo', '10-prd', '--reason', 'x'], { cwd: noRoot })
  assert.equal(r.code, 2)
  assert.match(r.out, /không tìm thấy gốc repo/)
})

// --- merge lên state tươi (không phải bản chụp cũ) -------------------------

test('approve/override/unblock merge lên state MỚI đọc từ đĩa, không đè mất stage khác', () => {
  const r0 = root()
  const dir = join(r0, 'features/demo')
  const s = readState(dir)
  s.stages = {
    '10-prd': { status: 'done', gate: 'pass' },
    '40-testplan': { status: 'blocked', attempts: 3, gate: 'fail' },
  }
  writeState(dir, s)

  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(run(['unblock', 'demo', '40-testplan', '--reason', 'x', '--root', r0]).code, 0)

  const after = readState(dir).stages
  assert.equal(after['10-prd'].human, 'approved')
  assert.equal(after['10-prd'].gate, 'pass') // giữ nguyên field khác của stage này
  assert.equal(after['40-testplan'].status, 'pending')
  assert.equal(after['40-testplan'].attempts, 0)
})

// --- pp report ---------------------------------------------------------

test('report in số lần override', () => {
  const r0 = root()
  run(['override', 'demo', '10-prd', '--reason', 'x', '--root', r0])
  const r = run(['report', 'demo', '--root', r0])
  assert.match(r.out, /override/i)
})

test('report không tham số thì in mọi feature', () => {
  const r0 = root()
  run(['init', 'second', '--size', 'S', '--root', r0])
  const r = run(['report', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /demo/)
  assert.match(r.out, /second/)
})

test('report bỏ qua _archive', () => {
  const r0 = root()
  mkdirSync(join(r0, 'features/_archive/some-old-feature'), { recursive: true })
  const r = run(['report', '--root', r0])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /some-old-feature/)
})

test('report không crash khi STATE.md của một feature bị hỏng, feature còn lại vẫn hiện', () => {
  const r0 = root()
  run(['init', 'second', '--size', 'S', '--root', r0])
  // Hỏng STATE.md của "demo": xoá khối đánh dấu <!-- pp:state ... --> mà
  // readState() cần — mô phỏng file bị sửa tay.
  writeFileSync(join(r0, 'features/demo/STATE.md'), '# STATE hỏng, không có khối pp:state\n')
  const r = run(['report', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /second/)
  assert.doesNotMatch(r.out, /at \S+ \(.*:\d+:\d+\)/)
})

test('report với feature cụ thể chỉ in feature đó', () => {
  const r0 = root()
  run(['init', 'second', '--size', 'S', '--root', r0])
  const r = run(['report', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /demo/)
  assert.doesNotMatch(r.out, /second/)
})

// CARRY-FORWARD: một gate bị override ≥3 lần nghĩa là gate đó sai — pp report
// phải nêu bật điều này (constitution.md điều khoản override).
test('report cảnh báo khi một stage bị override từ 3 lần trở lên', () => {
  const r0 = root()
  run(['override', 'demo', '10-prd', '--reason', 'lần 1', '--root', r0])
  run(['override', 'demo', '10-prd', '--reason', 'lần 2', '--root', r0])
  run(['override', 'demo', '10-prd', '--reason', 'lần 3', '--root', r0])
  const r = run(['report', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /3/)
  const dir = join(r0, 'features/demo')
  assert.equal(readState(dir).stages['10-prd'].override_count, 3)
})

test('report: chưa có feature nào thì không crash', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-h-empty-'))
  writeFileSync(join(d, 'constitution.md'), '# c\n')
  const r = run(['report', '--root', d])
  assert.equal(r.code, 0)
})

test('report: không có root thì exit 2, không throw', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-h-noroot-'))
  const r = run(['report'], { cwd: noRoot })
  assert.equal(r.code, 2)
  assert.match(r.out, /không tìm thấy gốc repo/)
})
