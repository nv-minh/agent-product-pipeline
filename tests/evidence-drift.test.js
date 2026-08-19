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
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readState } from '../lib/state.js'
import { makeRoot, run, passT1Prd, verdictFile, PRD_REWRITTEN, TESTPLAN } from './helpers.js'

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

// ─── F4: `report` và `status` phải nói CÙNG một chuyện về cùng một stage ───
// Phép kiểm drift của `report` chỉ gọi `stageDone`, không gọi `isStale` — nên
// một stage bị stale vì input thượng nguồn đổi in ra `done` sạch bong ở
// `report` trong khi `pp status` nói `regate`. Hai lệnh nói ngược nhau thì
// `report` mất giá trị làm mặt bằng kiểm toán.
//
// Dựng một feature có ĐỦ ba hình dạng ô trong cùng một bảng: `done⚠`
// (10-prd, stale), `skipped` (20-ux, disabled) và `in_progress` (40-testplan,
// mới xong T1) — cũng chính là hai hàng làm gãy `padEnd(10)`.
function staleAndInProgress() {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'M', '--root', r0]) // template M có 20-ux enabled=false
  const dir = join(r0, 'features/demo')

  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)

  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  assert.equal(run(['gate', 'demo', '40-testplan', '--root', r0]).code, 0)

  // Input thượng nguồn của 10-prd đổi SAU KHI nó đã done: evidence vẫn sạch,
  // artifact vẫn nguyên — chỉ `isStale` mới thấy.
  writeFileSync(join(dir, '00-brief.md'), 'brief đã đổi hoàn toàn\n')
  return { r0, dir }
}

test('F4: stage stale thượng nguồn — report và status nói cùng một chuyện', () => {
  const { r0 } = staleAndInProgress()

  const s = run(['status', 'demo', '--root', r0])
  assert.equal(s.code, 0)
  assert.match(s.out, /stage kế tiếp : 10-prd/)
  assert.match(s.out, /regate/)

  const rep = run(['report', 'demo', '--root', r0])
  assert.equal(rep.code, 0)
  assert.match(rep.out, /done⚠/)
  assert.match(rep.out, /INPUT THƯỢNG NGUỒN đã đổi/)
  // và phải PHÂN BIỆT được với ca "evidence không còn chứng minh"
  assert.doesNotMatch(rep.out, /evidence hiện tại KHÔNG chứng minh/)
})

// Vị trí HIỂN THỊ (không phải chỉ số JS) nơi từng ô của một dòng bảng bắt đầu.
// `⚠` (U+26A0) là một đơn vị mã JS nhưng chiếm hai cột trên terminal — đúng
// thứ `padEnd` không biết.
function cellStarts(line) {
  const starts = []
  let col = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ' ' && (i === 0 || line[i - 1] === ' ')) starts.push(col)
    col += line[i] === '⚠' ? 2 : 1
  }
  return starts
}

test('F4: cột bảng report không gãy vì in_progress hay done⚠', () => {
  const { r0 } = staleAndInProgress()
  const lines = run(['report', 'demo', '--root', r0]).out.split('\n')

  const head = lines.find((l) => /^ {2}stage\s/.test(l))
  assert.ok(head, 'không tìm thấy dòng tiêu đề bảng')
  const rows = lines.filter((l) => /^ {2}(10-prd|20-ux|40-testplan)\s/.test(l))
  assert.equal(rows.length, 3, `mong 3 hàng, nhận:\n${rows.join('\n')}`)
  assert.ok(rows.some((l) => l.includes('done⚠')), 'thiếu hàng done⚠')
  assert.ok(rows.some((l) => l.includes('in_progress')), 'thiếu hàng in_progress')

  for (const row of rows) {
    assert.deepEqual(cellStarts(row), cellStarts(head), `cột lệch:\n${head}\n${row}`)
  }
})

// ─── F3: ARTIFACT VẮNG MẶT ⇒ KHÔNG TIER NÀO ĐÃ QUA ─────────────────────────
// R1 ghi kèm mỗi kết quả tier một `artifact_hash`, nhưng "không có artifact"
// được biểu diễn bằng chuỗi `'missing'` — và nó khớp với chính nó. Nên một
// `gate: ["t2"]` viết tay tới `done` chỉ bằng phán quyết của LLM trong khi
// artifact KHÔNG TỒN TẠI trên đĩa.
test('F3: gate:["t2"] viết tay + artifact VẮNG MẶT không tới được done', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const dir = join(r0, 'features/demo')

  // Chỉ đòi t2 (đúng hình dạng R3 mô tả), và KHÔNG viết 10-prd.md.
  const cfg = JSON.parse(readFileSync(join(dir, 'pipeline.json'), 'utf8'))
  cfg.stages['10-prd'].gate = ['t2']
  writeFileSync(join(dir, 'pipeline.json'), JSON.stringify(cfg, null, 2))

  const v = verdictFile(r0, 'demo', '10-prd', [])
  const rr = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.doesNotMatch(rr.out, /✓ 10-prd: done/)
  assert.match(rr.out, /⏳ 10-prd: CHƯA done/)
  // ghi chú phải NÊU ĐÍCH DANH việc artifact vắng mặt, không nói "đã bị sửa"
  assert.match(rr.out, /artifact 10-prd\.md KHÔNG CÓ trên đĩa/)

  assert.notEqual(readState(dir).stages['10-prd'].status, 'done')
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 1)
})

test('F3: xoá artifact của một stage đang done thì stage rơi khỏi done', () => {
  const { r0, dir } = doneAndApproved()
  rmSync(join(dir, '10-prd.md'))

  const s = run(['status', 'demo', '--root', r0])
  assert.equal(s.code, 0)
  assert.match(s.out, /regate/)

  const a = run(['approve', 'demo', '10-prd', '--root', r0])
  assert.equal(a.code, 1, `approve phải từ chối, output:\n${a.out}`)
  assert.match(a.out, /artifact 10-prd\.md KHÔNG CÓ trên đĩa/)

  const rep = run(['report', 'demo', '--root', r0])
  assert.match(rep.out, /done⚠/)
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
