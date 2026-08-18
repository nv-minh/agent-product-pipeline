import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const PP = new URL('../bin/pp', import.meta.url).pathname

function run(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8', ...opts }) }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'pp-root-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\n')
  return d
}

test('init tạo đủ file', () => {
  const root = tmpRoot()
  const r = run(['init', 'demo', '--size', 'S', '--root', root])
  assert.equal(r.code, 0)
  for (const f of ['pipeline.json', '00-brief.md', 'STATE.md']) {
    assert.ok(existsSync(join(root, 'features/demo', f)), `thiếu ${f}`)
  }
})

test('init lần hai thì từ chối, exit 1', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--root', root])
  const r = run(['init', 'demo', '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /đã tồn tại/)
})

test('status ngay sau init trỏ vào stage đầu tiên', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const r = run(['status', 'demo', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /run/)
})

test('không tìm thấy gốc repo thì thoát sạch (exit 2, thông báo rõ), không crash', () => {
  // Thư mục tạm này (và mọi thư mục cha của nó, tới /) không có constitution.md,
  // và không truyền --root, nên findRoot phải trả về null thay vì throw.
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-noroot-'))
  const r = run(['status', 'demo'], { cwd: noRoot })
  assert.equal(r.code, 2)
  assert.match(r.out, /không tìm thấy gốc repo/)
  assert.match(r.out, /constitution\.md/)
  // Không phải một stack trace thô (không throw ra ngoài rồi bị bắt ở catch-all).
  assert.doesNotMatch(r.out, /\bat \S+ \(.*:\d+:\d+\)/)
  assert.doesNotMatch(r.out, /node:internal/)
})

test('init cũng từ chối sạch khi không có root', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-noroot-'))
  const r = run(['init', 'demo'], { cwd: noRoot })
  assert.equal(r.code, 2)
  assert.match(r.out, /không tìm thấy gốc repo/)
})
