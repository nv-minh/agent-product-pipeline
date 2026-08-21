// B5 + B6 — THỨ TỰ STAGE VÀ ĐỘ TƯƠI CỦA INPUT PHẢI ĐƯỢC THI HÀNH, KHÔNG CHỈ
// ĐƯỢC GỢI Ý.
//
// Hai lỗ hổng đã tái lập được trên một feature vừa `pp init`, không sửa tay gì:
//
// B5  pp gate demo 40-testplan          → exit 0
//     pp review-record demo 40-testplan → "✓ 40-testplan: done"
//     trong khi 10-prd = in_progress, human = (chưa duyệt)
//     → test plan done trước cả khi PRD nó truy vết tới được người duyệt; human
//       gate #1 bị đi vòng chỉ bằng cách gõ lệnh kế tiếp.
//
// B6  10-prd done + T2 xanh, rồi nối thêm một dòng vào 00-brief.md:
//     pp status  demo        → regate ("input thượng nguồn đã đổi")
//     pp approve demo 10-prd → "✓ đã duyệt", exit 0
//     → hai lệnh nói ngược nhau về CÙNG một stage, và chữ ký của người đặt lên
//       một PRD viết cho bản brief khác.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readState } from '../lib/state.js'
import { makeRoot, run, passT1Prd, completePrd, verdictFile, PRD, TESTPLAN } from './helpers.js'

function feature(size = 'S') {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', size, '--root', r0]).code, 0)
  return { r0, dir: join(r0, 'features/demo') }
}

const evidence = (dir, stageId, tier) => join(dir, '.evidence', `${stageId}.${tier}.log`)

// ─── B5 ───────────────────────────────────────────────────────────────────

test('B5: gate stage hạ nguồn khi thượng nguồn chưa chạy thì bị từ chối, không để lại dấu vết', () => {
  const { r0, dir } = feature()
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)

  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /chưa tới lượt 40-testplan/)
  assert.match(r.out, /10-prd chưa done \(đang "pending"\)/)

  // Bị từ chối TRƯỚC khi chạy: không evidence, không bản ghi stage nào.
  assert.equal(existsSync(evidence(dir, '40-testplan', 't1')), false)
  assert.equal(readState(dir).stages?.['40-testplan'], undefined)
})

test('B5: T1 xanh nhưng CHƯA có chữ ký người thì hạ nguồn vẫn bị chặn', () => {
  const { r0, dir } = feature()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(readState(dir).stages['10-prd'].status, 'done')

  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /đã done nhưng CHƯA được người duyệt/)

  // Và chính chữ ký đó mở đường — đây là điều lỗ hổng B5 đã bỏ qua.
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(run(['gate', 'demo', '40-testplan', '--root', r0]).code, 0)
})

test('B5: T2 cũng không đi vòng được — review-prompt và review-record đều từ chối', () => {
  const { r0, dir } = feature()
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)

  const p = run(['review-prompt', 'demo', '40-testplan', '--root', r0])
  assert.equal(p.code, 1)
  assert.match(p.out, /chưa tới lượt 40-testplan/)

  // Verdict tự viết (không có phiếu nào được phát) cũng không ghi được.
  const vf = join(dir, '.review-40-testplan.json')
  writeFileSync(vf, JSON.stringify({ findings: [] }))
  const rec = run(['review-record', 'demo', '40-testplan', '--verdict', vf, '--root', r0])
  assert.equal(rec.code, 1)
  // Nguyên nhân GỐC (thứ tự) phải được nói trước nguyên nhân gần (T1 chưa xanh):
  // khuyên "chạy pp gate 40-testplan trước" là khuyên một lệnh cũng sẽ bị từ chối.
  assert.match(rec.out, /chưa tới lượt 40-testplan/)
  assert.doesNotMatch(rec.out, /chưa có T1 xanh/)
  assert.equal(existsSync(evidence(dir, '40-testplan', 't2')), false)
})

test('B5: luật đọc EVIDENCE, không đọc trường status — xoá log T1 của thượng nguồn là chặn lại', () => {
  const { r0, dir } = feature()
  completePrd(r0)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  assert.equal(run(['gate', 'demo', '40-testplan', '--root', r0]).code, 0)

  // STATE.md vẫn ghi done + approved; chỉ bằng chứng biến mất.
  rmSync(evidence(dir, '10-prd', 't1'))
  const st = readState(dir).stages['10-prd']
  assert.equal(st.status, 'done')
  assert.equal(st.human, 'approved')

  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /ghi done nhưng evidence hiện tại KHÔNG chứng minh/)
})

test('B5: stage đầu tiên không bao giờ bị chặn, và stage bị tắt không chặn ai', () => {
  // template M có 20-ux enabled=false, nằm GIỮA 10-prd và 40-testplan.
  const { r0, dir } = feature('M')
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0]).code, 1) // đỏ vì thiếu artifact, KHÔNG phải vì thứ tự
  assert.doesNotMatch(run(['gate', 'demo', '10-prd', '--root', r0]).out, /chưa tới lượt/)

  completePrd(r0)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 0, r.out)
  assert.equal(readState(dir).stages['20-ux'].status, 'skipped')
})

// Kỳ vọng đầu tiên của tôi ở test này SAI, và cái sai đó đáng ghi lại: tôi tưởng
// `override` thượng nguồn là thông đường luôn. Không — 10-prd khai `human: true`,
// nên override (một quyết định "tôi xét thấy chấp nhận được về nội dung") vẫn
// KHÔNG thay được chữ ký ở human gate. Đúng như `nextStage` đã đòi từ trước: một
// stage `overridden` mà chưa `approved` thì `pp status` trả về `await-human`. Hai
// cửa khác nhau, không cửa nào mở hộ cửa nào.
test('B5: override thượng nguồn KHÔNG thay được chữ ký người; approve sau override thì thông đường', () => {
  const { r0, dir } = feature()
  assert.equal(run(['override', 'demo', '10-prd', '--reason', 'chốt tay với PO', '--root', r0]).code, 0)
  // override ép TRẠNG THÁI, nó không viết artifact — 40-testplan vẫn cần
  // 10-prd.md thật trên đĩa để truy vết. Đây là điều đang được kiểm: luật thứ tự,
  // không phải nội dung.
  writeFileSync(join(dir, '10-prd.md'), PRD)
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)

  const blocked = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(blocked.code, 1)
  assert.match(blocked.out, /CHƯA được người duyệt/)
  assert.match(run(['status', 'demo', '--root', r0]).out, /await-human/)

  // `approve` trên một stage overridden vẫn được (stageDone miễn trừ nó) — nên
  // cửa thoát hiểm không tạo ra chỗ tắc không có lối ra.
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 0, r.out)
})

// `unblock` và `override` KHÔNG bị luật thứ tự chặn: chúng là lệnh của người,
// dùng đúng lúc pipeline đang tắc. Bịt chúng lại là tạo ra một cái tắc không có
// lối ra.
test('B5: lệnh của người (override/unblock) không bị luật thứ tự chặn', () => {
  const { r0 } = feature()
  assert.equal(run(['override', 'demo', '40-testplan', '--reason', 'QA đã chốt ngoài luồng', '--root', r0]).code, 0)
  const st = readState(join(r0, 'features/demo')).stages['40-testplan']
  assert.equal(st.status, 'done')
  assert.equal(st.override_count, 1)
})

// ─── B6 ───────────────────────────────────────────────────────────────────

test('B6: approve bị từ chối khi input thượng nguồn đã đổi — cùng câu trả lời với pp status', () => {
  const { r0, dir } = feature()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)

  // 00-brief.md là input khai báo của 10-prd. Đổi nó = PRD đang nói về bản khác.
  appendFileSync(join(dir, '00-brief.md'), '\nMọi yêu cầu ở trên bị thay bằng: cho phép ẩn danh xoá dữ liệu.\n')

  const s = run(['status', 'demo', '--root', r0])
  assert.match(s.out, /regate/)

  const a = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(a.code, 1)
  assert.match(a.out, /INPUT THƯỢNG NGUỒN đã đổi/)
  assert.notEqual(readState(dir).stages['10-prd'].human, 'approved')
})

test('B6: gate lại trên bản hiện tại thì duyệt được — không phải cụt đường', () => {
  const { r0, dir } = feature()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  appendFileSync(join(dir, '00-brief.md'), '\nbrief bổ sung một dòng\n')
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 1)

  // Chạy lại đủ cả hai tier trên bản input mới, rồi duyệt.
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0]).code, 0)
  const v2 = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v2, '--root', r0]).code, 0)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(readState(dir).stages['10-prd'].human, 'approved')
})

// `isStale` gọi `hashInputs`, hàm này NÉM khi một input bắt buộc không còn trên
// đĩa — nên `approve` phải từ chối bằng thông báo, không phải bằng stack trace.
// Không băm được = không chứng minh được là còn tươi = coi như đã đổi.
test('B6: input thượng nguồn bị XOÁ thì approve từ chối gọn, không nổ stack trace', () => {
  const { r0, dir } = feature()
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)

  rmSync(join(dir, '00-brief.md'))
  const a = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(a.code, 1)
  assert.match(a.out, /INPUT THƯỢNG NGUỒN đã đổi/)
  assert.doesNotMatch(a.out, /at Object\.|Error:/)
})

test('B6: stage overridden vẫn duyệt được — override không có inputs_hash để mà stale', () => {
  const { r0 } = feature()
  assert.equal(run(['override', 'demo', '10-prd', '--reason', 'chốt tay', '--root', r0]).code, 0)
  const a = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(a.code, 0, a.out)
})

// ─── B4 ───────────────────────────────────────────────────────────────────

test('B4: --tier với giá trị khác t1 bị từ chối thẳng, không âm thầm chạy T1', () => {
  const { r0, dir } = feature()
  writeFileSync(join(dir, '10-prd.md'), 'bất kỳ')

  const r = run(['gate', 'demo', '10-prd', '--root', r0, '--tier', 't2'])
  assert.equal(r.code, 2) // đối số sai — gate chưa hề chạy
  assert.match(r.out, /--tier "t2" không hợp lệ/)
  assert.match(r.out, /pp review-record demo 10-prd/)
  // Điểm mấu chốt của B4: bản cũ GHI evidence t1 cho một lệnh xin t2.
  assert.equal(existsSync(evidence(dir, '10-prd', 't1')), false)
})

test('B4: --tier không có giá trị cũng bị từ chối, không crash', () => {
  const { r0 } = feature()
  const r = run(['gate', 'demo', '10-prd', '--root', r0, '--tier'])
  assert.equal(r.code, 2)
  assert.match(r.out, /không có giá trị/)
})

test('B4: --tier t1 (và không có --tier) chạy bình thường', () => {
  const { r0 } = feature()
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0, '--tier', 't1']).code, 1) // đỏ vì thiếu artifact
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0, '--tier', 'T1']).code, 1) // hoa/thường như nhau
  passT1Prd(r0)
})

test('B4: header evidence là lệnh CHẠY ĐƯỢC, tái lập đúng lần chạy đã ghi', () => {
  const { r0, dir } = feature()
  passT1Prd(r0)
  const head = readFileSync(evidence(dir, '10-prd', 't1'), 'utf8').split('\n')[0]
  // Bản cũ in `pp gate 10-prd --tier t1`: thiếu tên feature nên gõ lại là exit 2.
  assert.match(head, /pp gate demo 10-prd$/)

  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  const head2 = readFileSync(evidence(dir, '10-prd', 't2'), 'utf8').split('\n')[0]
  assert.match(head2, /pp review-record demo 10-prd --verdict <file\.json>$/)

  // Và lệnh đó thật sự chạy được (không phải chỉ trông giống lệnh).
  assert.notEqual(run(['gate', 'demo', '10-prd', '--root', r0]).code, 2)
})
