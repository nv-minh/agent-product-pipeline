// tests/helpers.js — KHÔNG phải test file (node --test không nhặt tên này).
// Dựng một repo pp thật trong thư mục tạm + artifact ĐỦ SẠCH để T1 xanh, để
// test có thể đi qua ĐƯỜNG XANH của toàn bộ vòng đời (init → gate → review →
// approve → stage kế tiếp) thay vì chỉ test đường đỏ.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

export const PP = new URL('../bin/pp', import.meta.url).pathname
export const REPO = new URL('../', import.meta.url).pathname

export function run(args, opts = {}) {
  try {
    return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8', ...opts }), stderr: '' }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || ''), stderr: e.stderr || '' }
  }
}

// Root có đủ constitution.md + schema/ + rubric/ + templates/ thật của repo.
export function makeRoot() {
  const d = mkdtempSync(join(tmpdir(), 'pp-e2e-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\nĐiều 2 — Hoàn thành là dữ kiện.\n')
  for (const sub of ['schema', 'templates', 'rubric']) {
    mkdirSync(join(d, sub), { recursive: true })
    cpSync(join(REPO, sub), join(d, sub), { recursive: true })
  }
  return d
}

export const QUESTIONS = `# Câu hỏi — demo

Q1: Ai là người dùng chính?
A: Nhân viên nội bộ đã đăng nhập.

Q2: Feedback gồm những trường nào?
A: Nội dung bắt buộc, ảnh đính kèm tuỳ chọn.

Q3: Giới hạn độ dài nội dung?
A: 2000 ký tự.

Q4: Ai được xem danh sách feedback?
A: Chỉ tài khoản có vai trò admin.

Q5: Có cần thông báo cho người gửi không?
A: Không trong phạm vi này.

Q6: Dữ liệu cũ có phải migrate không?
A: Không, bảng mới hoàn toàn.

Q7: Có yêu cầu đa ngôn ngữ không?
A: Chỉ tiếng Việt trong bản đầu.

Q8: Rollback thế nào nếu hỏng?
A: Tắt feature flag, không có migration dữ liệu.
`

export const PRD = `# PRD — demo

## User stories

<us id="US-1">Là nhân viên nội bộ, tôi muốn gửi feedback để đội sản phẩm biết vấn đề.</us>

<ac id="AC-1-1" story="US-1">
WHEN nhân viên đã đăng nhập bấm nút gửi với nội dung hợp lệ THE SYSTEM SHALL lưu feedback và trả mã 201
</ac>

<ac id="AC-1-2" story="US-1">
IF nội dung feedback rỗng THE SYSTEM SHALL trả mã 400 kèm tên trường còn thiếu
</ac>

## Out of scope

Không làm dashboard thống kê và không gửi email thông báo trong phạm vi này.

## Rủi ro

- migrate dữ liệu cũ: không áp dụng vì bảng feedback là bảng mới hoàn toàn.
- ai không được phép: tài khoản chưa đăng nhập không được gửi, trả 401.
- thao tác đồng thời: hai tab gửi cùng lúc tạo hai bản ghi độc lập, chấp nhận được.
- mạng lỗi hoặc offline: client giữ nội dung trong bộ nhớ và cho bấm gửi lại.
- giới hạn kích thước và phân trang: nội dung tối đa 2000 ký tự, danh sách trả 20 bản ghi mỗi trang.
- i18n và timezone: lưu thời điểm theo UTC, hiển thị theo múi giờ trình duyệt.
- hiệu năng khi dữ liệu lớn: đánh index theo cột created_at.
- rollback: tắt bằng feature flag, không có migration nên rollback chỉ là gỡ flag.
`

export const TESTPLAN = `# Test plan — demo

## Test cases

<tc id="TC-001" ac_ref="AC-1-1" type="positive" priority="high">
precondition: nhân viên đã đăng nhập
steps: gửi feedback với nội dung hợp lệ
expected: trả 201 và bản ghi được lưu
</tc>

<tc id="TC-002" ac_ref="AC-1-1" type="negative" priority="high">
precondition: chưa đăng nhập
steps: gửi feedback với nội dung hợp lệ
expected: trả 401 và không lưu bản ghi
</tc>

<tc id="TC-003" ac_ref="AC-1-2" type="positive" priority="medium">
precondition: nhân viên đã đăng nhập
steps: gửi feedback với nội dung rỗng
expected: trả 400 kèm tên trường còn thiếu
</tc>

<tc id="TC-004" ac_ref="AC-1-2" type="negative" priority="medium">
precondition: nhân viên đã đăng nhập
steps: gửi feedback với nội dung dài đúng 2000 ký tự
expected: trả 201, không báo lỗi rỗng
</tc>
`

// Ghi artifact sạch cho 10-prd rồi CHẠY GATE THẬT (không nhét state bằng tay)
// — đúng tinh thần Điều 2: T1 xanh là một dữ kiện trên đĩa, không phải một
// dòng JSON test tự viết.
export function passT1Prd(root, feature = 'demo') {
  const dir = join(root, 'features', feature)
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), PRD)
  const r = run(['gate', feature, '10-prd', '--root', root])
  assert.equal(r.code, 0, `gate 10-prd phải xanh, nhận:\n${r.out}`)
  return r
}

export function verdictFile(root, feature, stageId, findings = []) {
  const p = join(root, 'features', feature, `.review-${stageId}.json`)
  writeFileSync(p, JSON.stringify({ findings }))
  return p
}

// Chạy `pp` và giữ stdout/stderr TÁCH RIÊNG. Cần cho các test hook: hợp đồng
// của Claude Code là "chặn = exit 2 + lý do ra stderr", nên gộp hai luồng lại
// là mất đúng thứ đang được kiểm.
export function runSplit(args, opts = {}) {
  const r = spawnSync('node', [PP, ...args], { encoding: 'utf8', ...opts })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// Chạy chính file hook shell (không phải bin/pp) — để `dirname "$0"` bên
// trong nó thực sự được thi hành ít nhất một lần.
export function runHook(script, opts = {}) {
  const r = spawnSync('bash', [join(REPO, 'hooks', script)], { encoding: 'utf8', ...opts })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
