// Task 5 (pp-bugfix/pp-change): --from liên kết feature gốc cho impact analysis.
// Tiêm inputs phải xảy ra ĐÚNG LÚC init vì pipeline.json chỉ pp được ghi
// (guard chặn agent) — không có cơ hội sửa sau (spec §3.2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

function withOld(r0, rel) {
  const d = join(r0, 'features', rel)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, '10-prd.md'), '# PRD cũ\n')
  return d
}

test('--from feature đang sống: ghi from + nối inputs ../<cũ>/*', () => {
  const r0 = makeRoot()
  withOld(r0, 'old-widget')
  const r = run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.equal(r.code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-widget/pipeline.json'), 'utf8'))
  assert.equal(cfg.from, 'old-widget')
  const inputs = cfg.stages['05-impact'].inputs
  for (const f of ['../old-widget/00-brief.md?', '../old-widget/10-prd.md?', '../old-widget/40-testplan.md?']) {
    assert.ok(inputs.includes(f), `thiếu input ${f} — có: ${inputs.join(', ')}`)
  }
})

test('--from feature đã archive: tiền tố ../_archive/', () => {
  const r0 = makeRoot()
  withOld(r0, '_archive/old-widget')
  const r = run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.equal(r.code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-widget/pipeline.json'), 'utf8'))
  assert.ok(cfg.stages['05-impact'].inputs.includes('../_archive/old-widget/10-prd.md?'))
})

test('--from không tồn tại: exit 2, liệt kê ứng viên, KHÔNG tạo thư mục', () => {
  const r0 = makeRoot()
  withOld(r0, 'old-widget')
  const r = run(['init', 'doi-x', '--type', 'change', '--from', 'khong-co', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"khong-co" không tồn tại/)
  assert.match(r.out, /old-widget/)
  assert.ok(!existsSync(join(r0, 'features/doi-x')))
})

test('--from với type khác change: exit 2', () => {
  const r0 = makeRoot()
  withOld(r0, 'old-widget')
  for (const t of [['--type', 'bugfix'], []]) {
    const r = run(['init', 'x-y', ...t, '--from', 'old-widget', '--root', r0])
    assert.equal(r.code, 2)
    assert.match(r.out, /--from chỉ có nghĩa với --type change/)
    assert.ok(!existsSync(join(r0, 'features/x-y')))
  }
})

test('--from không ghi gì vào feature cũ', () => {
  const r0 = makeRoot()
  const oldDir = withOld(r0, '_archive/old-widget')
  const before = readdirSync(oldDir).sort()
  run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0])
  assert.deepEqual(readdirSync(oldDir).sort(), before)
})

// Finding (final-review): --from là một mảnh path, chưa từng qua luật tên
// feature — `--from '../../outside/evil'` từng ghi thẳng path traversal vào
// pipeline.json và tiêm inputs trỏ ra NGOÀI repo, exit 0. Phải bị chặn ở
// TẦNG VALIDATE TÊN (regex), trước cả tầng resolve (existsSync features/,
// _archive/) — nên thông báo phải nói "không hợp lệ" theo luật tên, KHÔNG
// phải "không tồn tại" (đó là thông báo của tầng resolve, tầng sau).
test('--from "../../etc": exit 2 ở tầng luật tên, KHÔNG lọt tới tầng resolve', () => {
  const r0 = makeRoot()
  const r = run(['init', 'doi-x', '--type', 'change', '--from', '../../etc', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /không hợp lệ/)
  assert.doesNotMatch(r.out, /không tồn tại/)
  assert.ok(!existsSync(join(r0, 'features/doi-x')))
})

test('--from rỗng: exit 2, KHÔNG bị coi lặng lẽ là "không có --from"', () => {
  const r0 = makeRoot()
  const r = run(['init', 'doi-y', '--type', 'change', '--from', '', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /không hợp lệ/)
  assert.ok(!existsSync(join(r0, 'features/doi-y')))
})

test('bare --from cuối lệnh (không có giá trị): exit 2, KHÔNG tạo thư mục', () => {
  const r0 = makeRoot()
  // '--root' đứng ngay sau '--from' nên parseArgs không nhặt nó làm giá trị —
  // đúng hình dạng "bare --from" (flags.from === true).
  const r = run(['init', 'doi-z', '--type', 'change', '--from', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /không hợp lệ/)
  assert.ok(!existsSync(join(r0, 'features/doi-z')))
})
