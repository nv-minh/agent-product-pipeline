// BOOTSTRAP FINDING — MỌI LỆNH `pp` GỢI Ý PHẢI CHẠY ĐƯỢC.
//
// Lộ ra khi chạy thật feature đầu tiên: `pp advance` in
// "gate xanh, chờ duyệt: pp approve 10-prd" — thiếu tên feature. Gõ đúng như máy
// in ra thì parseArgs lấy "10-prd" làm feature, stage thành undefined, và lệnh
// thoát 2 với dòng usage. Hai gợi ý `pp unblock` còn thiếu cả `--reason` bắt buộc.
//
// Không test bằng cách so chuỗi (chuỗi sẽ trôi). Test bằng cách TRÍCH lệnh ra
// khỏi output rồi CHẠY nó, và đòi nó không thoát 2 ("đối số sai"). Đây là lớp lỗi
// chỉ hiện ra khi có người thật làm theo hướng dẫn — đúng lúc họ đang bế tắc.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, passT1Prd, verdictFile, PRD } from './helpers.js'

// Lấy mọi lệnh `pp ...` xuất hiện trong output, kèm cả placeholder dạng <lý do>
// (caller tự thay trước khi chạy).
function suggestedCommands(out) {
  return [...out.matchAll(/\bpp ([a-z-]+(?:\s+(?:"[^"]*"|<[^>]*>|[^\s"]+))*)/g)].map((m) => m[1].trim())
}

// Tách một dòng lệnh thành argv, giữ nguyên phần trong ngoặc kép.
function toArgv(cmd) {
  return [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
}

function seedAwaitingHuman() {
  const root = makeRoot()
  assert.equal(run(['init', 'demo', '--root', root]).code, 0)
  passT1Prd(root, 'demo')
  const v = verdictFile(root, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root]).code, 0)
  return root
}

test('lệnh `pp approve` mà advance gợi ý phải chạy được (không exit 2)', () => {
  const root = seedAwaitingHuman()
  const adv = run(['advance', 'demo', '--root', root])
  assert.match(adv.out, /chờ duyệt/)

  const approve = suggestedCommands(adv.out).find((c) => c.startsWith('approve'))
  assert.ok(approve, `advance phải gợi ý một lệnh approve, nhận:\n${adv.out}`)
  // Gợi ý phải mang tên feature — đây là chính lỗi đã quan sát được.
  assert.match(approve, /\bdemo\b/, `lệnh gợi ý thiếu tên feature: "pp ${approve}"`)

  const r = run([...toArgv(approve), '--root', root])
  assert.notEqual(r.code, 2, `lệnh pp gợi ý bị chính pp từ chối vì sai đối số: "pp ${approve}"\n${r.out}`)
  assert.equal(r.code, 0, `lệnh gợi ý phải thành công, nhận:\n${r.out}`)
})

test('cùng lệnh đó xuất hiện ở `pp status` cũng phải chạy được', () => {
  const root = seedAwaitingHuman()
  const st = run(['status', 'demo', '--root', root])
  const approve = suggestedCommands(st.out).find((c) => c.startsWith('approve'))
  assert.ok(approve, `status phải nêu lệnh approve, nhận:\n${st.out}`)
  assert.match(approve, /\bdemo\b/, `lệnh gợi ý thiếu tên feature: "pp ${approve}"`)
  assert.notEqual(run([...toArgv(approve), '--root', root]).code, 2)
})

// Đường blocked: đẩy stage đỏ 3 lần cho tới `blocked`, rồi kiểm lệnh `pp unblock`
// được gợi ý. Gợi ý này từng thiếu CẢ tên feature LẪN `--reason` bắt buộc.
test('lệnh `pp unblock` mà advance gợi ý khi blocked phải chạy được', () => {
  const root = makeRoot()
  assert.equal(run(['init', 'demo', '--root', root]).code, 0)
  const dir = join(root, 'features', 'demo')
  // PRD thiếu 10-questions.md → T1 đỏ. Chạy 3 lần cho tới blocked.
  writeFileSync(join(dir, '10-prd.md'), PRD)
  for (let i = 0; i < 3; i++) run(['gate', 'demo', '10-prd', '--root', root])

  const adv = run(['advance', 'demo', '--root', root])
  assert.equal(adv.code, 3, `blocked phải exit 3, nhận:\n${adv.out}`)

  const unblock = suggestedCommands(adv.out).find((c) => c.startsWith('unblock'))
  assert.ok(unblock, `advance phải gợi ý lệnh unblock, nhận:\n${adv.out}`)
  assert.match(unblock, /\bdemo\b/, `lệnh gợi ý thiếu tên feature: "pp ${unblock}"`)
  // `--reason` là bắt buộc; gợi ý không nhắc tới nó là dặn người ta gõ một lệnh
  // chắc chắn bị từ chối.
  assert.match(unblock, /--reason/, `lệnh gợi ý thiếu --reason bắt buộc: "pp ${unblock}"`)

  // Thay placeholder <lý do> bằng lý do thật rồi chạy.
  const argv = toArgv(unblock.replace(/<[^>]*>/, 'gate sai luật, đã ghi sổ'))
  const r = run([...argv, '--root', root])
  assert.notEqual(r.code, 2, `lệnh pp gợi ý bị chính pp từ chối vì sai đối số: "pp ${unblock}"\n${r.out}`)
  assert.equal(r.code, 0, `unblock phải thành công, nhận:\n${r.out}`)
  // Và nó phải thực sự gỡ được block.
  assert.notEqual(run(['advance', 'demo', '--root', root]).code, 3)
})
