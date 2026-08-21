// C2 + C3 + C4 — BA ĐƯỜNG MÀ MỘT CHUỖI DO NGƯỜI DÙNG GÕ TRỞ THÀNH ĐƯỜNG DẪN
// KHÔNG QUA KIỂM.
//
// C2  Tên feature là một mảnh path. Tái lập được trước bản vá:
//       pp init ../../evil --root /a/b   → scaffold /a/evil, NGOÀI repo, exit 0
//     và đường dẫn đã traverse không còn khớp các guard canh "features/".
// C3  `--root` được tin không kiểm — trỏ nhầm vào thư mục rỗng là mkdirSync
//     dựng nguyên cây features/ ở đó, exit 0.
// C4  Gốc repo nhận diện bằng constitution.md — đúng tên file mà GitHub
//     Spec Kit cũng dùng, nên đứng trong repo Spec Kit của người khác mà gõ
//     `pp init` là scaffold vào repo của họ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, existsSync, unlinkSync, cpSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRoot, run, REPO } from './helpers.js'

// ─── C2 ───────────────────────────────────────────────────────────────────

test('C2: pp init ../../evil — exit 2 và KHÔNG một thư mục nào được tạo', () => {
  // Root nằm sâu 2 cấp trong một thư mục canh được, để nếu traversal xảy ra
  // thì tang vật nằm ở outer — đúng chỗ test đang nhìn.
  const outer = mkdtempSync(join(tmpdir(), 'pp-c2-'))
  const root = join(outer, 'a', 'b')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'constitution.md'), '# C\n')
  writeFileSync(join(root, '.pp-root'), 'marker\n')
  for (const sub of ['schema', 'templates', 'rubric']) cpSync(join(REPO, sub), join(root, sub), { recursive: true })

  const before = readdirSync(outer).sort()
  const r = run(['init', '../../evil', '--size', 'S', '--root', root])
  assert.equal(r.code, 2)
  assert.match(r.out, /tên feature "\.\.\/\.\.\/evil" không hợp lệ/)
  assert.match(r.out, /path traversal/)
  assert.deepEqual(readdirSync(outer).sort(), before, 'không được mọc thêm gì ở ngoài root')
  assert.equal(existsSync(join(root, 'features')), false, 'features/ cũng không được tạo')
})

test('C2: mọi lệnh nhận <feature> đều chặn tên độc — không riêng init', () => {
  const r0 = makeRoot()
  for (const args of [
    ['status', '../x'],
    ['gate', 'a/b', '10-prd'],
    ['approve', '..', '10-prd'],
    ['review-prompt', 'A_B', '10-prd'],
    ['usage-sync', '.hidden'],
    ['report', 'x y'],
    ['guard-stop', '../x'],
  ]) {
    const r = run([...args, '--root', r0])
    assert.equal(r.code, 2, `pp ${args.join(' ')} phải exit 2, nhận ${r.code}:\n${r.out}`)
    assert.match(r.out, /không hợp lệ/, `pp ${args.join(' ')}`)
  }
})

test('C2: feature là đối số TUỲ CHỌN của report/guard-stop — thiếu hẳn vẫn chạy', () => {
  const r0 = makeRoot()
  assert.equal(run(['report', '--root', r0]).code, 0)
  assert.equal(run(['guard-stop', '--root', r0]).code, 0)
})

// ─── C3 ───────────────────────────────────────────────────────────────────

test('C3: --root trỏ vào thư mục không phải product-repo — exit 2, không tạo gì', () => {
  const empty = mkdtempSync(join(tmpdir(), 'pp-c3-'))
  const r = run(['init', 'foo', '--size', 'S', '--root', empty])
  assert.equal(r.code, 2)
  assert.match(r.out, /không phải gốc product-repo/)
  assert.match(r.out, /\.pp-root hay constitution\.md/)
  assert.deepEqual(readdirSync(empty), [], 'thư mục gõ nhầm phải còn nguyên rỗng')
  // Lệnh chỉ-đọc cũng vậy: đối số tường minh sai thì chết to, không dò tiếp cwd.
  assert.equal(run(['report', '--root', empty]).code, 2)
})

// ─── C4 ───────────────────────────────────────────────────────────────────

test('C4: root chỉ có constitution.md (hình dạng repo Spec Kit) — init từ chối, chỉ đường', () => {
  const r0 = makeRoot()
  unlinkSync(join(r0, '.pp-root'))
  const r = run(['init', 'demo', '--size', 'S', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /chưa có file \.pp-root/)
  assert.match(r.out, /Spec Kit/)
  assert.match(r.out, /touch .*\.pp-root/)
  assert.equal(existsSync(join(r0, 'features')), false)

  // Làm đúng theo hướng dẫn thì đường mở — hướng dẫn phải là lối ra thật.
  writeFileSync(join(r0, '.pp-root'), 'marker\n')
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
})

test('C4: constitution.md vẫn là fallback cho lệnh KHÔNG scaffold — clone cũ không gãy', () => {
  const r0 = makeRoot()
  const demo = run(['init', 'demo', '--size', 'S', '--root', r0])
  assert.equal(demo.code, 0)
  unlinkSync(join(r0, '.pp-root'))
  // report/status đọc được bình thường trên root chỉ có constitution.md.
  assert.equal(run(['report', '--root', r0]).code, 0)
  assert.equal(run(['status', 'demo', '--root', r0]).code, 0)
})

test('C4: root chỉ có .pp-root (không constitution.md) cũng được nhận', () => {
  const r0 = makeRoot()
  unlinkSync(join(r0, 'constitution.md'))
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
})
