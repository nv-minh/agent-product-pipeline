// D3 + D4 — HAI CON SỐ QUAN SÁT ĐƯỢC TỪNG NÓI DỐI.
//
// D3  `pp report` in `st.attempts` — bộ đếm NGÂN SÁCH, bị reset về 0 khi stage
//     done. Quan sát được trên feature thật (archive-command): 40-testplan mất
//     nhiều vòng đỏ mới xanh mà report in "attempts 0" — ngưỡng tự giám sát
//     §9.4 và tiêu chí khai tử §10.4 không đo được. Sổ thật là
//     `tiers[*].attempts`, không bao giờ reset.
// D4  `state.current` không bao giờ được ghi — mọi STATE.md in
//     "current: (hoàn tất)" từ lúc init: một feature vừa sinh ra đã tự nhận
//     là xong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, completePrd, verdictFile, TESTPLAN } from './helpers.js'

function initDemo() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  return { r0, dir: join(r0, 'features', 'demo') }
}

const stateText = (dir) => readFileSync(join(dir, 'STATE.md'), 'utf8')

function failTestplanOnce(r0, dir) {
  writeFileSync(join(dir, '40-testplan.md'), '## Test cases\n')
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1, `gate phải đỏ trên testplan rỗng:\n${r.out}`)
}

function passTestplan(r0, dir) {
  writeFileSync(join(dir, '40-testplan.md'), TESTPLAN)
  assert.equal(run(['gate', 'demo', '40-testplan', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'demo', '40-testplan', [])
  assert.equal(run(['review-record', 'demo', '40-testplan', '--verdict', v, '--root', r0]).code, 0)
}

// ─── D3 ───────────────────────────────────────────────────────────────────

test('D3: stage done sau 2 vòng đỏ — report in 2, không phải cái attempts đã reset về 0', () => {
  const { r0, dir } = initDemo()
  completePrd(r0)
  failTestplanOnce(r0, dir)
  failTestplanOnce(r0, dir)
  passTestplan(r0, dir)
  const r = run(['report', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /vòng-đỏ/)
  assert.match(r.out, /40-testplan\s+done\s+2\b/)
  // 10-prd xanh ngay lần đầu: 0 vòng đỏ — số 2 kia không phải hằng số bịa.
  assert.match(r.out, /10-prd\s+done\s+0\b/)
})

test('D3: lịch sử vòng đỏ SỐNG SÓT qua unblock, và ≥3 vòng thì được nêu bật (§9.4)', () => {
  const { r0, dir } = initDemo()
  completePrd(r0)
  failTestplanOnce(r0, dir)
  failTestplanOnce(r0, dir)
  failTestplanOnce(r0, dir) // vòng 3 → blocked
  assert.equal(run(['unblock', 'demo', '40-testplan', '--reason', 'chỉ thị thiếu heading', '--root', r0]).code, 0)
  passTestplan(r0, dir)
  const r = run(['report', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  // unblock reset NGÂN SÁCH (attempts về 0) nhưng không được xoá SỔ SÁCH.
  assert.match(r.out, /40-testplan\s+done\s+3\b/)
  assert.match(r.out, /đã tốn 3 vòng đỏ thật/)
  // unblock đã ghi bài học → cảnh báo trỏ vào file CÓ THẬT.
  assert.match(r.out, /xem lessons\/40-testplan\.md/)

  // Nhánh kia của cùng cảnh báo: không có bài học nào được ghi (quan sát được
  // trên feature thật — 3 vòng đỏ tự sửa, không qua unblock/override) thì
  // không được trỏ người đọc vào một file không tồn tại.
  rmSync(join(r0, 'lessons', '40-testplan.md'))
  const r2 = run(['report', 'demo', '--root', r0])
  assert.match(r2.out, /chưa có lessons\/40-testplan\.md/)
  assert.match(r2.out, /không một dòng bài học nào được ghi/)
})

// ─── D4 ───────────────────────────────────────────────────────────────────

test('D4: STATE.md nói đúng vị trí pipeline ở mọi bước đời feature', () => {
  const { r0, dir } = initDemo()
  // Vừa init: current = stage bật đầu tiên, không phải "(hoàn tất)".
  assert.match(stateText(dir), /current: \*\*10-prd\*\*/)

  // PRD xong + duyệt: current dời sang stage kế.
  completePrd(r0)
  assert.match(stateText(dir), /current: \*\*40-testplan\*\*/)

  // Mọi stage xong: bây giờ — và chỉ bây giờ — "(hoàn tất)" là sự thật.
  passTestplan(r0, dir)
  assert.match(stateText(dir), /current: \*\*\(hoàn tất\)\*\*/)
})

test('D4: override và approve cũng dời current — không riêng đường gate', () => {
  const { r0, dir } = initDemo()
  assert.equal(run(['override', 'demo', '10-prd', '--reason', 'x', '--root', r0]).code, 0)
  // Override ép done nhưng 10-prd cần chữ ký người → pipeline vẫn đứng ở 10-prd.
  assert.match(stateText(dir), /current: \*\*10-prd\*\*/)
  assert.equal(run(['approve', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.match(stateText(dir), /current: \*\*40-testplan\*\*/)
})
