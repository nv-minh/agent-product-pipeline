import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { parseArgs } from '../args.js'
import { auditEvent, readAudit } from '../audit.js'
import {
  transcriptsDir, mungePath, buildWindows, loadExistingIds, mineProject,
  appendEntries, readEntries, entriesPath,
} from '../usage.js'

// pp usage-sync <feature> — đồng bộ token usage thật từ transcript Claude Code
// vào features/<f>/.usage/entries.jsonl. Idempotent; attribution về stage là
// heuristic (cửa sổ thời gian từ audit.jsonl + fallback nhắc tên feature) —
// output luôn nói "mục", không nói "chính xác tuyệt đối".
export async function usageSyncCmd(args, { root }) {
  const { positional, flags } = parseArgs(args)
  const feature = positional[0]
  if (!feature) {
    process.stderr.write('pp usage-sync <feature> [--since <iso>] [--transcripts DIR] [--repos DIR,DIR]\n')
    return 2
  }
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  if (!existsSync(join(dir, 'pipeline.json'))) {
    process.stderr.write(`pp: features/${feature} không có pipeline.json — feature chưa được init?\n`)
    return 2
  }
  let sinceMs = null
  if (typeof flags.since === 'string') {
    sinceMs = Date.parse(flags.since)
    if (Number.isNaN(sinceMs)) {
      process.stderr.write('pp: --since phải là timestamp ISO (vd 2026-08-19T00:00:00Z)\n')
      return 2
    }
  }

  const base = transcriptsDir(typeof flags.transcripts === 'string' ? flags.transcripts : undefined)
  const windows = buildWindows(readAudit(dir))
  const known = loadExistingIds(entriesPath(dir))

  // D5 — PIPELINE NÀY THIẾT KẾ ĐỂ CODE ĐƯỢC VIẾT Ở REPO KHÁC (backend-repo/
  // web-repo cạnh product-repo), nhưng usage-sync từng chỉ quét transcript của
  // CHÍNH product-repo — phần việc nặng nhất báo "chưa có gì để đồng bộ".
  // `--repos a,b` khai thêm các repo code; mỗi repo là một dir munge riêng
  // trong ~/.claude/projects. Dedup theo (session, message.id) dùng CHUNG một
  // tập `known` xuyên các repo, nên một entry không bao giờ bị cộng hai lần
  // dù xuất hiện ở nhiều nơi.
  const repos = typeof flags.repos === 'string'
    ? flags.repos.split(',').map((s) => resolve(s.trim())).filter(Boolean)
    : []
  const roots = [root, ...repos.filter((r) => r !== root)]

  const added = []
  const missing = []
  let files = 0
  for (const r of roots) {
    const mined = await mineProject(base, { root: r, feature, windows, sinceMs, known })
    if (mined === null) {
      missing.push(join(base, mungePath(r)))
      continue
    }
    added.push(...mined.added)
    files += mined.files
  }

  // Thiếu transcript ở MỌI root là thiếu dữ liệu, không phải lỗi: exit 0 + ghi chú
  // ra STDOUT — đây là kết quả của lệnh (dữ liệu), không phải lỗi; stderr chỉ dành
  // cho những gì khiến exit ≠ 0.
  if (missing.length === roots.length) {
    process.stdout.write(`pp: không tìm thấy thư mục transcript ${missing.join(', ')} — chưa có gì để đồng bộ\n`)
    return 0
  }
  // Thiếu một phần thì phải NÓI — im lặng là "đã quét hết" giả. Cùng là note
  // kèm kết quả thành công → stdout.
  for (const m of missing) {
    process.stdout.write(`pp: không có transcript ở ${m} — repo đó chưa có phiên nào (bỏ qua)\n`)
  }

  appendEntries(dir, added)
  const all = readEntries(dir)
  const sessions = new Set(added.map((e) => e.session)).size
  process.stdout.write(`usage-sync ${feature}: +${added.length} mục (${sessions} session, quét ${files} file, ${roots.length - missing.length} repo) → tổng ${all.length}\n`)

  const byStage = new Map()
  for (const e of all) {
    const k = e.stage ?? '(ngoài stage)'
    const b = byStage.get(k) ?? { i: 0, o: 0, c: 0, n: 0 }
    b.i += e.input_tokens
    b.o += e.output_tokens
    b.c += (e.cache_read_input_tokens ?? 0) + (e.cache_creation_input_tokens ?? 0)
    b.n++
    byStage.set(k, b)
  }
  for (const [stage, b] of [...byStage.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    process.stdout.write(`  ${stage}   input ${b.i} · output ${b.o} · cache ${b.c} (${b.n} lượt)\n`)
  }
  // D5: nói thẳng giới hạn của phép gán thay vì để con số trông chính xác hơn
  // bản chất của nó. Cửa sổ dựng PER-FEATURE từ audit của chính feature này —
  // hai feature chạy xen kẽ có thể CÙNG nhận một dòng transcript khi cửa sổ
  // của chúng chồng thời gian.
  process.stdout.write(
    '  (gán theo cửa sổ thời gian — heuristic: hai feature xen kẽ có thể cùng nhận một dòng; đừng cộng token GIỮA các feature)\n',
  )

  auditEvent(dir, {
    actor: 'pp', event: 'usage-sync', feature,
    details: { added: added.length, total: all.length, sessions },
  })
  return 0
}
