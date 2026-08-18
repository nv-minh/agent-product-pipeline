// tests/cmd-guard.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { writeState } from '../lib/state.js'

const PP = new URL('../bin/pp', import.meta.url).pathname

function run(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8', ...opts }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'pp-guard-root-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\n')
  return d
}

// --- guard-write ---

test('chặn ghi STATE.md trong features/', () => {
  const r = run(['guard-write', '--path', '/x/features/demo/STATE.md'])
  assert.equal(r.code, 1)
  assert.match(r.out, /STATE\.md/)
})

test('chặn ghi trong .evidence/ của features/', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/.evidence/10-prd.log']).code, 1)
})

test('cho phép ghi artifact bình thường trong features/', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/10-prd.md']).code, 0)
})

// CORRECTION so với brief: chặn theo pattern "/STATE.md$" hoặc "/.evidence/"
// bất kỳ đâu trên máy là quá rộng — một project không liên quan có file
// STATE.md riêng của họ sẽ bị chặn oan. Chỉ chặn khi path nằm trong một
// feature dir của chính pipeline này (có segment /features/ rồi mới tới
// STATE.md hoặc .evidence/).
test('cho phép ghi STATE.md ở ngoài mọi feature dir (không thuộc pipeline)', () => {
  const r = run(['guard-write', '--path', '/x/some-other-project/STATE.md'])
  assert.equal(r.code, 0)
})

test('cho phép ghi .evidence/ ở ngoài mọi feature dir (không thuộc pipeline)', () => {
  const r = run(['guard-write', '--path', '/x/some-other-project/.evidence/log.txt'])
  assert.equal(r.code, 0)
})

// FIX review Task 12 (finding 1, CRITICAL): máy này dùng APFS mặc định
// case-insensitive — state.md, STATE.MD và STATE.md là CÙNG một file trên
// đĩa. Regex chặn phải case-insensitive (segment features/, tên file
// STATE.md, và segment .evidence/), nếu không viết chữ thường/hoa khác đi
// là một đường vòng để agent ghi đè STATE.md thật.
test('chặn ghi state.md (chữ thường) trong features/ — APFS case-insensitive', () => {
  const r = run(['guard-write', '--path', '/x/features/demo/state.md'])
  assert.equal(r.code, 1)
  assert.match(r.out, /STATE\.md/)
})

test('chặn ghi STATE.MD (đuôi hoa) trong features/', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/STATE.MD']).code, 1)
})

test('chặn ghi STATE.md khi segment "Features/" viết hoa chữ đầu', () => {
  assert.equal(run(['guard-write', '--path', '/x/Features/demo/STATE.md']).code, 1)
})

test('chặn ghi trong .EVIDENCE/ viết hoa (case-insensitive)', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/.EVIDENCE/log.txt']).code, 1)
})

// FIX review Task 12 (finding 3, Important): path tương đối (không có "/"
// đầu) phải resolve theo cwd trước khi so khớp, để nhất quán với path có
// "./" hay path tuyệt đối — không thì bỏ dấu "/" đầu là một đường vòng.
test('chặn ghi STATE.md qua path tương đối (không có "/" đầu), resolve theo cwd', () => {
  const root = tmpRoot()
  const r = run(['guard-write', '--path', 'features/demo/STATE.md'], { cwd: root })
  assert.equal(r.code, 1)
  assert.match(r.out, /STATE\.md/)
})

test('cho phép path tương đối không resolve vào một feature dir', () => {
  const root = tmpRoot()
  const r = run(['guard-write', '--path', 'not-a-feature-dir/STATE.md'], { cwd: root })
  assert.equal(r.code, 0)
})

// FIX review Task 12 (finding 2 CRITICAL + finding 4 Important): chuyển
// việc parse JSON từ shell (grep/sed, dễ fail-closed và không phải parser
// thật) vào Node qua chế độ `--stdin`, dùng JSON.parse thật. Luôn fail-open
// khi stdin rỗng / không phải JSON / không có file path.
test('--stdin: payload có file_path (top-level) trỏ path bị chặn → exit 1', () => {
  const payload = JSON.stringify({ file_path: '/x/features/demo/STATE.md' })
  const r = run(['guard-write', '--stdin'], { input: payload })
  assert.equal(r.code, 1)
  assert.match(r.out, /STATE\.md/)
})

test('--stdin: payload dạng tool_input.file_path (khuôn dạng hook thật) trỏ path bị chặn → exit 1', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/features/demo/.evidence/log.txt' } })
  const r = run(['guard-write', '--stdin'], { input: payload })
  assert.equal(r.code, 1)
})

test('--stdin: payload trỏ path bình thường → exit 0', () => {
  const payload = JSON.stringify({ file_path: '/x/features/demo/10-prd.md' })
  const r = run(['guard-write', '--stdin'], { input: payload })
  assert.equal(r.code, 0)
})

test('--stdin: stdin rỗng → exit 0 (fail-open)', () => {
  const r = run(['guard-write', '--stdin'], { input: '' })
  assert.equal(r.code, 0)
})

test('--stdin: JSON méo/không hợp lệ → exit 0 (fail-open, không throw)', () => {
  const r = run(['guard-write', '--stdin'], { input: 'not json at all {{{' })
  assert.equal(r.code, 0)
})

test('--stdin: file_path lặp key → giá trị CUỐI quyết định (đúng ngữ nghĩa JSON.parse), ở đây cuối là path bị chặn', () => {
  const raw = '{"file_path":"/x/allowed.md","file_path":"/x/features/demo/STATE.md"}'
  const r = run(['guard-write', '--stdin'], { input: raw })
  assert.equal(r.code, 1)
})

test('--stdin: file_path lặp key, giá trị CUỐI là path được phép → exit 0', () => {
  const raw = '{"file_path":"/x/features/demo/STATE.md","file_path":"/x/allowed.md"}'
  const r = run(['guard-write', '--stdin'], { input: raw })
  assert.equal(r.code, 0)
})

// CORRECTION so với brief: guard-write KHÔNG được cần root. Hook PreToolUse
// chạy trên MỌI Write/Edit ở MỌI project trên máy, không riêng
// pinnacle-product — nếu guard-write đòi root, nó sẽ lỗi/crash khi chạy
// ngoài project này và chặn nhầm mọi chỉnh sửa file khắp máy.
test('guard-write vẫn hoạt động đúng khi không có root (chạy ngoài mọi project pp)', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-guard-noroot-'))
  const r = run(['guard-write', '--path', '/x/features/demo/STATE.md'], { cwd: noRoot })
  assert.equal(r.code, 1)
  assert.match(r.out, /STATE\.md/)
})

test('guard-write cho phép ghi bình thường khi không có root', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-guard-noroot-'))
  const r = run(['guard-write', '--path', '/x/some-other-project/README.md'], { cwd: noRoot })
  assert.equal(r.code, 0)
})

// --- guard-stop ---

test('guard-stop cho phép kết thúc khi feature không tồn tại', () => {
  const root = tmpRoot()
  const r = run(['guard-stop', 'khong-ton-tai', '--root', root])
  assert.equal(r.code, 0)
})

test('guard-stop cho phép kết thúc khi không có root (hook chạy ở session không liên quan)', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-guard-noroot-'))
  const r = run(['guard-stop', 'demo'], { cwd: noRoot })
  assert.equal(r.code, 0)
})

test('guard-stop chặn kết thúc khi có stage in_progress', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const dir = join(root, 'features/demo')
  writeState(dir, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'in_progress', attempts: 0 } } })
  const r = run(['guard-stop', 'demo', '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /10-prd/)
})

test('guard-stop chặn kết thúc khi có stage failed', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const dir = join(root, 'features/demo')
  writeState(dir, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'failed', attempts: 1 } } })
  const r = run(['guard-stop', 'demo', '--root', root])
  assert.equal(r.code, 1)
})

test('guard-stop cho phép kết thúc khi mọi stage đã done', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const dir = join(root, 'features/demo')
  writeState(dir, {
    feature: 'demo',
    current: null,
    stages: { '10-prd': { status: 'done' }, '40-testplan': { status: 'done' } },
  })
  const r = run(['guard-stop', 'demo', '--root', root])
  assert.equal(r.code, 0)
})
