// tests/cmd-guard.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { writeState } from '../lib/state.js'
import { runSplit, runHook } from './helpers.js'

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
  writeFileSync(join(d, '.pp-root'), 'marker (C4 — pp init đòi file này)\n')
  return d
}

// --- guard-write ---

test('chặn ghi STATE.md trong features/', () => {
  const r = run(['guard-write', '--path', '/x/features/demo/STATE.md'])
  assert.equal(r.code, 2)
  assert.match(r.out, /STATE\.md/)
})

test('chặn ghi trong .evidence/ của features/', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/.evidence/10-prd.log']).code, 2)
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
  assert.equal(r.code, 2)
  assert.match(r.out, /STATE\.md/)
})

test('chặn ghi STATE.MD (đuôi hoa) trong features/', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/STATE.MD']).code, 2)
})

test('chặn ghi STATE.md khi segment "Features/" viết hoa chữ đầu', () => {
  assert.equal(run(['guard-write', '--path', '/x/Features/demo/STATE.md']).code, 2)
})

test('chặn ghi trong .EVIDENCE/ viết hoa (case-insensitive)', () => {
  assert.equal(run(['guard-write', '--path', '/x/features/demo/.EVIDENCE/log.txt']).code, 2)
})

// FIX review Task 12 (finding 3, Important): path tương đối (không có "/"
// đầu) phải resolve theo cwd trước khi so khớp, để nhất quán với path có
// "./" hay path tuyệt đối — không thì bỏ dấu "/" đầu là một đường vòng.
test('chặn ghi STATE.md qua path tương đối (không có "/" đầu), resolve theo cwd', () => {
  const root = tmpRoot()
  const r = run(['guard-write', '--path', 'features/demo/STATE.md'], { cwd: root })
  assert.equal(r.code, 2)
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
test('--stdin: payload có file_path (top-level) trỏ path bị chặn → exit 2', () => {
  const payload = JSON.stringify({ file_path: '/x/features/demo/STATE.md' })
  const r = run(['guard-write', '--stdin'], { input: payload })
  assert.equal(r.code, 2)
  assert.match(r.out, /STATE\.md/)
})

test('--stdin: payload dạng tool_input.file_path (khuôn dạng hook thật) trỏ path bị chặn → exit 2', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/features/demo/.evidence/log.txt' } })
  const r = run(['guard-write', '--stdin'], { input: payload })
  assert.equal(r.code, 2)
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
  assert.equal(r.code, 2)
})

test('--stdin: file_path lặp key, giá trị CUỐI là path được phép → exit 0', () => {
  const raw = '{"file_path":"/x/features/demo/STATE.md","file_path":"/x/allowed.md"}'
  const r = run(['guard-write', '--stdin'], { input: raw })
  assert.equal(r.code, 0)
})

// CORRECTION so với brief: guard-write KHÔNG được cần root. Hook PreToolUse
// chạy trên MỌI Write/Edit ở MỌI project trên máy, không riêng
// product-repo — nếu guard-write đòi root, nó sẽ lỗi/crash khi chạy
// ngoài project này và chặn nhầm mọi chỉnh sửa file khắp máy.
test('guard-write vẫn hoạt động đúng khi không có root (chạy ngoài mọi project pp)', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-guard-noroot-'))
  const r = run(['guard-write', '--path', '/x/features/demo/STATE.md'], { cwd: noRoot })
  assert.equal(r.code, 2)
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
  assert.equal(r.code, 2)
  assert.match(r.out, /10-prd/)
})

test('guard-stop chặn kết thúc khi có stage failed', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const dir = join(root, 'features/demo')
  writeState(dir, { feature: 'demo', current: '10-prd', stages: { '10-prd': { status: 'failed', attempts: 1 } } })
  const r = run(['guard-stop', 'demo', '--root', root])
  assert.equal(r.code, 2)
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

// ─── FIX review cuối (finding 5): hợp đồng hook = exit 2 + stderr ─────────
// Claude Code chỉ coi **exit 2** là tín hiệu chặn, và chỉ đọc **stderr** làm
// lý do. Exit 1 + stdout (bản cũ) = "lỗi không chặn" → Write VẪN LỌT. Test
// này kiểm đúng hai thứ đó, tách luồng, chứ không gộp stdout+stderr.

test('chặn: exit 2, lý do ra stderr, stdout rỗng', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/STATE.md'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /STATE\.md/)
  assert.equal(r.stdout, '')
})

test('chặn .evidence/: exit 2, lý do ra stderr, stdout rỗng', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/.evidence/10-prd.t1.log'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /evidence/)
  assert.equal(r.stdout, '')
})

test('cho phép: exit 0 và không in gì ra stderr', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/10-prd.md'])
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('bin/pp không remap exit code của guard — 2 sống sót ra tới shell', () => {
  const r = runSplit(['guard-write', '--stdin'], { input: JSON.stringify({ file_path: '/x/features/demo/STATE.md' }) })
  assert.equal(r.code, 2)
})

// ─── FIX review cuối (finding 6): pipeline.json cũng phải được canh ──────
// Agent chỉ có tool Write vẫn có thể tắt mọi stage (`enabled: false` → `pp
// status` báo hoàn tất với 0 gate) hoặc lật `human: true` thành `false`.

test('chặn ghi pipeline.json trong features/ — exit 2 + stderr', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/pipeline.json'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /pipeline\.json/)
  assert.equal(r.stdout, '')
})

test('chặn ghi PIPELINE.JSON (hoa) và qua path tương đối', () => {
  assert.equal(runSplit(['guard-write', '--path', '/x/features/demo/PIPELINE.JSON']).code, 2)
  const root = tmpRoot()
  assert.equal(runSplit(['guard-write', '--path', 'features/demo/pipeline.json'], { cwd: root }).code, 2)
})

test('chặn pipeline.json qua --stdin (khuôn dạng payload hook thật)', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/features/demo/pipeline.json' } })
  assert.equal(runSplit(['guard-write', '--stdin'], { input: payload }).code, 2)
})

test('cho phép pipeline.json NGOÀI features/ (project khác không bị chặn oan)', () => {
  assert.equal(runSplit(['guard-write', '--path', '/x/some-other-project/pipeline.json']).code, 0)
  assert.equal(runSplit(['guard-write', '--path', '/x/features/demo/40-testplan.md']).code, 0)
})

// ─── FIX review cuối (finding 5): guard-stop không còn cần PP_FEATURE ────

test('guard-stop KHÔNG tham số: chặn khi bất kỳ feature nào có stage failed', () => {
  const root = tmpRoot()
  run(['init', 'a', '--size', 'S', '--root', root])
  run(['init', 'b', '--size', 'S', '--root', root])
  writeState(join(root, 'features/b'), { feature: 'b', stages: { '10-prd': { status: 'failed', attempts: 1 } } })
  const r = runSplit(['guard-stop', '--root', root])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /\bb\b/)
  assert.match(r.stderr, /10-prd/)
  assert.equal(r.stdout, '')
})

test('guard-stop KHÔNG tham số: chặn khi có stage in_progress (tier còn thiếu)', () => {
  const root = tmpRoot()
  run(['init', 'a', '--size', 'S', '--root', root])
  writeState(join(root, 'features/a'), { feature: 'a', stages: { '10-prd': { status: 'in_progress', outstanding: ['t2'] } } })
  assert.equal(runSplit(['guard-stop', '--root', root]).code, 2)
})

test('guard-stop KHÔNG tham số: exit 0 khi mọi feature đều sạch', () => {
  const root = tmpRoot()
  run(['init', 'a', '--size', 'S', '--root', root])
  writeState(join(root, 'features/a'), { feature: 'a', stages: { '10-prd': { status: 'done' } } })
  const r = runSplit(['guard-stop', '--root', root])
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

test('guard-stop KHÔNG tham số: exit 0 khi không có root (phiên không liên quan)', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-guard-noroot-'))
  assert.equal(runSplit(['guard-stop'], { cwd: noRoot }).code, 0)
})

test('guard-stop bỏ qua _archive và thư mục không phải feature', () => {
  const root = tmpRoot()
  mkdirSync(join(root, 'features/_archive/cu'), { recursive: true })
  writeState(join(root, 'features/_archive/cu'), { feature: 'cu', stages: { '10-prd': { status: 'failed' } } })
  mkdirSync(join(root, 'features/rac'), { recursive: true })
  assert.equal(runSplit(['guard-stop', '--root', root]).code, 0)
})

// ─── Hai file hook được CHẠY THẬT (dirname "$0" chưa từng được kiểm) ──────

test('hooks/pre-tool-use.sh chạy thật: chặn STATE.md với exit 2 + stderr', () => {
  const r = runHook('pre-tool-use.sh', { input: JSON.stringify({ tool_input: { file_path: '/x/features/demo/STATE.md' } }) })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /STATE\.md/)
  assert.equal(r.stdout, '')
})

test('hooks/pre-tool-use.sh chạy thật: cho ghi artifact bình thường (exit 0)', () => {
  const r = runHook('pre-tool-use.sh', { input: JSON.stringify({ tool_input: { file_path: '/x/features/demo/10-prd.md' } }) })
  assert.equal(r.code, 0)
})

test('hooks/pre-tool-use.sh chạy thật: stdin rỗng vẫn fail-open (exit 0)', () => {
  assert.equal(runHook('pre-tool-use.sh', { input: '' }).code, 0)
})

test('hooks/stop.sh chạy thật: không có gốc repo thì exit 0, không chặn phiên lạ', () => {
  const noRoot = mkdtempSync(join(tmpdir(), 'pp-hook-noroot-'))
  const r = runHook('stop.sh', { cwd: noRoot, input: '' })
  assert.equal(r.code, 0)
})

test('hooks/stop.sh chạy thật: chặn (exit 2) khi feature dưới cwd có stage failed', () => {
  const root = tmpRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  writeState(join(root, 'features/demo'), { feature: 'demo', stages: { '10-prd': { status: 'failed', attempts: 1 } } })
  const r = runHook('stop.sh', { cwd: root, input: '' })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /10-prd/)
})

// ─── Sổ kiểm toán / archive review / usage: chỉ pp được ghi ────────────────
// Cùng luật với STATE.md/.evidence//pipeline.json: audit.jsonl, .review/ (bản
// lưu vĩnh viễn verdict) và .usage/ (token thật khai thác từ transcript) là
// bằng chứng do pp sinh — agent sửa tay là làm giả evidence.

test('chặn ghi audit.jsonl trong features/ — exit 2 + stderr', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/audit.jsonl'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /audit\.jsonl/)
  assert.equal(r.stdout, '')
})

test('chặn ghi trong .review/ của features/ — exit 2 + stderr', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/.review/10-prd.1.json'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /\.review/)
})

test('chặn ghi trong .usage/ của features/ — exit 2 + stderr', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/.usage/entries.jsonl'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /\.usage/)
})

// KHÔNG đụng inbox `.review-<stage>.json` — file này là nơi conductor NỘP
// verdict thô cho pp (đúng thiết kế: agent bàn giao dữ liệu, pp ghi state).
// Regex chặn dir `.review/` phải để yên file `.review-...json` ở gốc feature.
test('cho phép ghi .review-<stage>.json (inbox conductor nộp verdict) — exit 0', () => {
  const r = runSplit(['guard-write', '--path', '/x/features/demo/.review-10-prd.json'])
  assert.equal(r.code, 0)
  assert.equal(r.stderr, '')
})

// APFS case-insensitive: viết hoa tên là cùng file trên đĩa.
test('chặn AUDIT.JSONL (hoa) và .Review/ (hoa) — APFS case-insensitive', () => {
  assert.equal(runSplit(['guard-write', '--path', '/x/features/demo/AUDIT.JSONL']).code, 2)
  assert.equal(runSplit(['guard-write', '--path', '/x/features/demo/.Review/10-prd.1.json']).code, 2)
  assert.equal(runSplit(['guard-write', '--path', '/x/features/demo/.USAGE/entries.jsonl']).code, 2)
})

test('cho phép audit.jsonl/.review//.usage/ NGOÀI features/ (project khác không bị chặn oan)', () => {
  assert.equal(runSplit(['guard-write', '--path', '/x/some-other-project/audit.jsonl']).code, 0)
  assert.equal(runSplit(['guard-write', '--path', '/x/some-other-project/.review/a.json']).code, 0)
  assert.equal(runSplit(['guard-write', '--path', '/x/some-other-project/.usage/entries.jsonl']).code, 0)
})
