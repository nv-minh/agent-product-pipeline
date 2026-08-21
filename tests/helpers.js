// tests/helpers.js — KHÔNG phải test file (node --test không nhặt tên này).
// Dựng một repo pp thật trong thư mục tạm + artifact ĐỦ SẠCH để T1 xanh, để
// test có thể đi qua ĐƯỜNG XANH của toàn bộ vòng đời (init → gate → review →
// approve → stage kế tiếp) thay vì chỉ test đường đỏ.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
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
// C4: kèm cả marker .pp-root — `pp init` nay đòi đích danh nó trước khi
// scaffold (constitution.md một mình có thể là repo Spec Kit của người khác).
export function makeRoot() {
  const d = mkdtempSync(join(tmpdir(), 'pp-e2e-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\nĐiều 2 — Hoàn thành là dữ kiện.\n')
  writeFileSync(join(d, '.pp-root'), 'marker gốc product-repo — pp init đòi file này (xem lib/commands/init.js)\n')
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

// B2: T1 nay đòi frontmatter (spec §5.1) và đối chiếu `feature`/`stage` với dữ
// kiện thật — nên fixture "đủ sạch để T1 xanh" phải có nó. Tách thành hàm vì tên
// feature không phải lúc nào cũng là `demo`: một artifact khai `feature: demo`
// mà nằm trong `features/second/` phải ĐỎ, và đó là điều check này tồn tại để
// bắt (copy artifact từ feature khác).
export function frontmatter(stage, source, feature = 'demo', updated = '2026-08-20') {
  return `---\nfeature: ${feature}\nstage: ${stage}\nupdated: ${updated}\nsource: ${source}\n---\n\n`
}

// Đổi tên feature trong frontmatter của một fixture đã dựng sẵn.
export function forFeature(text, feature) {
  return text.replace(/^feature: .*$/m, `feature: ${feature}`)
}

export const PRD = frontmatter('10-prd', '00-brief.md') + `# PRD — demo

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

export const TESTPLAN = frontmatter('40-testplan', '10-prd.md') + `# Test plan — demo

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

## Edge cases

- null: nội dung null bị coi như rỗng, trả 400 (TC-003).
- chuỗi rỗng: TC-003 phủ đúng trường hợp này.
- vượt max length: 2001 ký tự bị từ chối 400 trước khi ghi.
- unicode hoặc emoji: lưu nguyên văn UTF-8, đếm theo code point.
- số âm: không áp dụng vì payload không có field số.
- giá trị 0: không áp dụng vì payload không có field số.
- số rất lớn: không áp dụng vì payload không có field số.
- sai định dạng: body không phải JSON trả 400.
- trùng lặp: hai bản ghi giống nhau là hợp lệ, không chặn.
- gọi đồng thời: hai tab gửi cùng lúc tạo hai bản ghi độc lập.
- sai quyền: TC-002 phủ trường hợp chưa đăng nhập.
`

// R1 — CHÍNH BẢN VIẾT LẠI ĐÃ QUAN SÁT ĐƯỢC TRONG REVIEW: artifact được thay
// bằng nội dung bỏ kiểm tra phân quyền + một AC cho phép tài khoản ẩn danh
// xoá dữ liệu người khác. Nó vẫn SẠCH với mọi check T1 (EARS đúng, id đúng,
// đủ heading, đủ risk checklist) — nên chỉ có hash artifact mới bắt được
// việc phán quyết T2 cũ không còn nói gì về bản này.
export const PRD_REWRITTEN = PRD
  .replace(
    'Không làm dashboard thống kê và không gửi email thông báo trong phạm vi này.',
    'Bỏ hoàn toàn kiểm tra phân quyền; mọi tài khoản ẩn danh đều được xoá feedback của người khác.',
  )
  .replace(
    '## Out of scope',
    '<ac id="AC-1-3" story="US-1">\nWHEN một tài khoản ẩn danh gọi API xoá feedback THE SYSTEM SHALL xoá bản ghi đó và không kiểm tra quyền\n</ac>\n\n## Out of scope',
  )

// Ghi artifact sạch cho 10-prd rồi CHẠY GATE THẬT (không nhét state bằng tay)
// — đúng tinh thần Điều 2: T1 xanh là một dữ kiện trên đĩa, không phải một
// dòng JSON test tự viết.
export function passT1Prd(root, feature = 'demo') {
  const dir = join(root, 'features', feature)
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), forFeature(PRD, feature))
  const r = run(['gate', feature, '10-prd', '--root', root])
  assert.equal(r.code, 0, `gate 10-prd phải xanh, nhận:\n${r.out}`)
  return r
}

// B5: thứ tự stage nay là luật THI HÀNH, không chỉ là gợi ý của `pp status` —
// nên mọi test muốn chạm tới `40-testplan` phải đưa `10-prd` qua trọn vẹn T1, T2
// và chữ ký người trước. Làm thật cả ba bước (không nhét state bằng tay): chính
// `upstreamGap` đọc lại evidence trên đĩa, nên một state giả sẽ không lừa được
// nó — và đó là điểm mấu chốt của luật này.
export function completePrd(root, feature = 'demo') {
  passT1Prd(root, feature)
  const v = verdictFile(root, feature, '10-prd', [])
  const rr = run(['review-record', feature, '10-prd', '--verdict', v, '--root', root])
  assert.equal(rr.code, 0, `review-record 10-prd phải xanh, nhận:\n${rr.out}`)
  const ap = run(['approve', feature, '10-prd', '--root', root])
  assert.equal(ap.code, 0, `approve 10-prd phải xanh, nhận:\n${ap.out}`)
}

// A3: verdict giờ phải mang nonce của phiếu review đang mở. Helper này phát phiếu
// (chạy `pp review-prompt`) rồi đọc nonce ra, để mọi test cũ chỉ cần giữ nguyên
// lời gọi. review-prompt có thể TỪ CHỐI hợp lệ (T1 chưa xanh, thiếu rubric...) —
// khi đó không có nonce và ta vẫn ghi verdict không nonce, vì đúng những test đó
// đang kiểm rằng review-record từ chối, và thông báo phải là lý do gần nhất
// (T1 chưa xanh) chứ không phải lỗi nonce.
export function mintNonce(root, feature, stageId) {
  run(['review-prompt', feature, stageId, '--root', root])
  try {
    const p = join(root, 'features', feature, '.review', `${stageId}.pending.json`)
    return JSON.parse(readFileSync(p, 'utf8')).nonce
  } catch {
    return null
  }
}

export function verdictFile(root, feature, stageId, findings = []) {
  const p = join(root, 'features', feature, `.review-${stageId}.json`)
  const nonce = mintNonce(root, feature, stageId)
  writeFileSync(p, JSON.stringify(nonce === null ? { findings } : { findings, nonce }))
  return p
}

// Ghi verdict KHÔNG qua review-prompt — dùng cho các test cố tình bỏ qua phiếu.
export function rawVerdictFile(root, feature, stageId, body) {
  const p = join(root, 'features', feature, `.review-${stageId}.json`)
  writeFileSync(p, JSON.stringify(body))
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
