import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig, stageOrder } from '../config.js'
import { readState } from '../state.js'
import { newEvidence } from '../evidence.js'
import { recordTierRun, requiredTiers, tierPassed } from '../gate.js'
import { parseArgs } from '../args.js'

function artifactPath(config, stageId) {
  const outs = config.stages[stageId].outputs
  return outs[outs.length - 1]
}

// In ra sự thật khi một tier xanh nhưng stage vẫn chưa xong — dùng chung
// giữa `pp gate` và `pp review-record` để hai lệnh không nói khác nhau.
export function outstandingNote(feature, stageId, outstanding) {
  const how = outstanding.includes('t2')
    ? `  chạy: pp review-prompt ${feature} ${stageId}  →  pp review-record ${feature} ${stageId} --verdict <file.json>\n`
    : `  chạy: pp gate ${feature} ${stageId}\n`
  return `\n⏳ ${stageId}: CHƯA done — còn thiếu tier: ${outstanding.join(', ')}\n${how}`
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

// FIX review cuối (finding 4) — T2 KHÔNG ĐƯỢC CHẠY TRƯỚC T1.
// Đây là lỗ hổng đã cho phép một stage tới `done` mà không có PRD, không có
// questions và CHƯA TỪNG chạy gate: reviewer (một LLM) nộp JSON "không có
// finding" và `review-record` ghi thẳng `done`. T2 là tầng ĐỐI KHÁNG đặt SAU
// tầng tất định, không phải đường vòng qua nó. Điều kiện "T1 đã xanh" cũng
// đọc lại `.evidence/<stage>.t1.log` trên đĩa (qua tierPassed), không tin cờ
// trong state.
function t1NotPassed(dir, config, feature, stageId) {
  if (!requiredTiers(config, stageId).includes('t1')) return false
  if (tierPassed(dir, config, readState(dir), stageId, 't1')) return false
  process.stdout.write(
    `pp: ${stageId} chưa có T1 xanh — T2 không được chạy trước T1.\n` +
    `Chạy \`pp gate ${feature} ${stageId}\` cho xanh trước, rồi mới review.\n`,
  )
  return true
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
  if (t1NotPassed(dir, config, feature, stageId)) return 1
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

  if (t1NotPassed(dir, config, feature, stageId)) return 1

  // FINDING 1: đọc state tươi từ đĩa để lấy `prev` (giống runT1) — không dùng
  // một object state chụp từ trước rồi mang theo suốt hàm.
  const prev = readState(dir).stages?.[stageId] ?? {}
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

  // FIX review cuối (finding 1): `review-record` KHÔNG còn tự ghi `done`. Nó
  // ghi kết quả tier t2 rồi để `recordTierRun`/`stageDone` — hàm quyết định
  // dùng chung, đọc lại evidence của MỌI tier trên đĩa — kết luận.
  const dec = recordTierRun(dir, config, stageId, 't2', { ok, evidence })
  process.stdout.write(readFileSync(join(dir, evidence), 'utf8'))
  if (ok && !dec.done) {
    process.stdout.write(outstandingNote(feature, stageId, dec.outstanding))
  }
  return ok ? 0 : 1
}
