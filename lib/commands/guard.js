import { join, resolve, dirname, basename } from 'node:path'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { readState } from '../state.js'
import { parseArgs } from '../args.js'

// ─────────────────────────────────────────────────────────────────────────
// FIX review cuối (finding 5) — HAI HOOK TRƯỚC ĐÂY VÔ HIỆU HOÀN TOÀN.
// Hợp đồng hook của Claude Code: **exit 2 mới là tín hiệu CHẶN, và lý do phải
// ra stderr**; mọi exit khác 0 chỉ là "lỗi không chặn" — tool call vẫn chạy.
// Code cũ in ra stdout rồi return 1, nên một `PreToolUse` nối vào đây chỉ ghi
// một dòng lỗi rồi VẪN CHO GHI FILE. Cả tầng "PreToolUse chặn agent ghi
// STATE.md" của §5.3 chỉ là cảm giác an toàn giả.
const BLOCK = 2
const ALLOW = 0

function block(message) {
  process.stderr.write(message)
  return BLOCK
}
// ─────────────────────────────────────────────────────────────────────────

// CORRECTION so với brief: chặn theo "/STATE.md$" hoặc "/.evidence/" ở BẤT
// KỲ đâu trên máy là quá rộng — một project không liên quan có file
// STATE.md của riêng họ sẽ bị chặn oan. guard-write chạy trên MỌI Write/Edit
// của MỌI project (hook PreToolUse toàn cục), nên chỉ được chặn khi path
// thực sự nằm trong một feature dir của pipeline này: phải có segment
// /features/ rồi sau đó mới là STATE.md hoặc .evidence/.
//
// FIX review Task 12 (finding 1, CRITICAL): APFS mặc định case-insensitive
// (state.md === STATE.md === STATE.MD là CÙNG một file trên máy này), nên
// regex phải case-insensitive (cờ `i`) — nếu không, `state.md` hay
// `Features/demo/STATE.md` lách qua guard rồi âm thầm ghi đè đúng file
// STATE.md thật. Đây chính là đường vòng mà cả task này tồn tại để chặn.
const FEATURES_STATE = /\/features\/.*\/STATE\.md$/i
// A2 — CHÍNH THƯ MỤC CŨNG PHẢI ĐƯỢC CANH, KHÔNG CHỈ NỘI DUNG BÊN TRONG.
// Ba regex thư mục trước đây đòi có dấu `/` NGAY SAU tên, nên `.evidence/x.log` bị
// chặn còn `.evidence` (chính thư mục) thì lọt — tức `rm -rf features/demo/.evidence`
// và `mv features/demo/.evidence /tmp` xoá sạch bằng chứng mà guard không thấy gì.
// Lỗ này có sẵn ở cả đường Write (`guard-write --path .../.evidence` exit 0), không
// phải hệ quả của việc thêm Bash. `(?:\/|$)` khớp cả thư mục lẫn mọi thứ trong nó,
// và vẫn KHÔNG khớp `.evidencefoo`.
const FEATURES_EVIDENCE = /\/features\/.*\/\.evidence(?:\/|$)/i
// FIX review cuối (finding 6): `pipeline.json` cũng phải được canh. Một agent
// chỉ có tool Write đã có thể ghi đè nó để `enabled: false` mọi stage (rồi
// `pp status` báo feature hoàn tất với 0 gate được chạy), hoặc lật
// `human: true` thành `false` để human gate im lặng biến mất. Cùng kiểu khớp
// case-insensitive + chuẩn hoá path như STATE.md/.evidence/.
const FEATURES_PIPELINE = /\/features\/.*\/pipeline\.json$/i
// Sổ kiểm toán (audit.jsonl), bản lưu vĩnh viễn verdict reviewer (.review/)
// và token thật khai thác từ transcript (.usage/) là bằng chứng do `pp` sinh.
// Agent sửa tay các file này là làm GIẢ evidence — cùng nghiêm trọng với ghi
// đè STATE.md, nên cùng bị canh. Lưu ý: chỉ dir `.review/` bị chặn; file
// `.review-<stage>.json` ở GỐC feature là inbox conductor NỘP verdict cho
// pp (agent bàn giao dữ liệu thô — đúng thiết kế) và KHÔNG bị chặn.
const FEATURES_AUDIT = /\/features\/.*\/audit\.jsonl$/i
const FEATURES_REVIEW_DIR = /\/features\/.*\/\.review(?:\/|$)/i
const FEATURES_USAGE_DIR = /\/features\/.*\/\.usage(?:\/|$)/i

// FIX review Task 12 (finding 3, Important): path tương đối (không có `/`
// đầu) phải được resolve theo cwd TRƯỚC khi so khớp, nếu không
// `features/demo/STATE.md` (không có `/` đầu) lọt qua trong khi
// `./features/demo/STATE.md` bị chặn — không nhất quán, và là một đường
// vòng khác (agent chỉ cần bỏ dấu `/` đầu).
// A2: `realpath` cả path TRƯỚC khi so khớp. Chỉ `resolve` thì một symlink trỏ tới
// STATE.md lọt qua (`ln -s features/demo/STATE.md x` rồi ghi `x` — path `x` không
// khớp regex nào). realpathSync có thể ném khi path chưa tồn tại (đúng trường hợp
// tạo file mới), nên thử realpath THƯ MỤC CHA rồi ghép lại tên file: bắt được cả
// symlink ở tầng thư mục (`ln -s features/demo ev` → `ev/STATE.md`).
function resolvePath(rawPath) {
  if (!rawPath) return ''
  const abs = rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath)
  try {
    return realpathSync(abs)
  } catch {
    try {
      return join(realpathSync(dirname(abs)), basename(abs))
    } catch {
      return abs
    }
  }
}

// Bảng luật, khai báo một lần. `classifyPath` chỉ TRẢ LỜI "path này có bị chặn
// không và vì sao"; việc ghi stderr + chọn exit code nằm ở `checkPath`. Tách ra
// để `pp doctor` kiểm được CHÍNH những luật này bằng cách gọi hàm thật, thay vì
// tự viết lại một bản copy sẽ trôi khỏi bản gốc (và rồi báo "ổn" cho một guard
// đã hỏng).
const RULES = [
  [FEATURES_STATE, 'pp: STATE.md chỉ được ghi bởi `pp`. Dùng `pp gate` / `pp approve`.\n'],
  [FEATURES_EVIDENCE, 'pp: .evidence/ chỉ được ghi bởi `pp`. Hoàn thành là dữ kiện, không phải lời khai.\n'],
  [FEATURES_PIPELINE, 'pp: pipeline.json chỉ được ghi bởi `pp init` / người dùng. Sửa nó là tắt gate và xoá human gate.\n'],
  [FEATURES_AUDIT, 'pp: audit.jsonl chỉ được ghi bởi `pp` — sổ kiểm toán không được sửa tay.\n'],
  [FEATURES_REVIEW_DIR, 'pp: .review/ chỉ được ghi bởi `pp` — bản lưu verdict không được sửa tay.\n'],
  [FEATURES_USAGE_DIR, 'pp: .usage/ chỉ được ghi bởi `pp usage-sync` — token là dữ kiện khai thác được, không phải số tự viết.\n'],
]

// FINDING (review 8c825c9..44c1ecb): realpath một mình vừa đóng một đường, vừa
// mở đường ngược. Nó bắt được symlink TRỎ TỚI file bảo vệ (A2), nhưng một
// symlink THƯ MỤC trong features/ (`ln -s /tmp/x features/evil`) làm realpath ra
// `/tmp/x/STATE.md` — không khớp regex `features/.../STATE.md` nào nữa, nên
// guard CHO GHI đúng cái file mà cả hệ thống dựa vào. Agent tạo được symlink đó
// bằng Bash: `ln` chỉ bị chặn khi một token khớp path bảo vệ.
//
// So luật trên CẢ HAI dạng: path đã resolve (giữ nguyên symlink) và path đã
// realpath. Một trong hai khớp là chặn — không có cách nào dùng symlink để
// biến một path bảo vệ thành path thường, theo hướng nào cũng vậy.
export function classifyPath(rawPath) {
  if (!rawPath) return { blocked: false, message: '' }
  const real = resolvePath(rawPath)
  const literal = rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath)
  for (const [re, message] of RULES) {
    if ((real && re.test(real)) || re.test(literal)) return { blocked: true, message }
  }
  return { blocked: false, message: '' }
}

function checkPath(rawPath) {
  const verdict = classifyPath(rawPath)
  return verdict.blocked ? block(verdict.message) : ALLOW
}

// FIX review Task 12 (finding 2 CRITICAL + finding 4 Important): trước đây
// hooks/pre-tool-use.sh tự parse JSON bằng grep/sed dưới `set -euo
// pipefail`. Hai lỗi: (a) `grep -o` không khớp gì thì pipeline trả 1, và
// `set -e` abort script NGAY tại dòng gán biến — dòng
// `[ -z "$FILE_PATH" ] && exit 0` phía sau không bao giờ chạy, nên MỌI
// payload không đúng khuôn dạng (thiếu file_path, stdin rỗng, JSON méo)
// khiến hook thoát != 0 và Claude Code CHẶN NHẦM mọi Write/Edit — fail
// CLOSED thay vì fail OPEN, cùng loại nguy hiểm với lỗi root-resolution đã
// sửa trước đó. (b) kể cả khi grep chạy được, nó không phải JSON parser
// thật: `file_path` xuất hiện hai lần thì `head -1` lấy giá trị ĐẦU (parser
// thật lấy giá trị CUỐI), và giá trị chứa dấu `"` đã escape bị cắt cụt tại
// chỗ escape → path rác, nhưng vẫn "thành công" nên cho ghi lọt qua.
//
// Sửa bằng cách dời việc parse JSON vào đây, nơi có JSON.parse thật, và
// luôn fail-open: bất kỳ lỗi nào (stdin rỗng, không phải JSON hợp lệ,
// không có file path) đều return 0 (cho phép), không bao giờ throw ra
// ngoài hàm này.
function readAllStdinSync() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────
// A2 — GUARD TỪNG CHỈ NHÌN `file_path`, NÊN BASH LỌT HOÀN TOÀN.
//
// Quan sát được trên payload thật của Claude Code: cả bốn lệnh dưới đây đều exit 0
// (cho phép) trong khi cùng path đó qua tool Write thì exit 2:
//   echo x > /r/features/demo/STATE.md
//   sed -i "" s/a/b/ /r/features/demo/STATE.md
//   rm -rf /r/features/demo/.evidence
//   NotebookEdit với notebook_path (tool này không dùng `file_path`)
// Luật vàng "chỉ `pp` ghi STATE.md" vì thế chỉ đúng với ĐÚNG MỘT họ tool.
//
// NÓI THẲNG VỀ GIỚI HẠN: phần dưới không phải shell parser và không thể là bằng
// chứng. Một chuỗi shell đủ vòng vo (biến, eval, base64, heredoc, `$'\x2f'`) luôn
// lách được. Nó là LỚP PHÒNG THỦ THỨ HAI bắt các đường thẳng và các lần vô ý.
// Thứ ép được Bash thật sự là `permissions.deny` trong .claude/settings.json (và
// sandbox.filesystem.denyWrite khi bật sandbox) — xem file đó.
// ─────────────────────────────────────────────────────────────────────────

// Tiện ích CÓ THỂ GHI. Nếu một trong số này xuất hiện và một tham số của lệnh là
// đường dẫn được bảo vệ thì chặn.
const WRITE_UTILS = /(?:^|[\s;&|(])(rm|rmdir|mv|cp|ln|install|truncate|dd|touch|chmod|chown|shred|tee|ex|ed)(?=[\s;&|)]|$)/
// Sửa tại chỗ: `sed -i`, `perl -pi`, `ruby -i`…
const INPLACE = /(?:^|[\s;&|(])(?:sed|perl|ruby|awk|gawk)\b[^;&|]*\s-\S*i/
// Script nội tuyến của trình thông dịch: không phân biệt được đọc với ghi, nên
// nghiêng về chặn — đọc mấy file này bằng `python -c` là chuyện gần như không xảy ra.
const INLINE_SCRIPT = /(?:^|[\s;&|(])(?:python3?|node|perl|ruby|php|deno|bun)\b[^;&|]*\s-(?:c|e|_)\b/

// Bỏ một lớp nháy quanh token.
function unquote(t) {
  return t.replace(/^['"]/, '').replace(/['"]$/, '')
}

// Mọi token trông như đường dẫn trong một chuỗi shell.
function shellTokens(cmd) {
  return (cmd.match(/(?:"[^"]*"|'[^']*'|[^\s;&|()<>]+)/g) ?? []).map(unquote).filter(Boolean)
}

// Đích của mọi phép chuyển hướng ghi (`> x`, `>> x`, `1> x`).
function redirectTargets(cmd) {
  return [...cmd.matchAll(/\d*>>?\s*("[^"]*"|'[^']*'|[^\s;&|()<>]+)/g)].map((m) => unquote(m[1]))
}

// Trả về path được bảo vệ ĐẦU TIÊN mà lệnh này sẽ GHI, hoặc '' nếu không có.
// Đọc (`cat`, `grep`, `tail` một file evidence) KHÔNG bị chặn — commands/pp.md
// dặn agent hiển thị evidence log cho người dùng, chặn việc đó là làm guard bị tắt.
export function bashWriteTarget(cmd) {
  if (typeof cmd !== 'string' || !cmd) return ''
  for (const t of redirectTargets(cmd)) {
    if (classifyPath(t).blocked) return t
  }
  const risky = WRITE_UTILS.test(cmd) || INPLACE.test(cmd) || INLINE_SCRIPT.test(cmd)
  if (!risky) return ''
  for (const t of shellTokens(cmd)) {
    if (t.startsWith('-')) continue
    if (classifyPath(t).blocked) return t
  }
  return ''
}

// Mọi hình dạng "path" mà các tool khác nhau dùng. NotebookEdit dùng
// `notebook_path`, không phải `file_path` — thiếu nó là một đường lọt trọn vẹn.
function extractFilePath(payload) {
  const inp = payload?.tool_input ?? {}
  for (const v of [payload?.file_path, inp.file_path, payload?.notebook_path, inp.notebook_path]) {
    if (typeof v === 'string' && v) return v
  }
  // Bash: path nằm trong chuỗi lệnh, và chỉ chặn khi lệnh đó GHI.
  const cmd = typeof inp.command === 'string' ? inp.command : payload?.command
  return bashWriteTarget(typeof cmd === 'string' ? cmd : '')
}

// guard-write CỐ Ý không nhận `root` từ context: hook PreToolUse gọi lệnh
// này cho mọi Write/Edit ở mọi project trên máy, không riêng
// product-repo. Nếu lệnh này cần root, nó sẽ hỏng/lỗi ở mọi project
// khác và biến hook thành thứ chặn toàn bộ chỉnh sửa file khắp máy —
// findRoot() ở bin/pp đã cố tình không throw để tránh đúng việc đó, và ở
// đây ta không dùng root chút nào.
export function guardWriteCmd(args) {
  const { flags } = parseArgs(args)
  if (flags.stdin) {
    const raw = readAllStdinSync()
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return ALLOW
    }
    return checkPath(extractFilePath(payload))
  }
  const p = typeof flags.path === 'string' ? flags.path : ''
  return checkPath(p)
}

// guard-stop phải "fail open": hook Stop chạy ở MỌI session, kể cả những
// session chẳng liên quan gì tới pipeline này (không có root, feature không
// tồn tại, hoặc state/config hỏng). Trong mọi trường hợp không chắc chắn,
// exit 0 (cho phép dừng) — không bao giờ chặn một cách bất ngờ.
//
// FIX review cuối (finding 5): hooks/stop.sh trước đây gate trên `$PP_FEATURE`
// mà KHÔNG CHỖ NÀO trên máy set biến đó, nên nó exit 0 vô điều kiện trong mọi
// phiên — tầng chặn thứ hai của §5.3 chưa từng chạy một lần nào. Bỏ hẳn phụ
// thuộc đó: không có tham số feature thì tự dò root rồi soát MỌI feature.
function listFeatures(base) {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_archive')
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export function guardStopCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const feature = positional[0]
  // Không tìm được root = phiên không liên quan tới pipeline này. Không chặn.
  if (!root) return ALLOW
  const features = feature ? [feature] : listFeatures(join(root, 'features'))
  for (const f of features) {
    let state
    try {
      state = readState(join(root, 'features', f))
    } catch {
      continue
    }
    for (const [id, st] of Object.entries(state.stages ?? {})) {
      if (st.status === 'in_progress' || st.status === 'failed') {
        return block(`pp: [${f}] stage ${id} đang ${st.status} — chạy \`pp gate ${f} ${id}\` cho xanh trước khi dừng.\n`)
      }
    }
  }
  return ALLOW
}
