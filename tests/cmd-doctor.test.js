// A1 — `pp doctor` PHẢI NÓI THẬT VỀ TẦNG THI HÀNH.
// Cả tầng chặn §5.3 nằm ngoài code: nó chỉ chạy nếu một settings.json đăng ký
// hai script trong hooks/. Trước lệnh này không có cách nào biết nó đang bật,
// nên clone mới = hook tắt im lặng trong khi STATE.md vẫn in banner đảm bảo.
// Test quan trọng nhất ở đây là test ĐẦU TIÊN: chưa đăng ký thì doctor phải ĐỎ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

// os.homedir() tôn trọng $HOME trên POSIX, nên mọi test dưới đây trỏ HOME vào
// một thư mục tạm rỗng: kết quả không phụ thuộc settings THẬT của người đang
// chạy test (nếu không, ai có hook cài ở ~/.claude sẽ thấy test xanh sai).
function isolated(extraEnv = {}) {
  return { env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'pp-home-')), ...extraEnv } }
}

function writeSettings(dir, json, name = 'settings.json') {
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', name), typeof json === 'string' ? json : JSON.stringify(json, null, 2))
}

// Cấu hình ĐẦY ĐỦ như .claude/settings.json của repo: matcher phủ cả Bash
// (A2 — không có Bash thì hook không bao giờ thấy `echo … > STATE.md`), và
// permissions.deny là tầng ép thật sự cho Bash.
const DENY_OK = [
  'Edit(features/*/STATE.md)',
  'Edit(features/*/pipeline.json)',
  'Edit(features/*/audit.jsonl)',
  'Edit(features/*/.evidence/**)',
  'Edit(features/*/.review/**)',
  'Edit(features/*/.usage/**)',
]

const HOOKS_OK = {
  permissions: { deny: DENY_OK },
  hooks: {
    PreToolUse: [{
      matcher: 'Write|Edit|NotebookEdit|Bash',
      hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/hooks/pre-tool-use.sh"' }],
    }],
    Stop: [{
      hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/hooks/stop.sh"' }],
    }],
  },
}

test('chưa đăng ký hook ở đâu → doctor ĐỎ và nói rõ script không bao giờ được gọi', () => {
  const root = makeRoot()
  const r = run(['doctor', '--root', root], isolated())
  assert.equal(r.code, 1, `phải exit 1, nhận:\n${r.out}`)
  assert.match(r.out, /hook PreToolUse\s+CHƯA đăng ký/)
  assert.match(r.out, /hook Stop\s+CHƯA đăng ký/)
  assert.match(r.out, /không bao giờ được gọi/)
})

test('đăng ký đủ hai hook ở project settings → doctor XANH', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK)
  const r = run(['doctor', '--root', root], isolated())
  assert.equal(r.code, 0, `phải exit 0, nhận:\n${r.out}`)
  assert.match(r.out, /hook PreToolUse\s+đăng ký tại/)
  assert.match(r.out, /hook Stop\s+đăng ký tại/)
  assert.match(r.out, /Tất cả kiểm tra đạt/)
})

test('doctor tìm thấy hook đăng ký ở settings.local.json', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK, 'settings.local.json')
  const r = run(['doctor', '--root', root], isolated())
  assert.equal(r.code, 0, `phải exit 0, nhận:\n${r.out}`)
  assert.match(r.out, /settings\.local\.json/)
})

test('doctor tìm thấy hook đăng ký ở ~/.claude/settings.json (user scope)', () => {
  const root = makeRoot()
  const home = mkdtempSync(join(tmpdir(), 'pp-home-'))
  writeSettings(home, HOOKS_OK)
  const r = run(['doctor', '--root', root], { env: { ...process.env, HOME: home } })
  assert.equal(r.code, 0, `phải exit 0, nhận:\n${r.out}`)
  assert.match(r.out, /hook PreToolUse\s+đăng ký tại/)
})

// settings.json méo làm Claude Code bỏ qua CẢ FILE — im lặng tắt mọi thứ trong
// đó. Đây là kiểu hỏng doctor phải gọi tên, không được báo chung là "chưa đăng ký".
test('settings.json không phải JSON hợp lệ → doctor gọi tên đúng lỗi đó', () => {
  const root = makeRoot()
  writeSettings(root, '{ "hooks": { broken json here }')
  const r = run(['doctor', '--root', root], isolated())
  assert.equal(r.code, 1, `phải exit 1, nhận:\n${r.out}`)
  assert.match(r.out, /không phải JSON hợp lệ/)
  assert.match(r.out, /CẢ FILE bị bỏ qua/)
})

// Hook đăng ký nhưng chỉ một trong hai: §5.3 có hai điểm chặn, thiếu một là
// thiếu một tầng — không được báo xanh.
test('chỉ đăng ký PreToolUse, thiếu Stop → vẫn ĐỎ', () => {
  const root = makeRoot()
  writeSettings(root, { hooks: { PreToolUse: HOOKS_OK.hooks.PreToolUse } })
  const r = run(['doctor', '--root', root], isolated())
  assert.equal(r.code, 1, `phải exit 1, nhận:\n${r.out}`)
  assert.match(r.out, /hook PreToolUse\s+đăng ký tại/)
  assert.match(r.out, /hook Stop\s+CHƯA đăng ký/)
})

// Phần doctor kiểm bằng DỮ KIỆN chứ không bằng cấu hình: nó gọi chính
// classifyPath/bashWriteTarget mà hook dùng. Mọi đường được bảo vệ phải bị chặn,
// và những đường agent cần ghi phải KHÔNG bị chặn (guard chặn tất cả cũng là
// guard hỏng — nó sẽ bị tắt, rồi không còn gì bảo vệ).
test('doctor kiểm luật guard bằng hàm thật: chặn đủ, không chặn oan', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK)
  const r = run(['doctor', '--root', root], isolated())
  // Đếm bao nhiêu đường không quan trọng (danh sách sẽ còn dài ra) — điều phải
  // đúng là KHÔNG đường nào lọt, tức hai số phải bằng nhau.
  assert.match(r.out, /luật guard-write\s+chặn đủ (\d+)\/\1/)
  assert.match(r.out, /không chặn oan\s+artifact \+ inbox verdict \+ code vẫn ghi được/)
  // A2: luật Bash cũng được kiểm bằng hàm thật, và phải KHÔNG chặn việc đọc.
  assert.match(r.out, /luật guard-write \(Bash\)\s+chặn (\d+)\/\1 đường ghi, không chặn đọc/)
})

// A2: hai tầng khác nhau — hook là heuristic bắt đường thẳng, permissions.deny mới
// là chỗ ép được Bash. doctor phải phân biệt, không gộp thành một dấu ✓.
test('matcher PreToolUse thiếu Bash → doctor cảnh báo', () => {
  const root = makeRoot()
  writeSettings(root, {
    ...HOOKS_OK,
    hooks: { ...HOOKS_OK.hooks, PreToolUse: [{ matcher: 'Write|Edit', hooks: HOOKS_OK.hooks.PreToolUse[0].hooks }] },
  })
  const r = run(['doctor', '--root', root], isolated())
  assert.match(r.out, /matcher PreToolUse\s+thiếu .*Bash/)
  assert.doesNotMatch(r.out, /Tất cả kiểm tra đạt/)
})

test('thiếu permissions.deny → doctor cảnh báo Bash vòng vo vẫn ghi được', () => {
  const root = makeRoot()
  writeSettings(root, { hooks: HOOKS_OK.hooks })
  const r = run(['doctor', '--root', root], isolated())
  assert.match(r.out, /permissions\.deny\s+chưa chặn/)
  assert.match(r.out, /Bash vòng vo vẫn ghi được/)
  assert.equal(r.code, 0, 'cảnh báo, không phải lỗi chí tử — hook vẫn đang chạy')
})

test('có permissions.deny đủ → doctor báo đạt', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK)
  const r = run(['doctor', '--root', root], isolated())
  assert.match(r.out, /permissions\.deny\s+(\d+)\/\1 đường được chặn/)
})

test('thiếu rubric/ hoặc schema/ → doctor ĐỎ vì gate/review không chạy được', () => {
  const bare = mkdtempSync(join(tmpdir(), 'pp-bare-'))
  writeFileSync(join(bare, 'constitution.md'), '# Constitution\n')
  writeFileSync(join(bare, '.pp-root'), 'marker (C4 — pp init đòi file này)\n')
  writeSettings(bare, HOOKS_OK)
  const r = run(['doctor', '--root', bare], isolated())
  assert.equal(r.code, 1, `phải exit 1, nhận:\n${r.out}`)
  assert.match(r.out, /schema\s+THIẾU/)
  assert.match(r.out, /rubric\s+THIẾU/)
})

// doctor không được tuyên bố hook "đang chạy" — nó chỉ đọc được đĩa. Giới hạn
// này phải in ra, nếu không "✓" lại thành một lời đảm bảo không kiểm chứng được
// (đúng thứ A1 tồn tại để xoá).
test('doctor luôn nói rõ giới hạn: nó không thấy được phiên Claude Code', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK)
  const r = run(['doctor', '--root', root], isolated())
  assert.match(r.out, /không thấy được phiên Claude Code/)
})

// doctor chạy được ở BẤT KỲ đâu — kể cả ngoài repo. Nó là lệnh người ta gõ
// đúng lúc "không hiểu sao hook không chạy", nên nó tuyệt đối không được crash
// khi chưa tìm ra gốc repo; phải nói thẳng thiếu gì rồi exit 1.
test('ngoài repo (không có root) → doctor không crash, báo thiếu gốc repo, exit 1', () => {
  const outside = mkdtempSync(join(tmpdir(), 'pp-outside-'))
  const r = run(['doctor'], { ...isolated(), cwd: outside })
  assert.equal(r.code, 1, `phải exit 1, nhận:\n${r.out}`)
  assert.match(r.out, /gốc product-repo\s+KHÔNG tìm thấy/)
  assert.doesNotMatch(r.out, /TypeError|ENOENT|at Object\./)
  // Luật guard không phụ thuộc root, nên phần kiểm bằng dữ kiện vẫn phải chạy.
  // Đếm bao nhiêu đường không quan trọng (danh sách sẽ còn dài ra) — điều phải
  // đúng là KHÔNG đường nào lọt, tức hai số phải bằng nhau.
  assert.match(r.out, /luật guard-write\s+chặn đủ (\d+)\/\1/)
})

// Script hook được giải nghĩa theo PACKAGE, không theo --root: một --root trỏ
// sang thư mục khác không được làm doctor báo thiếu script (chúng vẫn nằm cạnh
// lib/ này). Cùng lý do init.js resolve templates từ import.meta.url.
test('--root trỏ chỗ khác vẫn không làm doctor báo thiếu script hook', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK)
  const r = run(['doctor', '--root', root], isolated())
  assert.match(r.out, /hooks\/pre-tool-use\.sh\s+tồn tại, chạy được/)
  assert.match(r.out, /hooks\/stop\.sh\s+tồn tại, chạy được/)
})

test('doctor báo workspace đang trỏ đâu, và cảnh báo nếu nó không tồn tại', () => {
  const root = makeRoot()
  writeSettings(root, HOOKS_OK)
  const ok = run(['doctor', '--root', root, '--workspace', root], isolated())
  assert.match(ok.out, new RegExp(`workspace \\(gốc cite path\\)\\s+${root.replace(/[/\\]/g, '\\$&')}`))

  const missing = run(['doctor', '--root', root, '--workspace', join(root, 'khong-ton-tai')], isolated())
  assert.match(missing.out, /workspace.*KHÔNG tồn tại/)
})
