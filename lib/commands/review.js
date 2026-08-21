import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, basename } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { newEvidence } from '../evidence.js'
import { recordTierRun, requiredTiers, tierPassed, statusLine } from '../gate.js'
import { parseArgs } from '../args.js'
import { auditEvent, hashString } from '../audit.js'
// REVIEW FINDING (carried forward từ pp gate / runT1): stage id sai chính tả
// phải báo rõ tên stage đó và liệt kê các stage có thật, thay vì để
// `config.stages[stageId].outputs` ném TypeError nội bộ. Exit 2 (đối số sai),
// không phải 1 (gate fail): stage chưa hề chạy. Thông điệp đó nay dùng chung
// (./precond.js) thay vì ba bản copy.
import { unknownStageId, upstreamBlocked } from './precond.js'

function artifactPath(config, stageId) {
  const outs = config.stages[stageId].outputs
  return outs[outs.length - 1]
}

// FINDING (review 8c825c9..44c1ecb): stage khai `gate: ["t1"]` là CỐ Ý không có
// tầng T2 (spec pp-bugfix §4.2 dồn T2 cho diagnosis và regression). Nhưng
// review-prompt kiểm rubric TRƯỚC, nên nó báo "thiếu rubric/15-fixplan.md" —
// đọc như "bản cài thiếu file" và đẩy người dùng đi tạo rubric cho một tầng
// không tồn tại. Nếu họ tạo thật thì review-record ghi được evidence t2 lên
// stage t1-only, và `tiersWithEvidence` coi mọi log tier đỏ là chặn done → tự
// sinh một cái tắc mới. Nói đúng bản chất, và nói TRƯỚC mọi kiểm tra khác.
function noT2Tier(config, feature, stageId) {
  if (requiredTiers(config, stageId).includes('t2')) return false
  process.stderr.write(
    `pp: ${stageId} khai gate ${JSON.stringify(config.stages[stageId].gate ?? ['t1'])} — ` +
    'stage này KHÔNG có tầng T2, không review.\n' +
    `T1 xanh là stage done; \`pp status ${feature}\` cho biết bước kế tiếp.\n` +
    'Đây không phải lỗi bản cài: không phải stage nào cũng cần reviewer đối kháng.\n',
  )
  return true
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
  process.stderr.write(
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

// ─────────────────────────────────────────────────────────────────────────
// A3 — VERDICT T2 PHẢI THUỘC VỀ MỘT PROMPT ĐÃ THỰC SỰ ĐƯỢC PHÁT.
//
// Trước bản vá: `review-record --verdict <file>` nhận đường dẫn BẤT KỲ và không
// có gì nối verdict với `review-prompt`. Hệ quả quan sát được:
//   (a) ghi `{"findings":[]}` là T2 xanh, không cần chạy review-prompt lần nào;
//   (b) REPLAY — sửa artifact thành nội dung khác rồi nộp LẠI ĐÚNG file verdict
//       cũ, T2 lại xanh. `prompt_sha` có được tính nhưng chỉ ĐƯỢC LƯU, không
//       chỗ nào so sánh, nên nó không chặn gì cả.
//
// Cách chặn: `review-prompt` phát một nonce dùng MỘT LẦN, ghi kèm `prompt_sha`
// của đúng prompt vừa phát vào `.review/<stage>.pending.json` (thư mục này đã
// được PreToolUse guard chặn ghi). `review-record` đòi verdict mang lại đúng
// nonce đó, VÀ prompt dựng lại ở thời điểm chấm phải khớp `prompt_sha` đã phát —
// artifact/rubric đổi giữa lúc hỏi và lúc chấm là drift, không phải verdict hợp
// lệ. Ghi xong thì nonce bị tiêu thụ, nên không dùng lại được.
//
// GIỚI HẠN — nói thẳng, đừng để tưởng là nhiều hơn thực tế: nonce KHÔNG chứng
// minh verdict do một subagent riêng viết. Agent điều phối chạy `review-prompt`
// rồi tự viết verdict kèm nonce vẫn qua được. Một CLI không thể xác minh danh
// tính tác giả (spec §9.5 đã thừa nhận). Nonce chỉ đóng ba đường: chấm mà chưa
// từng hỏi, chấm cho bản artifact khác, và dùng lại verdict cũ.
// ─────────────────────────────────────────────────────────────────────────
function pendingPath(dir, stageId) {
  return join(dir, '.review', `${stageId}.pending.json`)
}

function readPending(dir, stageId) {
  try {
    return JSON.parse(readFileSync(pendingPath(dir, stageId), 'utf8'))
  } catch {
    return null
  }
}

function nonceInstruction(nonce) {
  return `
=== NONCE ===
Chép nguyên văn chuỗi dưới đây vào field "nonce" ở JSON trả về. Thiếu hoặc sai
thì verdict bị từ chối (pp không nhận phán quyết cho một prompt nó chưa phát).

${nonce}
`
}

export function reviewPromptCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stderr.write('pp review-prompt <feature> <stage>\n'); return 2 }
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)
  if (noT2Tier(config, feature, stageId)) return 2

  const rubricPath = join(root, 'rubric', `${stageId}.md`)
  if (!existsSync(rubricPath)) {
    process.stderr.write(`pp: thiếu rubric/${stageId}.md — không thể tạo prompt review\n`)
    return 2
  }

  const outPath = artifactPath(config, stageId)
  const artifactFile = join(dir, outPath)
  if (!existsSync(artifactFile)) {
    process.stderr.write(`pp: thiếu artifact ${outPath} — chạy stage ${stageId} trước khi review\n`)
    return 2
  }
  // B5 đứng TRƯỚC t1NotPassed, có chủ ý. Khi cả hai cùng đúng (stage chưa tới
  // lượt VÀ T1 chưa xanh), thông điệp "chạy pp gate <stage> trước" là lời khuyên
  // SAI — chính lệnh gate đó cũng sẽ từ chối vì cùng lý do thứ tự. Nguyên nhân
  // gốc phải nói trước nguyên nhân gần.
  if (upstreamBlocked(dir, config, readState(dir), feature, stageId)) return 1
  if (t1NotPassed(dir, config, feature, stageId)) return 1

  // Mỏ neo "vòng review T2 bắt đầu ở đây" — cùng loại với dispatch: usage-sync
  // dùng event này dựng cửa sổ thời gian cho phần traffic token nặng nhất.
  auditEvent(dir, { actor: 'pp', event: 'review-prompt', feature, stage: stageId })

  const prompt = buildReviewPrompt(root, dir, config, stageId)
  // Phát nonce cho ĐÚNG prompt này. Chạy review-prompt lần nữa thì nonce cũ hết
  // hiệu lực — mỗi lúc chỉ có một phiếu hỏi đang mở.
  const nonce = randomBytes(9).toString('hex')
  mkdirSync(join(dir, '.review'), { recursive: true })
  writeFileSync(pendingPath(dir, stageId), JSON.stringify({
    v: 1,
    ts: new Date().toISOString(),
    stage: stageId,
    nonce,
    prompt_sha: hashString(prompt),
  }, null, 2) + '\n')

  process.stdout.write(prompt + nonceInstruction(nonce))
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
    process.stderr.write('pp review-record <feature> <stage> --verdict <file.json>\n')
    return 2
  }
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)
  if (noT2Tier(config, feature, stageId)) return 2

  if (!existsSync(verdictFile)) {
    process.stderr.write(`pp: không tìm thấy verdict file ${verdictFile}\n`)
    return 2
  }
  let verdict
  let raw
  try {
    raw = readFileSync(verdictFile, 'utf8')
    verdict = JSON.parse(raw)
  } catch (err) {
    process.stderr.write(`pp: verdict file ${verdictFile} không phải JSON hợp lệ: ${err.message}\n`)
    return 2
  }
  // Verdict thiếu hoặc findings rỗng = PASS không có finding, không phải crash.
  const findings = Array.isArray(verdict.findings) ? verdict.findings : []
  const highs = findings.filter((f) => f.verdict === 'fail' && f.severity === 'high')

  // B5 trước t1NotPassed (xem lý do ở reviewPromptCmd). Cả hai đứng trước mọi
  // lần ghi evidence: một stage chưa tới lượt không được để lại dấu vết nào.
  if (upstreamBlocked(dir, config, readState(dir), feature, stageId)) return 1
  if (t1NotPassed(dir, config, feature, stageId)) return 1

  // A3: nonce phải hợp lệ TRƯỚC khi bất kỳ evidence nào được ghi. Thứ tự các
  // kiểm tra ở đây có chủ đích: t1NotPassed đứng trước để một stage chưa có T1
  // xanh vẫn nhận đúng thông báo "T2 không được chạy trước T1" thay vì bị đổi
  // thành lỗi nonce (nguyên nhân gần nhất mới là nguyên nhân hữu ích).
  const pending = readPending(dir, stageId)
  if (!pending) {
    process.stderr.write(
      `pp: ${stageId} chưa có phiếu review đang mở — chạy \`pp review-prompt ${feature} ${stageId}\` trước.\n` +
      'pp không nhận phán quyết cho một prompt nó chưa phát.\n',
    )
    return 1
  }
  if (typeof verdict.nonce !== 'string' || verdict.nonce !== pending.nonce) {
    process.stderr.write(
      `pp: verdict thiếu hoặc sai nonce — không khớp phiếu review đang mở của ${stageId}.\n` +
      'Reviewer phải chép nguyên văn nonce trong prompt vào field "nonce".\n',
    )
    return 1
  }
  // Prompt dựng lại BÂY GIỜ phải khớp prompt đã phát. Lệch nghĩa là artifact
  // hoặc rubric đã đổi giữa lúc hỏi và lúc chấm — phán quyết đang nói về một bản
  // khác. Đây chính là phép so mà `prompt_sha` đáng ra phải dùng để làm.
  const promptNow = buildReviewPrompt(root, dir, config, stageId)
  if (promptNow === null || hashString(promptNow) !== pending.prompt_sha) {
    process.stderr.write(
      `pp: artifact hoặc rubric của ${stageId} đã đổi sau khi phát prompt — verdict này chấm cho bản khác.\n` +
      `Chạy lại \`pp review-prompt ${feature} ${stageId}\` rồi review lại bản hiện tại.\n`,
    )
    return 1
  }

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
  // `promptNow` đã được dựng và đối chiếu ở trên — dùng lại, không dựng lần hai
  // (dựng lại có thể ra kết quả khác nếu artifact đổi giữa hai lời gọi, và khi đó
  // archive sẽ ghi một hash không phải hash đã được kiểm).
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
    prompt_sha: hashString(promptNow),
    nonce: pending.nonce,
    prompt_issued_at: pending.ts,
    findings_total: findings.length,
    findings_high: highs.length,
    ok,
  }, null, 2) + '\n')

  // TIÊU THỤ nonce. Phải xoá kể cả khi verdict ĐỎ: một verdict đỏ đã được ghi
  // rồi thì nộp lại chính nó lần nữa không mang thêm thông tin nào, và vòng sau
  // phải là một lượt hỏi mới trên bản artifact đã sửa.
  rmSync(pendingPath(dir, stageId), { force: true })

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
