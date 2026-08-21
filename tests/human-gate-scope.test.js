// FINDING (adversarial review 8c825c9..44c1ecb):
//
// (1) `pp approve` không hề đọc `stage.human` — nó chỉ kiểm `status === 'done'`.
//     Nên chữ ký của con người đóng được lên stage KHÔNG có human gate:
//     `pp approve fix-500 15-fixplan` → exit 0, STATE ghi `human: approved`,
//     audit ghi một event actor:human. Spec pp-bugfix §2(Q3)/§4/§5 và Điều 9
//     chốt "mỗi pipeline ĐÚNG MỘT gate" — sổ kiểm toán của một bugfix có thể
//     chứa 3 chữ ký người mà không phân biệt được cái nào là gate thật.
//     Không mở khoá gì (upstreamGap chỉ hỏi human khi stage.human), nên đây là
//     nhiễm bẩn sổ sách, không phải bypass — nhưng sổ sách là thứ duy nhất
//     Điều 2 dựa vào.
//
// (2) `pp review-prompt` trên stage cố ý KHÔNG có T2 (`gate: ["t1"]`, ví dụ
//     15-fixplan theo spec §4.2) báo "thiếu rubric/15-fixplan.md" + exit 2 —
//     đọc như "bản cài của bạn thiếu file", đẩy người dùng đi tạo một rubric
//     cho một tầng không tồn tại. Nếu họ tạo thật thì review-record ghi được
//     evidence t2 lên stage gate:["t1"], và `tiersWithEvidence` coi mọi log tier
//     đỏ là chặn done → tự sinh một cái tắc mới.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, frontmatter, verdictFile } from './helpers.js'

const DIAGNOSIS = frontmatter('05-diagnosis', '00-brief.md', 'fix-500') + `# Diagnosis — fix-500

## Tái hiện

1. Gửi request multipart với nội dung dài 2001 ký tự.
2. Quan sát: server trả 500 thay vì 400.

Bằng chứng: log server in "TypeError: Cannot read properties of undefined".

## Root cause

Validator độ dài chỉ gắn cho nhánh JSON, không gắn cho nhánh multipart.

## Giả thuyết đã loại

- Lỗi tầng DB: loại — log cho thấy exception ném TRƯỚC câu INSERT.

## Unchanged behavior

- Gửi feedback JSON hợp lệ tối đa 2000 ký tự vẫn trả 201 và lưu bản ghi.
`

const FIXPLAN = frontmatter('15-fixplan', '05-diagnosis.md', 'fix-500') + `# Fix plan — fix-500

## Phạm vi sửa

Module validate feedback phía backend, một file.

## Hướng sửa

Đưa bước validate nội dung lên trước mọi nhánh parse.

## Rollback

Revert một commit; không có migration dữ liệu.
`

function bugfixTới15Fixplan() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-500', '--type', 'bugfix', '--root', r0]).code, 0)
  const dir = join(r0, 'features/fix-500')
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS)
  assert.equal(run(['gate', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'fix-500', '05-diagnosis', [])
  assert.equal(run(['review-record', 'fix-500', '05-diagnosis', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(run(['approve', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  writeFileSync(join(dir, '15-fixplan.md'), FIXPLAN)
  assert.equal(run(['gate', 'fix-500', '15-fixplan', '--root', r0]).code, 0)
  return { r0, dir }
}

test('approve stage human:false → exit 2, KHÔNG ghi chữ ký vào STATE', () => {
  const { r0, dir } = bugfixTới15Fixplan()
  const r = run(['approve', 'fix-500', '15-fixplan', '--root', r0])
  assert.equal(r.code, 2, r.out)
  assert.match(r.out, /15-fixplan/)
  assert.match(r.out, /không có human gate|không cần duyệt/)
  const state = readFileSync(join(dir, 'STATE.md'), 'utf8')
  const dòng15 = state.split('\n').find((l) => l.startsWith('| 15-fixplan'))
  assert.doesNotMatch(dòng15 ?? '', /approved/, `STATE không được mang chữ ký người: ${dòng15}`)
})

test('approve stage human:false KHÔNG ghi audit event approve', () => {
  const { r0, dir } = bugfixTới15Fixplan()
  run(['approve', 'fix-500', '15-fixplan', '--root', r0])
  const audit = readFileSync(join(dir, 'audit.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  const approves = audit.filter((e) => e.event === 'approve').map((e) => e.stage)
  assert.deepEqual(approves, ['05-diagnosis'], 'chỉ stage có human gate mới được có event approve')
})

test('approve stage human:true vẫn hoạt động y nguyên', () => {
  // Hồi quy: bản vá không được làm gate thật khó hơn.
  const { r0 } = bugfixTới15Fixplan()
  const st = run(['status', 'fix-500', '--root', r0])
  assert.equal(st.code, 0)
  // 05-diagnosis đã approved trong helper — chứng minh bằng advance đi tiếp
  assert.match(run(['advance', 'fix-500', '--root', r0]).out, /40-regression|15-fixplan/)
})

test('review-prompt trên stage gate:["t1"] nói ĐÚNG bản chất, không đổ cho thiếu rubric', () => {
  const { r0 } = bugfixTới15Fixplan()
  const r = run(['review-prompt', 'fix-500', '15-fixplan', '--root', r0])
  assert.equal(r.code, 2)
  assert.doesNotMatch(r.out, /thiếu rubric/)
  assert.match(r.out, /không có (tầng )?T2|chỉ gate t1/i)
})

test('review-record trên stage gate:["t1"] cũng bị từ chối cùng lý do', () => {
  const { r0, dir } = bugfixTới15Fixplan()
  writeFileSync(join(dir, '.review-15-fixplan.json'), JSON.stringify({ findings: [] }))
  const r = run(['review-record', 'fix-500', '15-fixplan', '--verdict', join(dir, '.review-15-fixplan.json'), '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /không có (tầng )?T2|chỉ gate t1/i)
  assert.ok(!existsSync(join(dir, '.evidence/15-fixplan.t2.log')), 'không được ghi evidence t2 cho stage t1-only')
})

test('review-prompt trên stage CÓ t2 vẫn chạy bình thường', () => {
  const { r0 } = bugfixTới15Fixplan()
  const r = run(['review-prompt', 'fix-500', '05-diagnosis', '--root', r0])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /RUBRIC/)
})
