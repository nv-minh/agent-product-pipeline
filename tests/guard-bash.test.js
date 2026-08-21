// A2 — GUARD TỪNG CHỈ NHÌN `file_path`, NÊN BASH LỌT HOÀN TOÀN.
//
// Quan sát được trên payload thật: cùng một path, qua tool Write thì exit 2, còn
// qua Bash thì exit 0 (cho phép):
//   echo x > features/demo/STATE.md · sed -i … STATE.md · rm -rf .evidence
// `NotebookEdit` cũng lọt vì nó dùng `notebook_path`, không phải `file_path`.
//
// GIỚI HẠN cố ý: phần Bash không phải shell parser (biến, eval, base64, heredoc vẫn
// lách được) — nó là lớp phòng thủ thứ hai. Test cuối file khoá đúng giới hạn đó.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSplit } from './helpers.js'

// Một cây features/ thật trên đĩa: guard giờ realpath path, nên các test symlink
// cần file thật để phân giải.
function tree() {
  const d = mkdtempSync(join(tmpdir(), 'pp-guard-'))
  const f = join(d, 'features', 'demo')
  mkdirSync(join(f, '.evidence'), { recursive: true })
  mkdirSync(join(f, '.review'), { recursive: true })
  mkdirSync(join(f, '.usage'), { recursive: true })
  writeFileSync(join(f, 'STATE.md'), 'state')
  writeFileSync(join(f, 'audit.jsonl'), '')
  writeFileSync(join(f, 'pipeline.json'), '{}')
  writeFileSync(join(f, '10-prd.md'), 'artifact')
  writeFileSync(join(f, '.evidence', '10-prd.t1.log'), 'Exit status: 0')
  return { d, f }
}

// Chạy guard-write qua stdin với payload hook thật.
function hook(payload) {
  return runSplit(['guard-write', '--stdin'], { input: JSON.stringify(payload) })
}
const bash = (command) => hook({ tool_name: 'Bash', tool_input: { command } })

function assertBlocked(r, what) {
  assert.equal(r.code, 2, `${what} phải bị CHẶN (exit 2), nhận ${r.code}`)
  assert.ok(r.stderr.length > 0, `${what}: lý do phải ra stderr (hợp đồng hook)`)
  assert.equal(r.stdout, '', `${what}: không được in ra stdout`)
}
const assertAllowed = (r, what) => assert.equal(r.code, 0, `${what} phải được CHO QUA, nhận ${r.code}\n${r.stderr}`)

test('Bash ghi bằng chuyển hướng > và >> vào STATE.md bị chặn', () => {
  const { f } = tree()
  assertBlocked(bash(`echo x > ${join(f, 'STATE.md')}`), 'redirect >')
  assertBlocked(bash(`echo x >> ${join(f, 'STATE.md')}`), 'redirect >>')
  assertBlocked(bash(`cat a > "${join(f, 'STATE.md')}"`), 'redirect có nháy')
  assertBlocked(bash(`cat a 1> ${join(f, 'STATE.md')}`), 'redirect 1>')
})

test('Bash sửa tại chỗ (sed -i) và tee bị chặn', () => {
  const { f } = tree()
  assertBlocked(bash(`sed -i "" s/a/b/ ${join(f, 'STATE.md')}`), 'sed -i')
  assertBlocked(bash(`tee ${join(f, 'audit.jsonl')}`), 'tee')
  assertBlocked(bash(`tee -a ${join(f, 'audit.jsonl')}`), 'tee -a')
})

test('Bash xoá/di chuyển CHÍNH thư mục bằng chứng bị chặn (không cần dấu / cuối)', () => {
  const { f } = tree()
  assertBlocked(bash(`rm -rf ${join(f, '.evidence')}`), 'rm -rf .evidence')
  assertBlocked(bash(`mv ${join(f, '.review')} /tmp/z`), 'mv .review')
  assertBlocked(bash(`rm -rf ${join(f, '.usage')}`), 'rm -rf .usage')
  assertBlocked(bash(`rm ${join(f, 'STATE.md')}`), 'rm STATE.md')
})

test('script nội tuyến của trình thông dịch nhắc tới file được canh thì bị chặn', () => {
  const { f } = tree()
  assertBlocked(bash(`python3 -c "pass" ${join(f, 'STATE.md')}`), 'python3 -c')
  assertBlocked(bash(`node -e "0" ${join(f, 'pipeline.json')}`), 'node -e')
})

test('NotebookEdit dùng notebook_path — không được lọt vì tên field khác', () => {
  const { f } = tree()
  assertBlocked(hook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(f, 'STATE.md') } }), 'notebook_path')
})

test('ghi qua symlink (file và thư mục) đều bị chặn', () => {
  const { d, f } = tree()
  const fileLink = join(d, 'lach.md')
  symlinkSync(join(f, 'STATE.md'), fileLink)
  assertBlocked(hook({ tool_name: 'Write', tool_input: { file_path: fileLink } }), 'symlink tới file')

  const dirLink = join(d, 'dirlink')
  symlinkSync(f, dirLink)
  assertBlocked(hook({ tool_name: 'Write', tool_input: { file_path: join(dirLink, 'STATE.md') } }), 'symlink thư mục')
})

// Một guard chặn cả việc ĐỌC sẽ bị tắt, rồi không còn gì bảo vệ. commands/pp.md
// dặn agent hiển thị evidence log cho người dùng — việc đó phải chạy được.
test('ĐỌC file được canh vẫn cho qua — guard chặn ghi, không chặn đọc', () => {
  const { f } = tree()
  const log = join(f, '.evidence', '10-prd.t1.log')
  assertAllowed(bash(`cat ${log}`), 'cat evidence')
  assertAllowed(bash(`grep -n FAIL ${log}`), 'grep evidence')
  assertAllowed(bash(`tail -20 ${log}`), 'tail evidence')
  assertAllowed(bash(`cat ${join(f, 'STATE.md')} 2>/dev/null`), 'đọc kèm 2>/dev/null')
  assertAllowed(bash(`wc -l ${join(f, 'audit.jsonl')}`), 'wc audit')
})

test('không chặn oan: artifact stage, inbox verdict, path ngoài features/, tên gần giống', () => {
  const { d, f } = tree()
  assertAllowed(bash(`echo x > ${join(f, '10-prd.md')}`), 'ghi artifact stage')
  assertAllowed(bash(`echo x > ${join(f, '.review-10-prd.json')}`), 'ghi inbox verdict')
  assertAllowed(bash(`rm -rf ${join(d, 'build')}`), 'rm ngoài features/')
  assertAllowed(hook({ tool_name: 'Write', tool_input: { file_path: join(f, '.evidencefoo') } }), '.evidencefoo')
  assertAllowed(bash('npm test'), 'lệnh không liên quan')
  assertAllowed(bash('node bin/pp gate demo 10-prd'), 'chạy chính pp')
})

test('payload méo/thiếu vẫn fail-open (exit 0), không bao giờ chặn oan cả máy', () => {
  assert.equal(runSplit(['guard-write', '--stdin'], { input: 'khong phai json' }).code, 0)
  assert.equal(runSplit(['guard-write', '--stdin'], { input: '' }).code, 0)
  assert.equal(hook({ tool_name: 'Bash', tool_input: {} }).code, 0)
  assert.equal(hook({ tool_name: 'Bash' }).code, 0)
  assert.equal(hook({}).code, 0)
})

// GIỚI HẠN — khoá thành test để không ai đọc bộ test này rồi tưởng Bash đã được
// bịt kín. Thứ ép được Bash thật sự là permissions.deny trong .claude/settings.json
// (và sandbox.filesystem.denyWrite khi bật sandbox), không phải regex ở đây.
test('GIỚI HẠN đã biết: shell vòng vo vẫn lách được lớp heuristic này', () => {
  const { f } = tree()
  const r = bash(`P=${join(f, 'STATE.md')}; echo x > "$P"`)
  assert.equal(r.code, 0, 'đây là giới hạn đã biết, không phải hồi quy — xem permissions.deny')
})
