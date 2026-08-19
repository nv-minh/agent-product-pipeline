import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readState } from '../state.js'
import { readConfig } from '../config.js'
import { stageDone } from '../gate.js'
import { parseArgs } from '../args.js'

// Một gate bị override ≥3 lần nghĩa là gate đó sai — sửa luật gate, đừng
// sửa người (constitution.md). `pp report` là cơ chế tự giám sát duy nhất
// phát hiện điều đó, nên phải nêu bật, không chỉ liệt kê số suông.
const OVERRIDE_WARN_THRESHOLD = 3

function listFeatureDirs(base) {
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_archive')
    .map((e) => e.name)
    .sort()
}

function printFeature(root, feature) {
  const dir = join(root, 'features', feature)
  let state
  try {
    state = readState(dir)
  } catch {
    // readState ném lỗi khi STATE.md tồn tại nhưng hỏng (thiếu khối đánh
    // dấu / JSON méo — vd. bị sửa tay). `report` chạy trên MỌI feature
    // cùng lúc khi không truyền tham số; một feature hỏng không được kéo
    // sập cả lệnh — báo rồi bỏ qua, các feature còn lại vẫn phải hiện.
    process.stdout.write(`\n${feature}\n  ⚠ không đọc được STATE.md — bỏ qua\n`)
    return
  }

  // R4: `report` là chỗ người ta nhìn để tin cả pipeline — nó không được vẽ
  // một `done` sạch bong cho một stage mà evidence hiện tại không còn chứng
  // minh (log bị bẻ, hoặc bị xoá sạch). Không đọc được pipeline.json thì vẫn
  // in bảng state, chỉ là không đối chiếu được.
  let config = null
  try {
    config = readConfig(dir)
  } catch {
    config = null
  }

  const entries = Object.entries(state.stages ?? {}).sort(([a], [b]) => a.localeCompare(b))
  process.stdout.write(`\n${feature}\n  stage         status     attempts  override\n`)
  if (entries.length === 0) {
    process.stdout.write('  (chưa chạy stage nào)\n')
  }

  let totalOverrides = 0
  const hot = []
  const drift = []
  for (const [id, st] of entries) {
    const count = st.override_count ?? 0
    totalOverrides += count
    if (count >= OVERRIDE_WARN_THRESHOLD) hot.push({ id, count })
    let status = String(st.status ?? 'pending')
    if (config?.stages?.[id] && st.status === 'done') {
      const verdict = stageDone(dir, config, state, id)
      if (!verdict.done) {
        status = 'done⚠'
        drift.push({ id, verdict })
      }
    }
    process.stdout.write(
      `  ${id.padEnd(13)} ${status.padEnd(10)} ${String(st.attempts ?? 0).padEnd(9)} ${count > 0 ? String(count) : '-'}\n`,
    )
  }
  process.stdout.write(`  → tổng override: ${totalOverrides}\n`)
  for (const { id, verdict } of drift) {
    process.stdout.write(
      `  ⚠ stage ${id}: STATE ghi done nhưng evidence hiện tại KHÔNG chứng minh (còn thiếu tier: ${verdict.outstanding.join(', ')}) — chạy lại \`pp gate ${feature} ${id}\`\n`,
    )
    for (const n of verdict.notes) process.stdout.write(`      ${n}\n`)
  }
  for (const { id, count } of hot) {
    process.stdout.write(
      `  ⚠ stage ${id} đã bị override ${count} lần (≥${OVERRIDE_WARN_THRESHOLD}) — gate đó sai, sửa luật gate, đừng sửa người.\n`,
    )
  }
}

export function reportCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const only = positional[0]
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }

  const base = join(root, 'features')
  if (!existsSync(base)) { process.stdout.write('chưa có feature nào\n'); return 0 }

  // Không tham số → in mọi feature (bỏ qua _archive/). readState() tự trả
  // state rỗng cho một tên feature không tồn tại (không throw), nên feature
  // đơn lẻ gõ sai tên chỉ ra bảng trống thay vì crash.
  const features = only ? [only] : listFeatureDirs(base)
  for (const f of features) printFeature(root, f)
  return 0
}
