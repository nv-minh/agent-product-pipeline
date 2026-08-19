import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readState, isStale } from '../state.js'
import { readConfig } from '../config.js'
import { stageDone } from '../gate.js'
import { parseArgs } from '../args.js'
import { readAudit } from '../audit.js'
import { readEntries } from '../usage.js'

// Một gate bị override ≥3 lần nghĩa là gate đó sai — sửa luật gate, đừng
// sửa người (constitution.md). `pp report` là cơ chế tự giám sát duy nhất
// phát hiện điều đó, nên phải nêu bật, không chỉ liệt kê số suông.
const OVERRIDE_WARN_THRESHOLD = 3

const HEAD = ['stage', 'status', 'attempts', 'override']

// F4 — `padEnd(10)` LÀM GÃY ĐÚNG HAI HÀNG ĐÁNG CHÚ Ý NHẤT.
// Nó ngắn hơn chính chuỗi nó phải chứa (`in_progress` = 11 ký tự → padEnd
// thành lệnh rỗng), và nó đếm ĐƠN VỊ MÃ JS trong khi bảng này được đọc trên
// terminal: `⚠` (U+26A0) là một đơn vị mã nhưng chiếm hai cột, nên `done⚠`
// cũng đẩy các cột sau lệch một. Đo theo CỘT HIỂN THỊ, và lấy bề rộng từ nội
// dung thật thay vì một hằng số đoán trước.
function cellWidth(s) {
  return s.length + (s.match(/⚠/g)?.length ?? 0)
}

function renderTable(rows) {
  const widths = HEAD.map((h, i) => Math.max(cellWidth(h), ...rows.map((r) => cellWidth(r[i]))))
  const line = (cells) =>
    `  ${cells.map((c, i) => c + ' '.repeat(widths[i] - cellWidth(c))).join('  ').trimEnd()}\n`
  return line(HEAD) + rows.map(line).join('')
}

// F4 — `report` phải trả lời GIỐNG `pp status` về cùng một stage.
// `nextStage` kiểm `isStale` TRƯỚC `stageDone`, còn `report` chỉ gọi
// `stageDone` — nên một stage bị stale vì input thượng nguồn đổi in ra `done`
// sạch bong ở `report` trong khi `pp status` nói `regate`. Hai lệnh nói ngược
// nhau về cùng một stage thì `report` mất luôn giá trị làm mặt bằng kiểm toán.
//
// `isStale` gọi `hashInputs`, hàm này NÉM khi một input bắt buộc không còn
// trên đĩa. `report` chạy trên MỌI feature cùng lúc, nên nó không được chết vì
// một feature hỏng (đúng lý do `readState`/`readConfig` đã được bọc). Không
// băm được = không chứng minh được là còn tươi = coi như đã đổi, cùng chiều
// bảo thủ mà `isStale` áp cho `inputs_hash` vắng mặt.
function upstreamChanged(dir, config, state, id) {
  try {
    return isStale(dir, config, state, id)
  } catch {
    return true
  }
}

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

  let totalOverrides = 0
  const hot = []
  const drift = []
  const rows = []
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
      } else if (upstreamChanged(dir, config, state, id)) {
        // Hai chuyện KHÁC NHAU, phải nói khác nhau: trên là "evidence hiện tại
        // không còn đỡ được chữ done"; dưới là "evidence vẫn đỡ được, nhưng
        // input thượng nguồn đã đổi kể từ lần gate xanh".
        status = 'done⚠'
        drift.push({ id, stale: true })
      }
    }
    rows.push([id, status, String(st.attempts ?? 0), count > 0 ? String(count) : '-'])
  }

  process.stdout.write(`\n${feature}\n`)
  process.stdout.write(renderTable(rows))
  if (entries.length === 0) {
    process.stdout.write('  (chưa chạy stage nào)\n')
  }
  process.stdout.write(`  → tổng override: ${totalOverrides}\n`)

  // §9.4 — report phải nói được CHI PHÍ và THỜI GIAN của feature. Token là số
  // thô do usage-sync khai thác từ transcript (không quy đổi tiền — giá trôi);
  // thời gian là KHOẢNG (first→last ts trong audit), không phải công sức —
  // đặt tên trung thực để không ai đọc thành "elapsed effort".
  const usage = readEntries(dir)
  if (usage.length > 0) {
    const i = usage.reduce((s, e) => s + (e.input_tokens ?? 0), 0)
    const o = usage.reduce((s, e) => s + (e.output_tokens ?? 0), 0)
    const c = usage.reduce((s, e) => s + (e.cache_read_input_tokens ?? 0) + (e.cache_creation_input_tokens ?? 0), 0)
    const sessions = new Set(usage.map((e) => e.session)).size
    process.stdout.write(`  → token: input ${i} · output ${o} · cache ${c} (${usage.length} lượt, ${sessions} session) — cập nhật bằng \`pp usage-sync ${feature}\`\n`)
  } else {
    process.stdout.write(`  → token: (chưa có dữ liệu — chạy pp usage-sync ${feature})\n`)
  }
  const audit = readAudit(dir)
  if (audit.length > 0) {
    const tss = audit.map((e) => e.ts).filter(Boolean).sort()
    if (tss.length > 0) {
      process.stdout.write(`  → thời gian: ${tss[0]} → ${tss[tss.length - 1]}\n`)
    }
  }
  for (const { id, verdict, stale } of drift) {
    if (stale) {
      process.stdout.write(
        `  ⚠ stage ${id}: STATE ghi done và evidence vẫn đỡ được, nhưng INPUT THƯỢNG NGUỒN đã đổi kể từ lần gate xanh (\`pp status\` báo regate) — chạy lại \`pp gate ${feature} ${id}\`\n`,
      )
      continue
    }
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
