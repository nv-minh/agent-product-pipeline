import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { parseArgs } from '../args.js'

// CORRECTION so với brief: chặn theo "/STATE.md$" hoặc "/.evidence/" ở BẤT
// KỲ đâu trên máy là quá rộng — một project không liên quan có file
// STATE.md của riêng họ sẽ bị chặn oan. guard-write chạy trên MỌI Write/Edit
// của MỌI project (hook PreToolUse toàn cục), nên chỉ được chặn khi path
// thực sự nằm trong một feature dir của pipeline này: phải có segment
// /features/ rồi sau đó mới là STATE.md hoặc .evidence/.
const FEATURES_STATE = /\/features\/.*\/STATE\.md$/
const FEATURES_EVIDENCE = /\/features\/.*\/\.evidence\//

// guard-write CỐ Ý không nhận `root` từ context: hook PreToolUse gọi lệnh
// này cho mọi Write/Edit ở mọi project trên máy, không riêng
// pinnacle-product. Nếu lệnh này cần root, nó sẽ hỏng/lỗi ở mọi project
// khác và biến hook thành thứ chặn toàn bộ chỉnh sửa file khắp máy —
// findRoot() ở bin/pp đã cố tình không throw để tránh đúng việc đó, và ở
// đây ta không dùng root chút nào.
export function guardWriteCmd(args) {
  const { flags } = parseArgs(args)
  const p = typeof flags.path === 'string' ? flags.path : ''
  if (FEATURES_STATE.test(p)) {
    process.stdout.write('pp: STATE.md chỉ được ghi bởi `pp`. Dùng `pp gate` / `pp approve`.\n')
    return 1
  }
  if (FEATURES_EVIDENCE.test(p)) {
    process.stdout.write('pp: .evidence/ chỉ được ghi bởi `pp`. Hoàn thành là dữ kiện, không phải lời khai.\n')
    return 1
  }
  return 0
}

// guard-stop phải "fail open": hook Stop chạy ở MỌI session, kể cả những
// session chẳng liên quan gì tới pipeline này (không có root, feature không
// tồn tại, hoặc state/config hỏng). Trong mọi trường hợp không chắc chắn,
// exit 0 (cho phép dừng) — không bao giờ chặn một cách bất ngờ.
export function guardStopCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const feature = positional[0]
  if (!feature || !root) return 0
  const dir = join(root, 'features', feature)
  let state
  try {
    state = readState(dir)
    readConfig(dir)
  } catch {
    return 0
  }
  for (const [id, st] of Object.entries(state.stages ?? {})) {
    if (st.status === 'in_progress' || st.status === 'failed') {
      process.stdout.write(`pp: stage ${id} đang ${st.status} — chạy \`pp gate ${feature} ${id}\` cho xanh trước khi dừng.\n`)
      return 1
    }
  }
  return 0
}
