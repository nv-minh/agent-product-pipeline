// A3 — VERDICT T2 PHẢI THUỘC VỀ MỘT PROMPT ĐÃ THỰC SỰ ĐƯỢC PHÁT.
//
// Trước bản vá, `review-record --verdict <file>` nhận đường dẫn bất kỳ và không gì
// nối verdict với `review-prompt`. Ba đường đi qua được:
//   (1) ghi `{"findings":[]}` là T2 xanh, chưa từng chạy review-prompt;
//   (2) REPLAY — sửa artifact rồi nộp LẠI đúng file verdict cũ, T2 lại xanh;
//   (3) chấm cho một bản artifact khác bản đã hỏi (`prompt_sha` được lưu nhưng
//       không chỗ nào so).
//
// GIỚI HẠN đã biết và cố ý: nonce KHÔNG chứng minh verdict do một subagent riêng
// viết — agent tự chạy review-prompt rồi tự viết verdict kèm nonce vẫn qua. Một CLI
// không xác minh được danh tính tác giả (spec §9.5). Test cuối file khoá đúng giới
// hạn đó để không ai đọc bộ test này rồi tưởng nó bảo đảm nhiều hơn thực tế.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { run, makeRoot, passT1Prd, rawVerdictFile, mintNonce, PRD, PRD_REWRITTEN } from './helpers.js'
import { readState } from '../lib/state.js'

function setup(feature = 'demo') {
  const root = makeRoot()
  run(['init', feature, '--size', 'S', '--root', root])
  passT1Prd(root, feature)
  return root
}

const pendingFile = (root, stage = '10-prd', feature = 'demo') =>
  join(root, 'features', feature, '.review', `${stage}.pending.json`)

test('(1) verdict không có nonce, chưa từng chạy review-prompt → từ chối, không ghi state', () => {
  const root = setup()
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [] })
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /chưa có phiếu review đang mở/)
  assert.notEqual(readState(join(root, 'features/demo')).stages?.['10-prd']?.status, 'done')
})

test('nonce sai (bịa ra) → từ chối, kể cả khi phiếu đang mở', () => {
  const root = setup()
  const real = mintNonce(root, 'demo', '10-prd')
  assert.ok(real, 'phiếu phải được phát')
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce: 'deadbeefdeadbeef00' })
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /sai nonce/)
})

test('nonce đúng → qua, và verdict được ghi bình thường', () => {
  const root = setup()
  const nonce = mintNonce(root, 'demo', '10-prd')
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce })
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /✓ 10-prd: done/)
})

test('(2) REPLAY: nộp lại đúng file verdict đã dùng → từ chối vì nonce đã tiêu thụ', () => {
  const root = setup()
  const nonce = mintNonce(root, 'demo', '10-prd')
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce })
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root]).code, 0)
  assert.equal(existsSync(pendingFile(root)), false, 'phiếu phải bị tiêu thụ sau khi ghi')

  const again = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(again.code, 1)
  assert.match(again.out, /chưa có phiếu review đang mở/)
})

// (3a) Artifact bị viết lại giữa lúc hỏi và lúc chấm. Ở stage có `t1` trong gate,
// đường này ĐÃ được `artifact_hash` (R1) chặn từ trước A3: hash T1 không còn khớp
// nên `tierPassed('t1')` false và lệnh dừng ở thông báo về T1. Test này khoá lại
// thứ tự đó — nguyên nhân báo cho người dùng phải là nguyên nhân GẦN NHẤT, và A3
// không được che nó.
test('(3a) artifact viết lại + gate có t1 → chặn ở tầng artifact_hash, báo về T1', () => {
  const root = setup()
  const dir = join(root, 'features/demo')
  const nonce = mintNonce(root, 'demo', '10-prd')
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce })

  writeFileSync(join(dir, '10-prd.md'), PRD_REWRITTEN)

  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /chưa có T1 xanh/)
  assert.notEqual(readState(dir).stages['10-prd'].status, 'done')

  // Đường ra hợp lệ: gate lại bản mới, hỏi lại, chấm lại.
  assert.equal(run(['gate', 'demo', '10-prd', '--root', root]).code, 0)
  const n2 = mintNonce(root, 'demo', '10-prd')
  assert.notEqual(n2, nonce, 'mỗi lần hỏi là một nonce mới')
  const v2 = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce: n2 })
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v2, '--root', root]).code, 0)
})

// (3b) ĐÂY mới là khe mà so `prompt_sha` bịt: stage khai `gate: ["t2"]` nên
// `t1NotPassed` không áp, `artifact_hash` của T1 cũng không có gì để so — trước A3,
// viết lại artifact rồi nộp verdict cũ là T2 xanh cho một bản reviewer chưa hề đọc.
test('(3b) gate:["t2"] + artifact viết lại sau khi phát phiếu → chặn vì drift prompt', () => {
  const root = setup()
  const dir = join(root, 'features/demo')
  const cfg = JSON.parse(readFileSync(join(dir, 'pipeline.json'), 'utf8'))
  cfg.stages['10-prd'].gate = ['t2']
  writeFileSync(join(dir, 'pipeline.json'), JSON.stringify(cfg, null, 2))

  const nonce = mintNonce(root, 'demo', '10-prd')
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce })
  writeFileSync(join(dir, '10-prd.md'), PRD_REWRITTEN)

  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /đã đổi sau khi phát prompt/)
  assert.notEqual(readState(dir).stages['10-prd'].status, 'done')
})

test('phát phiếu lần hai làm nonce lần đầu hết hiệu lực', () => {
  const root = setup()
  const first = mintNonce(root, 'demo', '10-prd')
  const second = mintNonce(root, 'demo', '10-prd')
  assert.notEqual(first, second)

  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce: first })
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /sai nonce/)
})

test('nonce xuất hiện trong output review-prompt kèm hướng dẫn chép lại', () => {
  const root = setup()
  const r = run(['review-prompt', 'demo', '10-prd', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /=== NONCE ===/)
  const nonce = JSON.parse(readFileSync(pendingFile(root), 'utf8')).nonce
  assert.match(r.out, new RegExp(nonce), 'nonce trong prompt phải là nonce đã lưu')
  assert.match(r.out, /field "nonce"/)
})

// Thứ tự kiểm tra có chủ đích: T1 chưa xanh thì thông báo phải là "T2 không được
// chạy trước T1" — nguyên nhân gần nhất — chứ không bị nonce che mất.
test('T1 chưa xanh: lý do báo về T1, không phải về nonce', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  writeFileSync(join(root, 'features/demo/10-prd.md'), PRD) // có artifact, chưa gate
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce: 'khongquantrong00' })
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 1)
  assert.match(r.out, /T1/)
  assert.doesNotMatch(r.out, /nonce/)
})

test('phiếu nằm trong .review/ nên PreToolUse guard chặn agent ghi tay', () => {
  const root = setup()
  mintNonce(root, 'demo', '10-prd')
  const r = run(['guard-write', '--path', pendingFile(root)])
  assert.equal(r.code, 2, 'phiếu phải được guard bảo vệ như phần còn lại của .review/')
})

// GIỚI HẠN — khoá thành test để không ai tưởng nonce bảo đảm nhiều hơn thực tế.
test('GIỚI HẠN đã biết: nonce KHÔNG chứng minh reviewer là một subagent riêng', () => {
  const root = setup()
  // Mô phỏng đúng kịch bản A3 không chặn được: cùng một tác nhân vừa phát phiếu
  // vừa tự viết verdict rỗng, không có reviewer nào thật sự đọc artifact.
  const nonce = mintNonce(root, 'demo', '10-prd')
  const v = rawVerdictFile(root, 'demo', '10-prd', { findings: [], nonce })
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', root])
  assert.equal(r.code, 0, 'vẫn qua — đây là giới hạn đã biết, không phải hồi quy')
  assert.match(r.out, /✓ 10-prd: done/)
})
