import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig, stageOrder } from '../config.js'
import { readState, writeState } from '../state.js'
import { newEvidence } from '../evidence.js'
import { MAX_ATTEMPTS } from '../plan.js'
import { parseArgs } from '../args.js'

function artifactPath(config, stageId) {
  const outs = config.stages[stageId].outputs
  return outs[outs.length - 1]
}

// REVIEW FINDING (carried forward từ pp gate / runT1): stage id sai chính tả
// phải báo rõ tên stage đó và liệt kê các stage có thật, thay vì để
// `config.stages[stageId].outputs` ném TypeError nội bộ. Exit 2 (đối số sai),
// không phải 1 (gate fail): stage chưa hề chạy.
function unknownStageId(feature, stageId, config) {
  process.stdout.write(
    `pp: stage "${stageId}" không tồn tại trong pipeline.json của feature "${feature}"\n` +
    `Các stage có sẵn: ${stageOrder(config).join(', ')}\n`,
  )
  return 2
}

export function reviewPromptCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stdout.write('pp review-prompt <feature> <stage>\n'); return 2 }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

  const rubricPath = join(root, 'rubric', `${stageId}.md`)
  if (!existsSync(rubricPath)) {
    process.stdout.write(`pp: thiếu rubric/${stageId}.md — không thể tạo prompt review\n`)
    return 2
  }

  const outPath = artifactPath(config, stageId)
  const artifactFile = join(dir, outPath)
  if (!existsSync(artifactFile)) {
    process.stdout.write(`pp: thiếu artifact ${outPath} — chạy stage ${stageId} trước khi review\n`)
    return 2
  }
  const artifact = readFileSync(artifactFile, 'utf8')

  process.stdout.write(`Bạn là reviewer đối kháng. Mặc định REJECT. Chỉ trả JSON theo schema trong system prompt.

=== CONSTITUTION ===
${readFileSync(join(root, 'constitution.md'), 'utf8')}

=== RUBRIC (${stageId}) ===
${readFileSync(rubricPath, 'utf8')}

=== ARTIFACT (${outPath}) ===
${artifact}
`)
  return 0
}

export function reviewRecordCmd(args, { root }) {
  const { positional, flags } = parseArgs(args)
  const [feature, stageId] = positional
  const verdictFile = typeof flags.verdict === 'string' ? flags.verdict : null
  if (!feature || !stageId || !verdictFile) {
    process.stdout.write('pp review-record <feature> <stage> --verdict <file.json>\n')
    return 2
  }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

  if (!existsSync(verdictFile)) {
    process.stdout.write(`pp: không tìm thấy verdict file ${verdictFile}\n`)
    return 2
  }
  let verdict
  try {
    verdict = JSON.parse(readFileSync(verdictFile, 'utf8'))
  } catch (err) {
    process.stdout.write(`pp: verdict file ${verdictFile} không phải JSON hợp lệ: ${err.message}\n`)
    return 2
  }
  // Verdict thiếu hoặc findings rỗng = PASS không có finding, không phải crash.
  const findings = Array.isArray(verdict.findings) ? verdict.findings : []
  const highs = findings.filter((f) => f.verdict === 'fail' && f.severity === 'high')

  // FINDING 1: đọc state tươi từ đĩa để lấy `prev` (giống runT1) — không dùng
  // một object state chụp từ trước rồi mang theo suốt hàm.
  const diskState = readState(dir)
  const prev = diskState.stages?.[stageId] ?? { attempts: 0 }
  const attempt = (prev.attempts ?? 0) + 1
  const ev = newEvidence(dir, stageId, 't2', attempt)
  for (const f of findings) {
    ev.record(
      `pp-review ${f.criterion}`,
      f.verdict === 'fail' ? `[${f.severity}] ${f.evidence}\n→ ${f.fix}` : '',
      f.verdict === 'fail' && f.severity === 'high' ? 1 : 0,
    )
  }
  const ok = highs.length === 0
  const evidence = ev.finish(ok ? 'PASS' : 'FAIL')

  // FINDING 1 (tiếp): merge lên state MỚI NHẤT đọc lại ngay trước khi ghi —
  // không ghi đè bằng object đã chụp ở đầu hàm — để không làm rớt các cập
  // nhật đồng thời (stage khác) đã xảy ra giữa lúc đọc và lúc ghi, và để
  // attempts luôn được tính từ dữ liệu mới nhất.
  const next = readState(dir)
  next.feature = config.feature
  next.stages = next.stages ?? {}
  const newEntry = {
    ...prev,
    status: ok ? 'done' : attempt >= MAX_ATTEMPTS ? 'blocked' : 'failed',
    attempts: attempt,
    gate: ok ? 'pass' : 'fail',
    evidence,
  }
  // FINDING 2: xoá `human` ở CẢ hai nhánh pass và fail — một stage re-gate
  // (kể cả bởi T2) phải được duyệt lại, không được giữ approval cũ.
  delete newEntry.human
  next.stages[stageId] = newEntry
  writeState(dir, next)
  process.stdout.write(readFileSync(join(dir, evidence), 'utf8'))
  return ok ? 0 : 1
}
