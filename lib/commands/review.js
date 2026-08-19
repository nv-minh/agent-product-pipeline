import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { readConfig, stageOrder } from '../config.js'
import { readState } from '../state.js'
import { newEvidence } from '../evidence.js'
import { recordTierRun, requiredTiers, tierPassed, statusLine } from '../gate.js'
import { parseArgs } from '../args.js'
import { auditEvent, hashString } from '../audit.js'

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

// Dựng prompt review từ constitution + rubric + artifact. Tách ra khỏi
// reviewPromptCmd để `review-record` tính prompt_sha bằng CHÍNH hàm này: prompt
// và archive phải sinh từ cùng một nguồn — nếu rubric/artifact đổi giữa lúc
// hỏi và lúc chấm, hash sẽ lệch, và đó chính là tín hiệu drift đáng giữ.
// Thiếu bất kỳ input nào → null (caller tự quyết: record thì ghi null chứ
// không fail; prompt thì đã validate trước với thông báo riêng).
export function buildReviewPrompt(root, dir, config, stageId) {
  try {
    const rubric = readFileSync(join(root, 'rubric', `${stageId}.md`), 'utf8')
    const outPath = artifactPath(config, stageId)
    const artifact = readFileSync(join(dir, outPath), 'utf8')
    const constitution = readFileSync(join(root, 'constitution.md'), 'utf8')
    return `Bạn là reviewer đối kháng. Mặc định REJECT. Chỉ trả JSON theo schema trong system prompt.

=== CONSTITUTION ===
${constitution}

=== RUBRIC (${stageId}) ===
${rubric}

=== ARTIFACT (${outPath}) ===
${artifact}
`
  } catch {
    return null
  }
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

  // Mỏ neo "vòng review T2 bắt đầu ở đây" — cùng loại với dispatch: usage-sync
  // dùng event này dựng cửa sổ thời gian cho phần traffic token nặng nhất.
  auditEvent(dir, { actor: 'pp', event: 'review-prompt', feature, stage: stageId })

  process.stdout.write(buildReviewPrompt(root, dir, config, stageId))
  return 0
}

// seq đơn điệu per stage, TÁCH KHỎI `attempts`: attempts là ngân sách retry —
// reset về 0 khi stage đạt done — nên dùng lại làm tên file sẽ GHI ĐÈ
// .review/<stage>.1.json sau chu kỳ re-gate. seq chỉ tăng, không bao giờ giảm.
function nextReviewSeq(dir, stageId) {
  let max = 0
  try {
    const files = readdirSync(join(dir, '.review'))
    const prefix = `${stageId}.`
    for (const f of files) {
      if (!f.startsWith(prefix) || !f.endsWith('.json')) continue
      const n = Number(f.slice(prefix.length, -'.json'.length))
      if (Number.isInteger(n) && n > max) max = n
    }
  } catch {
    // chưa có .review/ — bản đầu tiên
  }
  return max + 1
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
  let raw
  try {
    raw = readFileSync(verdictFile, 'utf8')
    verdict = JSON.parse(raw)
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

  // LƯU VĨNH VIỄN verdict này: inbox `.review-<stage>.json` (do conductor ghi)
  // bị ghi đè mỗi vòng — `.review/<stage>.<seq>.json` là bản không bao giờ bị
  // ghi đè, chứa verdict nguyên văn + hash của cả verdict lẫn prompt đã hỏi.
  // Prompt không lưu nguyên văn vì review-prompt sinh lại được tất định từ
  // constitution+rubric+artifact; prompt_sha là đủ để phát hiện drift.
  const prompt = buildReviewPrompt(root, dir, config, stageId)
  const seq = nextReviewSeq(dir, stageId)
  const archiveRel = `.review/${stageId}.${seq}.json`
  mkdirSync(join(dir, '.review'), { recursive: true })
  writeFileSync(join(dir, archiveRel), JSON.stringify({
    v: 1,
    ts: new Date().toISOString(),
    feature,
    stage: stageId,
    seq,
    attempt,
    verdict_path: basename(verdictFile),
    verdict,
    verdict_sha: hashString(raw),
    prompt_sha: prompt === null ? null : hashString(prompt),
    findings_total: findings.length,
    findings_high: highs.length,
    ok,
  }, null, 2) + '\n')

  auditEvent(dir, {
    actor: 'pp', event: 'review', feature, stage: stageId, ok,
    details: {
      tier: 't2',
      findings_total: findings.length,
      findings_high: highs.length,
      archive: archiveRel,
      verdict_sha: hashString(raw),
    },
  })
  process.stdout.write(readFileSync(join(dir, evidence), 'utf8'))
  // R2: `review-record` KẾT THÚC bằng đúng dòng trạng thái mà `pp gate` in ra,
  // sinh bởi cùng một hàm. Trước bản vá này, tín hiệu hoàn thành mà
  // commands/pp.md dặn agent chờ (`✓ <stage>: done`) không thể xuất hiện trên
  // bất kỳ stage nào có t2 — tức mọi stage mặc định.
  process.stdout.write(statusLine(feature, stageId, config, dec))
  return ok ? 0 : 1
}
