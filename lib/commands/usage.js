import { join } from 'node:path'
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
    process.stdout.write('pp usage-sync <feature> [--since <iso>] [--transcripts DIR]\n')
    return 2
  }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  if (!existsSync(join(dir, 'pipeline.json'))) {
    process.stdout.write(`pp: features/${feature} không có pipeline.json — feature chưa được init?\n`)
    return 2
  }
  let sinceMs = null
  if (typeof flags.since === 'string') {
    sinceMs = Date.parse(flags.since)
    if (Number.isNaN(sinceMs)) {
      process.stdout.write('pp: --since phải là timestamp ISO (vd 2026-08-19T00:00:00Z)\n')
      return 2
    }
  }

  const base = transcriptsDir(typeof flags.transcripts === 'string' ? flags.transcripts : undefined)
  const windows = buildWindows(readAudit(dir))
  const known = loadExistingIds(entriesPath(dir))
  const mined = await mineProject(base, { root, feature, windows, sinceMs, known })

  // Thiếu transcript là thiếu dữ liệu, không phải lỗi: exit 0 + ghi chú.
  if (mined === null) {
    process.stdout.write(`pp: không tìm thấy thư mục transcript ${join(base, mungePath(root))} — chưa có gì để đồng bộ\n`)
    return 0
  }

  appendEntries(dir, mined.added)
  const all = readEntries(dir)
  const sessions = new Set(mined.added.map((e) => e.session)).size
  process.stdout.write(`usage-sync ${feature}: +${mined.added.length} mục (${sessions} session, quét ${mined.files} file) → tổng ${all.length}\n`)

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

  auditEvent(dir, {
    actor: 'pp', event: 'usage-sync', feature,
    details: { added: mined.added.length, total: all.length, sessions },
  })
  return 0
}
