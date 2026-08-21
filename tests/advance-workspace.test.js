// Task 3 (pp-bugfix/pp-change): stage diagnosis/impact cần soi code thật trong
// workspace — ranh giới đọc phải được NÓI trong chỉ thị (guard chỉ chặn ghi,
// việc nới đọc thuần là chỉ thị). Stage không khai thì tuyệt đối không in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeRoot, run } from './helpers.js'

test('stage khai reads_workspace: true → chỉ thị có dòng "Được đọc thêm"', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  // Bật cờ trực tiếp trong pipeline.json của feature (test được ghi file này —
  // guard là hook Claude Code, không chạy trong test env).
  const p = join(r0, 'features/demo/pipeline.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8'))
  cfg.stages['10-prd'].reads_workspace = true
  writeFileSync(p, JSON.stringify(cfg, null, 2))
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /Được đọc thêm : \S+ \(code repo — CHỈ ĐỌC/)
})

test('stage không khai reads_workspace → chỉ thị KHÔNG có dòng đó', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /Được đọc thêm/)
})

// FINDING (adversarial review 8c825c9..44c1ecb): dòng mới nói "code repo trong
// workspace" mà KHÔNG nêu workspace là thư mục nào — mặc định là thư mục CHA của
// root (`~/Desktop` trong layout thật), tức một giấy phép đọc không nêu biên.
// Tệ hơn: T1 `cited-paths` giải nghĩa mọi cite theo đúng gốc đó (registry.js:39
// `citeRoot = workspace ?? join(root,'..')`), nên agent đoán sai gốc là gate đỏ
// oan. `advanceCmd` thậm chí không destructure `workspace` dù bin/pp đã truyền.
test('dòng "Được đọc thêm" nêu ĐÚNG đường dẫn workspace mà cited-paths sẽ dùng', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-a', '--type', 'bugfix', '--root', r0]).code, 0)
  const r = run(['advance', 'fix-a', '--root', r0])
  assert.equal(r.code, 0)
  const dòng = r.out.split('\n').find((l) => l.trimStart().startsWith('Được đọc thêm :'))
  assert.ok(dòng, 'phải có dòng Được đọc thêm')
  // Mặc định của cited-paths là thư mục CHA của root (registry.js:citeRoot).
  assert.ok(dòng.includes(resolve(r0, '..')), `chỉ thị (${dòng}) phải nêu gốc cite thật`)
  assert.match(r.out, /giải nghĩa theo ĐÚNG gốc này/)
})

test('--workspace được tôn trọng trong chỉ thị (cùng gốc mà cited-paths dùng)', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-b', '--type', 'bugfix', '--root', r0]).code, 0)
  const r = run(['advance', 'fix-b', '--root', r0, '--workspace', '/tmp'])
  const dòng = r.out.split('\n').find((l) => l.trimStart().startsWith('Được đọc thêm :'))
  assert.match(dòng, /\/tmp/)
})

test('chỉ thị KHÔNG tự mâu thuẫn: câu "không quét thư mục khác" phải trừ workspace ra', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-c', '--type', 'bugfix', '--root', r0]).code, 0)
  const r = run(['advance', 'fix-c', '--root', r0])
  // Stage này ĐƯỢC đọc workspace, nên câu tuyệt đối "không quét thư mục khác"
  // (dòng đầu chỉ thị) phủ định chính dòng Được đọc thêm ở dưới.
  const đầu = r.out.split('\n').slice(0, 4).join('\n')
  assert.doesNotMatch(đầu, /không quét thư mục khác\./,
    'với stage reads_workspace, câu cấm quét phải được nói lại cho khớp')
})

test('stage KHÔNG đọc workspace vẫn giữ nguyên câu cấm quét tuyệt đối', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['advance', 'demo', '--root', r0])
  assert.match(r.out, /không quét thư mục khác/)
})
