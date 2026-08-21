// FINDING (adversarial review 8c825c9..44c1ecb): một flag gõ sai tên đi qua
// toàn bộ CLI mà không ai từ chối — `pp init x --type change --form old-a` trả
// exit 0 và lặng lẽ bỏ liên kết người dùng vừa yêu cầu. Cùng lớp lỗi với
// `--type=bugfix`: pp làm một việc KHÁC việc được yêu cầu rồi báo thành công
// (gate.js:19-27 gọi đây là "loại sai tệ nhất mà một CLI có thể mắc").
//
// Luật: flag KHÔNG nằm trong allowlist → exit 2, nêu tên flag lạ. Allowlist là
// một danh sách chung cho cả CLI (không per-command): rẻ, và đủ bắt lớp lỗi
// đánh máy. Flag đúng tên nhưng vô nghĩa với lệnh đó là việc của từng lệnh
// (init đã nói `--from` chỉ có nghĩa với --type change).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, runSplit } from './helpers.js'

test('flag lạ (--form thay vì --from) → exit 2, nêu tên flag, KHÔNG tạo thư mục', () => {
  const r0 = makeRoot()
  const r = run(['init', 'doi-a', '--type', 'change', '--form', 'old-a', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /--form/)
  assert.match(r.out, /không biết flag|flag lạ|không hợp lệ/)
  assert.ok(!existsSync(join(r0, 'features/doi-a')))
})

test('flag lạ dạng --key=value cũng bị từ chối', () => {
  const r0 = makeRoot()
  const r = run(['init', 'doi-b', '--typ=change', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /--typ/)
  assert.ok(!existsSync(join(r0, 'features/doi-b')))
})

test('mọi flag hợp lệ vẫn đi qua: init --size/--type/--from/--root', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  assert.equal(run(['init', 'demo2', '--type', 'bugfix', '--root', r0]).code, 0)
})

// Hồi quy cho chính lớp lỗi mà finding này lộ ra: dạng `=` phải cho ra ĐÚNG
// pipeline mà người dùng gọi, không phải default im lặng.
test('--type=bugfix cho ra pipeline bugfix (không tụt về feature)', () => {
  const r0 = makeRoot()
  const r = run(['init', 'fix-a', '--type=bugfix', '--root', r0])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /type bugfix/)
})

test('--root=<đường dẫn không phải gốc pp> → exit 2 như dạng cách trắng', () => {
  const r = run(['init', 'demo', '--root=/tmp/khong-ton-tai-pp-9xyz'])
  assert.equal(r.code, 2)
  assert.match(r.out, /không phải gốc product-repo/)
})

// Cùng luật "bỏ qua thì phải NÓI" (gate.js:19-27 B4, và c0fc76a đã áp cho
// fallback size): `--size` không có nghĩa với bugfix/change, nhưng USAGE in nó
// cạnh `--type` nên người dùng có lý do gõ cả hai.
test('--size cùng --type bugfix: vẫn tạo được, nhưng NÓI RÕ size bị bỏ qua', () => {
  const r0 = makeRoot()
  const r = run(['init', 'fix-b', '--type', 'bugfix', '--size', 'S', '--root', r0])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /--size .*(bỏ qua|không có nghĩa)/)
  assert.match(r.out, /type bugfix/)
})

test('--type feature + --size S: KHÔNG in cảnh báo nào về size', () => {
  const r0 = makeRoot()
  const r = run(['init', 'demo-s', '--size', 'S', '--root', r0])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /bỏ qua/)
})

test('--tier=t2 bị từ chối đúng như --tier t2 (không âm thầm chạy T1)', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['gate', 'demo', '10-prd', '--tier=t2', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /chỉ chạy T1/)
  assert.ok(!existsSync(join(r0, 'features/demo/.evidence')), 'gate chưa hề chạy thì không được để lại evidence')
})

// FINDING (lab 2026-08-21): flag ĐÚNG TÊN nhưng SAI LỆNH từng chỉ in lại usage
// của lệnh mà không nói flag nào đang thừa — người dùng phải tự diff usage với
// dòng lệnh của mình. Lớp hai của allowlist: mỗi lệnh khai flag riêng; sai thì
// nêu đích danh flag thừa + flag lệnh đó thật sự nhận.
test('flag đúng tên nhưng sai lệnh (--from cho review-record) → exit 2, nêu flag đúng', () => {
  const r0 = makeRoot()
  const r = run(['review-record', 'demo', '10-prd', '--from', '/tmp/x.json', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /--from/)
  assert.match(r.out, /review-record/)
  assert.match(r.out, /--verdict/)
})

test('flag sai lệnh bị chặn TRƯỚC khi lệnh chạy (gate --reason không để lại evidence)', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['gate', 'demo', '10-prd', '--reason', 'x', '--root', r0])
  assert.equal(r.code, 2)
  assert.ok(!existsSync(join(r0, 'features/demo/.evidence')))
})

// N1 (lab 2026-08-21): feature không tồn tại từng đổ raw ENOENT (lộ cả đường
// symlink /private/... của macOS) và exit 1 như lỗi runtime — trong khi đây là
// lỗi đối số: exit 2 như unknown command/stage, kèm danh sách feature thật.
test('feature không tồn tại → exit 2 + liệt kê feature đang có, không ENOENT', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['status', 'khong-ton-tai', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /không tồn tại/)
  assert.match(r.out, /demo/)
  assert.doesNotMatch(r.out, /ENOENT/)
})

// N3: lỗi dùng → stderr; stdout chỉ chở dữ liệu (scripting bắt stream đúng).
test('lỗi dùng ra stderr, stdout sạch', () => {
  const r = runSplit(['status', 'khong-ton-tai', '--root', makeRoot()])
  assert.equal(r.code, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /không tồn tại/)
})

// N7: `pp help` từng bị coi là lệnh lạ (exit 2 dù có in usage).
test('pp help là alias của --help — exit 0, usage ra stdout', () => {
  const r = runSplit(['help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /Usage: pp/)
})

test('pp không đối số → usage ra stderr + exit 2 (không lẫn vào dữ liệu)', () => {
  const r = runSplit([])
  assert.equal(r.code, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /Usage: pp/)
})
