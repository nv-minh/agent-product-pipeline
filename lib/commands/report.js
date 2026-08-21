import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readState, staleOrUnverifiable } from '../state.js'
import { readConfig } from '../config.js'
import { stageDone } from '../gate.js'
import { parseArgs } from '../args.js'
import { readAudit } from '../audit.js'
import { readEntries } from '../usage.js'

// Một gate bị override ≥3 lần nghĩa là gate đó sai — sửa luật gate, đừng
// sửa người (constitution.md). `pp report` là cơ chế tự giám sát duy nhất
// phát hiện điều đó, nên phải nêu bật, không chỉ liệt kê số suông.
const OVERRIDE_WARN_THRESHOLD = 3

// D3 — CỘT NÀY TỪNG IN `st.attempts`, MỘT BỘ ĐẾM BỊ RESET VỀ 0 KHI STAGE DONE.
// Hệ quả quan sát được trên feature thật: 40-testplan mất nhiều vòng đỏ mới
// xanh, mà `pp report` in "attempts 0" cho mọi stage đã xong — toàn bộ ngưỡng
// tự giám sát §9.4 ("cùng stage tốn nhiều vòng ở nhiều feature nghĩa là luật
// gate sai") và tiêu chí khai tử §10.4 KHÔNG ĐO ĐƯỢC. Số vòng đỏ thật nằm ở
// `tiers[*].attempts` — phần sổ sách không bao giờ reset (kể cả qua unblock).
// Cột đổi tên thành "vòng-đỏ" cho đúng nghĩa: đây là tổng lần đỏ lịch sử,
// không phải ngân sách retry còn lại (thứ đó nằm trong STATE.md). Một token
// (gạch nối, không khoảng trắng) — ô của bảng này được đo bằng ranh giới
// khoảng trắng, một header hai chữ sẽ bị đọc thành hai cột (test F4).
const HEAD = ['stage', 'status', 'vòng-đỏ', 'override']
const ROUNDS_WARN_THRESHOLD = 3

// Tổng vòng đỏ THẬT của một stage: cộng lịch sử mọi tier. State do bản pp cũ
// ghi (chưa có `tiers`) thì rơi về `attempts` — số đó có thể đã reset, nhưng
// là thứ duy nhất còn lại.
function redRounds(st) {
  if (!st.tiers) return st.attempts ?? 0
  return Object.values(st.tiers).reduce((s, t) => s + (t.attempts ?? 0), 0)
}

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
// `report` chạy trên MỌI feature cùng lúc, nên nó không được chết vì một feature
// hỏng (đúng lý do `readState`/`readConfig` đã được bọc) — `staleOrUnverifiable`
// (lib/state.js) là phép bọc đó, nay dùng chung với `pp approve` (B6).
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
  const hotRounds = []
  const drift = []
  const rows = []
  for (const [id, st] of entries) {
    const count = st.override_count ?? 0
    totalOverrides += count
    if (count >= OVERRIDE_WARN_THRESHOLD) hot.push({ id, count })
    const rounds = redRounds(st)
    if (rounds >= ROUNDS_WARN_THRESHOLD) hotRounds.push({ id, rounds })
    let status = String(st.status ?? 'pending')
    if (config?.stages?.[id] && st.status === 'done') {
      const verdict = stageDone(dir, config, state, id)
      if (!verdict.done) {
        status = 'done⚠'
        drift.push({ id, verdict })
      } else if (staleOrUnverifiable(dir, config, state, id)) {
        // Hai chuyện KHÁC NHAU, phải nói khác nhau: trên là "evidence hiện tại
        // không còn đỡ được chữ done"; dưới là "evidence vẫn đỡ được, nhưng
        // input thượng nguồn đã đổi kể từ lần gate xanh".
        status = 'done⚠'
        drift.push({ id, stale: true })
      }
    }
    rows.push([id, status, String(rounds), count > 0 ? String(count) : '-'])
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
  // §9.4: cùng một stage ngốn nhiều vòng đỏ là tín hiệu về LUẬT (gate mù mờ,
  // chỉ thị thiếu) trước khi là tín hiệu về người làm — nêu bật, đừng chỉ
  // liệt kê số rồi để nó chìm trong bảng. lessons/ chỉ được override/unblock
  // ghi, nên "nhiều vòng đỏ mà lessons trống" là một sự việc CÓ THẬT và đáng
  // nói — đừng trỏ người đọc vào một file không tồn tại.
  for (const { id, rounds } of hotRounds) {
    const lesson = `lessons/${id}.md`
    const hint = existsSync(join(root, lesson))
      ? `xem ${lesson}: luật gate có nói trước đủ không?`
      : `chưa có ${lesson} — từng ấy vòng đỏ mà không một dòng bài học nào được ghi; ghi lại nguyên nhân trước khi feature sau đỏ đúng chỗ cũ.`
    process.stdout.write(
      `  ⚠ stage ${id} đã tốn ${rounds} vòng đỏ thật (≥${ROUNDS_WARN_THRESHOLD}, tính cả lịch sử qua unblock) — ${hint}\n`,
    )
  }
}

export function reportCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const only = positional[0]
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
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
