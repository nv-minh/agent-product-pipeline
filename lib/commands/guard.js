import { join, resolve } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
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
const FEATURES_EVIDENCE = /\/features\/.*\/\.evidence\//i
// FIX review cuối (finding 6): `pipeline.json` cũng phải được canh. Một agent
// chỉ có tool Write đã có thể ghi đè nó để `enabled: false` mọi stage (rồi
// `pp status` báo feature hoàn tất với 0 gate được chạy), hoặc lật
// `human: true` thành `false` để human gate im lặng biến mất. Cùng kiểu khớp
// case-insensitive + chuẩn hoá path như STATE.md/.evidence/.
const FEATURES_PIPELINE = /\/features\/.*\/pipeline\.json$/i

// FIX review Task 12 (finding 3, Important): path tương đối (không có `/`
// đầu) phải được resolve theo cwd TRƯỚC khi so khớp, nếu không
// `features/demo/STATE.md` (không có `/` đầu) lọt qua trong khi
// `./features/demo/STATE.md` bị chặn — không nhất quán, và là một đường
// vòng khác (agent chỉ cần bỏ dấu `/` đầu).
function resolvePath(rawPath) {
  if (!rawPath) return ''
  return rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath)
}

function checkPath(rawPath) {
  const p = resolvePath(rawPath)
  if (!p) return ALLOW
  if (FEATURES_STATE.test(p)) {
    return block('pp: STATE.md chỉ được ghi bởi `pp`. Dùng `pp gate` / `pp approve`.\n')
  }
  if (FEATURES_EVIDENCE.test(p)) {
    return block('pp: .evidence/ chỉ được ghi bởi `pp`. Hoàn thành là dữ kiện, không phải lời khai.\n')
  }
  if (FEATURES_PIPELINE.test(p)) {
    return block('pp: pipeline.json chỉ được ghi bởi `pp init` / người dùng. Sửa nó là tắt gate và xoá human gate.\n')
  }
  return ALLOW
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

function extractFilePath(payload) {
  if (payload && typeof payload.file_path === 'string') return payload.file_path
  if (payload && payload.tool_input && typeof payload.tool_input.file_path === 'string') {
    return payload.tool_input.file_path
  }
  return ''
}

// guard-write CỐ Ý không nhận `root` từ context: hook PreToolUse gọi lệnh
// này cho mọi Write/Edit ở mọi project trên máy, không riêng
// pinnacle-product. Nếu lệnh này cần root, nó sẽ hỏng/lỗi ở mọi project
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
