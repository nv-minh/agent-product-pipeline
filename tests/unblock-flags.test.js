// A4 — `unblock` TỪNG ĐỂ CHỮ KÝ CỦA CON NGƯỜI RƠI LÊN MỘT STAGE CHƯA TỪNG GATE.
//
// Chuỗi quan sát được trước bản vá:
//   pp override demo 10-prd --reason x   → status done, overridden true
//   pp unblock  demo 10-prd --reason y   → status pending, overridden VẪN true
//   pp approve  demo 10-prd              → "✓ đã duyệt", exit 0
// Kết quả: {status:'pending', gate:'pass', overridden:true, human:'approved'} trên
// một stage không có thư mục .evidence/ nào. `unblock` merge mà không tước cờ, và
// `approve` chỉ loại failed/blocked nên `pending` lọt vào nhánh mà `stageDone` đoản
// mạch trên `overridden`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, makeRoot, PRD } from './helpers.js'
import { readState, writeState } from '../lib/state.js'

function seeded(feature = 'demo') {
  const root = makeRoot()
  assert.equal(run(['init', feature, '--size', 'S', '--root', root]).code, 0)
  return { root, dir: join(root, 'features', feature) }
}

// Đẩy một stage tới `blocked` bằng gate đỏ thật (không nhét state bằng tay).
function blockIt(root, dir, feature = 'demo') {
  writeFileSync(join(dir, '10-prd.md'), PRD) // thiếu 10-questions.md → T1 đỏ
  for (let i = 0; i < 3; i++) run(['gate', feature, '10-prd', '--root', root])
  assert.equal(readState(dir).stages['10-prd'].status, 'blocked')
}

test('chuỗi override → unblock → approve bị chặn ở bước unblock', () => {
  const { root, dir } = seeded()
  assert.equal(run(['override', 'demo', '10-prd', '--reason', 'bo qua gate', '--root', root]).code, 0)

  const un = run(['unblock', 'demo', '10-prd', '--reason', 'go ra', '--root', root])
  assert.equal(un.code, 1, `unblock phải từ chối stage done, nhận:\n${un.out}`)
  assert.match(un.out, /không có gì để gỡ/)
  // Không có .evidence/ nào — và state không bị đổi thành pending.
  assert.equal(existsSync(join(dir, '.evidence')), false)
  assert.equal(readState(dir).stages['10-prd'].status, 'done')
})

test('unblock từ chối stage `done` đã được duyệt, không âm thầm huỷ approval', () => {
  const { root, dir } = seeded()
  run(['override', 'demo', '10-prd', '--reason', 'chot tay', '--root', root])
  assert.equal(run(['approve', 'demo', '10-prd', '--root', root]).code, 0)

  const un = run(['unblock', 'demo', '10-prd', '--reason', 'thu go', '--root', root])
  assert.equal(un.code, 1)
  const st = readState(dir).stages['10-prd']
  assert.equal(st.status, 'done', 'không được reset stage đang done')
  assert.equal(st.human, 'approved', 'không được âm thầm tước approval')
})

test('unblock từ chối stage `pending` (chưa chạy gì) — không có gì để gỡ', () => {
  const { root } = seeded()
  const un = run(['unblock', 'demo', '10-prd', '--reason', 'go thu', '--root', root])
  assert.equal(un.code, 1)
  assert.match(un.out, /pending/)
})

test('unblock VẪN hoạt động đúng trên stage `blocked` — reset attempts, về pending', () => {
  const { root, dir } = seeded()
  blockIt(root, dir)

  const un = run(['unblock', 'demo', '10-prd', '--reason', 'gate sai luat, da ghi so', '--root', root])
  assert.equal(un.code, 0, un.out)
  const st = readState(dir).stages['10-prd']
  assert.equal(st.status, 'pending')
  assert.equal(st.attempts, 0)
  // Và feature đi tiếp được (không còn exit 3).
  assert.notEqual(run(['advance', 'demo', '--root', root]).code, 3)
})

// Đường phòng thủ: STATE.md bị sửa tay để `blocked` mang theo cả cờ của một lần
// override lẫn một chữ ký cũ. `unblock` phải tước sạch, nếu không nó lại mở đúng
// cửa cũ. (Qua đường lệnh bình thường `recordTierRun` đã xoá `overridden` khi gate
// đỏ, nên tổ hợp này chỉ tới được bằng sửa tay — vẫn phải chặn.)
test('unblock tước sạch overridden/gate/human/reason của bản ghi cũ', () => {
  const { root, dir } = seeded()
  const s = readState(dir)
  s.stages = s.stages ?? {}
  s.stages['10-prd'] = {
    status: 'blocked',
    attempts: 3,
    gate: 'pass',
    overridden: true,
    override_count: 2,
    reason: 'ly do cu',
    human: 'approved',
    outstanding: ['t2'],
  }
  writeState(dir, s)

  assert.equal(run(['unblock', 'demo', '10-prd', '--reason', 'go that', '--root', root]).code, 0)
  const st = readState(dir).stages['10-prd']
  assert.equal(st.status, 'pending')
  assert.equal(st.attempts, 0)
  assert.equal(st.overridden, undefined, '`overridden` phải bị tước')
  assert.equal(st.gate, undefined, '`gate` của lượt cũ phải bị tước')
  assert.equal(st.human, undefined, 'chữ ký cũ phải bị tước')
  assert.equal(st.reason, undefined, 'lý do override cũ phải bị tước')
  assert.equal(st.outstanding, undefined)
  // Sổ ghi Điều 10 thì KHÔNG được xoá.
  assert.equal(st.override_count, 2, '`override_count` là sổ ghi, phải giữ')

  // Và sau khi tước, `approve` không còn duyệt được nữa.
  const ap = run(['approve', 'demo', '10-prd', '--root', root])
  assert.equal(ap.code, 1, `approve phải từ chối, nhận:\n${ap.out}`)
})

test('approve từ chối mọi trạng thái khác `done`, không chỉ failed/blocked', () => {
  const { root, dir } = seeded()
  for (const status of ['pending', 'in_progress', 'failed', 'blocked', 'skipped']) {
    const s = readState(dir)
    s.stages = { '10-prd': { status, overridden: true, gate: 'pass' } }
    writeState(dir, s)
    const r = run(['approve', 'demo', '10-prd', '--root', root])
    assert.equal(r.code, 1, `approve phải từ chối status "${status}", nhận:\n${r.out}`)
    assert.equal(readState(dir).stages['10-prd'].human, undefined, `không được ký lên status "${status}"`)
  }
})
