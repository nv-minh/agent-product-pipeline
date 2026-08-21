// FINDING (adversarial review 8c825c9..44c1ecb): `resolvePath` realpath cả path
// trước khi so luật — đúng để bắt symlink TRỎ TỚI file bảo vệ (A2). Nhưng nó mở
// một lỗ ngược: một symlink THƯ MỤC trong features/ (`ln -s /tmp/x
// features/evil`) làm realpath ra `/tmp/x/STATE.md`, không còn khớp regex
// `features/.../STATE.md` nào → guard CHO GHI.
//
//   pp guard-write --path features/evil/STATE.md      → exit 0  [CHO GHI]
//   pp guard-write --path features/evil/pipeline.json → exit 0  [CHO GHI]
//   pp guard-write --path features/that/STATE.md      → exit 2  [CHẶN]
//
// Agent tạo được symlink đó bằng Bash (`ln` chỉ bị chặn khi một token khớp path
// bảo vệ, `features/evil` không khớp gì). Và `pp init --from evil` chấp nhận nó
// vì chỉ dùng existsSync — nên pp còn ra lệnh cho subagent đọc file ngoài root
// và băm chúng vào inputs_hash.
//
// Luật: so luật trên CẢ HAI dạng — path đã resolve (chưa realpath) VÀ path đã
// realpath. Một trong hai khớp là chặn. Giữ nguyên A2, đóng đường ngược.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPath } from '../lib/commands/guard.js'
import { makeRoot, run } from './helpers.js'

function rootVớiSymlink() {
  const r0 = makeRoot()
  mkdirSync(join(r0, 'features/that'), { recursive: true })
  const outside = mkdtempSync(join(tmpdir(), 'pp-outside-'))
  writeFileSync(join(outside, '10-prd.md'), '# PRD ngoài root\n')
  symlinkSync(outside, join(r0, 'features', 'evil'))
  return { r0, outside }
}

test('ghi STATE.md qua symlink thư mục trong features/ vẫn bị chặn', () => {
  const { r0 } = rootVớiSymlink()
  assert.equal(classifyPath(join(r0, 'features/evil/STATE.md')).blocked, true)
})

test('ghi pipeline.json qua symlink thư mục trong features/ vẫn bị chặn', () => {
  const { r0 } = rootVớiSymlink()
  assert.equal(classifyPath(join(r0, 'features/evil/pipeline.json')).blocked, true)
})

test('A2 không mất: symlink TRỎ TỚI file bảo vệ vẫn bị chặn', () => {
  const r0 = makeRoot()
  mkdirSync(join(r0, 'features/that'), { recursive: true })
  writeFileSync(join(r0, 'features/that/STATE.md'), '# state\n')
  const link = join(r0, 'trong-suot.md')
  symlinkSync(join(r0, 'features/that/STATE.md'), link)
  assert.equal(classifyPath(link).blocked, true)
})

test('artifact stage bình thường vẫn ghi được (guard không chặn oan)', () => {
  const r0 = makeRoot()
  mkdirSync(join(r0, 'features/that'), { recursive: true })
  assert.equal(classifyPath(join(r0, 'features/that/10-prd.md')).blocked, false)
  assert.equal(classifyPath(join(r0, 'features/that/.review-10-prd.json')).blocked, false)
  assert.equal(classifyPath(join(r0, 'lib/gate.js')).blocked, false)
})

// ── init --from không được nhận symlink ra ngoài root, cũng không nhận FILE ──
test('--from symlink trỏ ra NGOÀI root → exit 2, không tạo feature', () => {
  const { r0 } = rootVớiSymlink()
  const r = run(['init', 'doi-evil', '--type', 'change', '--from', 'evil', '--root', r0])
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /ngoài|symlink|không hợp lệ/i)
  assert.ok(!existsSync(join(r0, 'features/doi-evil')))
})

test('--from trỏ vào một FILE (không phải thư mục) → exit 2', () => {
  const r0 = makeRoot()
  mkdirSync(join(r0, 'features'), { recursive: true })
  writeFileSync(join(r0, 'features/notadir'), 'tôi là file\n')
  const r = run(['init', 'zz-file', '--type', 'change', '--from', 'notadir', '--root', r0])
  assert.equal(r.code, 2, r.out)
  assert.ok(!existsSync(join(r0, 'features/zz-file')))
})

test('--from thư mục THẬT vẫn hoạt động (không chặn oan)', () => {
  const r0 = makeRoot()
  mkdirSync(join(r0, 'features/_archive/old-widget'), { recursive: true })
  writeFileSync(join(r0, 'features/_archive/old-widget/10-prd.md'), '# PRD cũ\n')
  const r = run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.equal(r.code, 0, r.out)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-widget/pipeline.json'), 'utf8'))
  assert.ok(cfg.stages['05-impact'].inputs.includes('../_archive/old-widget/10-prd.md?'))
})
