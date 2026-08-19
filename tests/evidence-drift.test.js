// tests/evidence-drift.test.js
//
// R4 (review cuối) — CHỈ ĐƯỜNG GHI ĐỌC LẠI EVIDENCE; MỌI LỆNH CHỈ-ĐỌC TIN
// THẲNG VÀO TRƯỜNG `status` TRONG STATE.md.
// Kiểm chứng được trong review: thêm một dòng `Exit status: 1` ở cột 0 vào log
// T1 của một stage đã done thì `pp status` vẫn báo `await-human`, `pp approve`
// VẪN THÀNH CÔNG và feature đi tiếp; xoá sạch cả hai log evidence của stage đó
// cũng hoàn toàn vô hình với `pp status` và `pp report`.
//
// Điều 2: `done` là KẾT LUẬN rút từ exit code trong `.evidence/`, không phải
// một cờ được tin — nên nó phải được suy lại mỗi lần đọc.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readState } from '../lib/state.js'
import { makeRoot, run, passT1Prd, verdictFile, PRD_REWRITTEN } from './helpers.js'

// Đưa 10-prd tới `done` + `approved` bằng ĐƯỜNG THẬT (T1 → T2 → approve).
function doneAndApproved() {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const dir = join(r0, 'features/demo')
  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(readState(dir).stages['10-prd'].status, 'done')
  return { r0, dir }
}

// Ba lệnh chỉ-đọc phải cùng thấy một sự thật sau khi evidence không còn đỡ nổi
// chữ `done` trong STATE.md.
function assertReadOnlyCommandsSeeDrift(r0) {
  const s = run(['status', 'demo', '--root', r0])
  assert.equal(s.code, 0)
  assert.match(s.out, /10-prd/)
  assert.match(s.out, /regate/)
  assert.match(s.out, /evidence hiện tại không còn chứng minh/)

  const a = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(a.code, 1, `approve phải từ chối, output:\n${a.out}`)

  const rep = run(['report', 'demo', '--root', r0])
  assert.equal(rep.code, 0)
  assert.match(rep.out, /done⚠/)
  assert.match(rep.out, /STATE ghi done nhưng evidence hiện tại KHÔNG chứng minh/)

  // `advance` đi qua cùng `nextStage` nên thừa hưởng luôn: quay lại chính stage
  // đó, không trôi sang stage sau.
  const adv = run(['advance', 'demo', '--root', r0])
  assert.match(adv.out, /CHỈ THỊ CHO STAGE 10-prd/)
  assert.match(adv.out, /regate/)
}

test('R4: bẻ log evidence của stage đã done thì status/approve/report đều thấy', () => {
  const { r0, dir } = doneAndApproved()
  appendFileSync(join(dir, '.evidence/10-prd.t1.log'), 'Exit status: 1\n')
  assertReadOnlyCommandsSeeDrift(r0)
})

test('R4: xoá cả hai log evidence của stage đã done cũng không còn vô hình', () => {
  const { r0, dir } = doneAndApproved()
  rmSync(join(dir, '.evidence/10-prd.t1.log'))
  rmSync(join(dir, '.evidence/10-prd.t2.log'))
  assertReadOnlyCommandsSeeDrift(r0)
})

test('R4: viết lại artifact sau khi done cũng làm status quay về regate', () => {
  const { r0, dir } = doneAndApproved()
  writeFileSync(join(dir, '10-prd.md'), PRD_REWRITTEN)
  const s = run(['status', 'demo', '--root', r0])
  assert.match(s.out, /regate/)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 1)
})

// ─── BẪY: stage `overridden` KHÔNG được rơi vào vòng re-gate vô hạn ─────────
// Nó hoàn tất bằng quyết định TAY của con người: không evidence, không
// artifact_hash, không kết quả tier. `isStale` đã miễn trừ nó từ trước — mọi
// phép kiểm mới ở R1/R3/R4 phải miễn trừ y hệt, nếu không feature không bao
// giờ hoàn tất được.
test('BẪY R4: feature có stage overridden vẫn tới đích và KHÔNG lặp', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])

  assert.equal(run(['override', 'demo', '10-prd', '--reason', 'gate nhận nhầm định dạng bảng', '--root', r0]).code, 0)
  // 10-prd có human: true — override rồi vẫn phải duyệt, và duyệt phải ĐƯỢC.
  const s1 = run(['status', 'demo', '--root', r0])
  assert.match(s1.out, /await-human/)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)

  assert.equal(run(['override', 'demo', '40-testplan', '--reason', 'chốt tay theo thoả thuận với QA', '--root', r0]).code, 0)

  for (let i = 0; i < 3; i++) {
    const s = run(['status', 'demo', '--root', r0])
    assert.equal(s.code, 0)
    assert.match(s.out, /✓ demo: mọi stage đã xong/)
    assert.doesNotMatch(s.out, /regate/)
    const a = run(['advance', 'demo', '--root', r0])
    assert.equal(a.code, 0)
    assert.match(a.out, /✓ demo: mọi stage đã xong/)
  }

  // report cũng không được vu cho stage overridden là "done⚠"
  const rep = run(['report', 'demo', '--root', r0])
  assert.doesNotMatch(rep.out, /done⚠/)
})
