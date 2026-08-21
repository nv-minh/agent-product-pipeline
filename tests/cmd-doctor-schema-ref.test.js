// FINDING (adversarial review 8c825c9..44c1ecb):
//
// (1) doctor kiểm 4 template tồn tại + JSON hợp lệ rồi DỪNG ngay trước bước
//     quan trọng nhất: các file schema mà chính template đó khai
//     (`pipeline.change.json` có `"schema": "10-prd.change"`). Thiếu file đó thì
//     gate 10-prd của mọi pipeline change chạy với schema rỗng — và doctor vẫn
//     in "Tất cả kiểm tra đạt". Đây đúng là việc doctor tồn tại để làm
//     (doctor.js:1-14: "TẦNG THI HÀNH CÓ ĐANG BẬT KHÔNG?").
//
// (2) `pkgRoot` dùng `new URL(...).pathname` → percent-encoded, trong khi
//     init.js dùng `fileURLToPath`. Cài pp dưới đường dẫn có khoảng trắng (rất
//     thường trên macOS: "My Drive") thì doctor báo cả 4 template "KHÔNG tồn
//     tại" + exit 1 trong khi init chạy bình thường. Comment doctor.js:225 tự
//     tuyên bố parity với init — nay cho nó đúng.
//
// (3) Thông báo "pp init sẽ từ chối type/size này" SAI với S/M: init fallback
//     về M và exit 0. Doctor và init nói khác nhau về cùng một tình huống.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeRoot, run, REPO } from './helpers.js'

// Bản cài pp ở thư mục tạm — để xoá/đổi template & schema mà không đụng repo.
function installPp(dirName = 'pp-inst-') {
  const d = mkdtempSync(join(tmpdir(), dirName))
  cpSync(REPO, d, {
    recursive: true,
    filter: (s) => !s.includes('/.git/') && !s.includes('/node_modules/'),
  })
  return d
}
function runFrom(pkg, args) {
  try {
    return { code: 0, out: execFileSync('node', [join(pkg, 'bin/pp'), ...args], { encoding: 'utf8' }) }
  } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

test('doctor liệt kê schema mà template khai, và báo BAD khi file đó thiếu', () => {
  const pkg = installPp()
  const r0 = makeRoot()
  rmSync(join(r0, 'schema/10-prd.change.json'))
  const r = runFrom(pkg, ['doctor', '--root', r0])
  assert.match(r.out, /10-prd\.change/, `doctor phải nhắc schema bị thiếu:\n${r.out}`)
  assert.equal(r.code, 1, 'thiếu schema mà template khai là BAD, không phải cảnh báo')
})

test('schema template khai mà CÓ mặt thì báo OK (không đếm vào bad)', () => {
  // Không assert exit code: root tạm không đăng ký hook nên doctor luôn exit 1
  // vì lý do khác (hành vi có sẵn của mục 3) — ở đây chỉ xét dòng schema.
  const r = run(['doctor', '--root', makeRoot()])
  assert.match(r.out, /✓ schema\/10-prd\.change\.json/)
})

test('doctor bắt schema ref hỏng JSON, không chỉ thiếu file', () => {
  const pkg = installPp()
  const r0 = makeRoot()
  writeFileSync(join(r0, 'schema/10-prd.change.json'), '{ hỏng')
  const r = runFrom(pkg, ['doctor', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /10-prd\.change/)
})

test('doctor cũng kiểm schema mà features/*/pipeline.json khai', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const p = join(r0, 'features/doi-form/pipeline.json')
  const cfg = JSON.parse(execFileSync('cat', [p], { encoding: 'utf8' }))
  cfg.stages['10-prd'].schema = 'khong-ton-tai'
  writeFileSync(p, JSON.stringify(cfg, null, 2))
  const r = run(['doctor', '--root', r0])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /doi-form/)
  assert.match(r.out, /khong-ton-tai/)
})

test('pkgRoot chịu được đường dẫn có khoảng trắng (doctor không báo thiếu template oan)', () => {
  const base = mkdtempSync(join(tmpdir(), 'pp-space-'))
  const pkg = join(base, 'My Drive', 'pp')
  mkdirSync(pkg, { recursive: true })
  cpSync(REPO, pkg, {
    recursive: true,
    filter: (s) => !s.includes('/.git/') && !s.includes('/node_modules/'),
  })
  const r0 = makeRoot()
  const r = runFrom(pkg, ['doctor', '--root', r0])
  assert.doesNotMatch(r.out, /templates\/pipeline\.\w+\.json\s+KHÔNG tồn tại/,
    `template có thật nhưng doctor báo thiếu (percent-encoding):\n${r.out}`)
})

test('thiếu template size S: doctor nói FALLBACK, không nói "từ chối" (init exit 0)', () => {
  const pkg = installPp()
  rmSync(join(pkg, 'templates/pipeline.S.json'))
  const r0 = makeRoot()
  const d = runFrom(pkg, ['doctor', '--root', r0])
  assert.match(d.out, /pipeline\.S\.json/)
  assert.doesNotMatch(d.out, /pipeline\.S\.json.*từ chối/, 'init KHÔNG từ chối size thiếu — nó fallback về M')
  assert.match(d.out, /pipeline\.S\.json.*fallback/i)
  // và hành vi init đúng như doctor vừa nói
  const i = runFrom(pkg, ['init', 'demo-s', '--size', 'S', '--root', r0])
  assert.equal(i.code, 0)
  assert.match(i.out, /fallback/)
})

test('thiếu template M (không còn gì để fallback): init nói THIẾU, không nói "JSON hợp lệ"', () => {
  const pkg = installPp()
  rmSync(join(pkg, 'templates/pipeline.S.json'))
  rmSync(join(pkg, 'templates/pipeline.M.json'))
  const r0 = makeRoot()
  const i = runFrom(pkg, ['init', 'demo-m', '--size', 'S', '--root', r0])
  assert.equal(i.code, 2)
  assert.match(i.out, /thiếu|không tồn tại/i)
  assert.doesNotMatch(i.out, /không phải JSON hợp lệ/,
    'quy lỗi "JSON hỏng" cho một file KHÔNG TỒN TẠI là chẩn đoán sai')
  assert.ok(!existsSync(join(r0, 'features/demo-m')))
})
