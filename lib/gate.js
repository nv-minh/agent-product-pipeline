import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { newEvidence, hasFailure, tiersWithEvidence } from './evidence.js'
import { readState, writeState, hashInputs, hashArtifact } from './state.js'
import { MAX_ATTEMPTS } from './plan.js'

// ─────────────────────────────────────────────────────────────────────────
// FIX review cuối (finding 1, 3, 4) — LUẬT "STAGE ĐÃ XONG CHƯA" NẰM Ở ĐÂY,
// MỘT CHỖ DUY NHẤT.
//
// Trước bản vá này, `runT1` và `reviewRecordCmd` mỗi bên tự ghi
// `status: 'done'`, không bên nào biết bên kia tồn tại; yêu cầu "stage khai
// báo gate:["t1","t2"] thì phải chạy CẢ HAI" chỉ tồn tại dưới dạng văn xuôi
// trong commands/pp.md — tức là nằm trong model, đúng chỗ mà §2.1 nói control
// flow không bao giờ được nằm. Hệ quả: một stage tới `done` chỉ bằng T1, hoặc
// chỉ bằng một file JSON do LLM viết.
//
// `stageDone` là hàm quyết định dùng chung đó. Nó KHÔNG tin state trong bộ
// nhớ: với MỌI tier khai báo trong `gate`, tier ấy phải (a) có kết quả `pass`
// ghi trong state VÀ (b) `hasFailure()` đọc lại log trên đĩa phải trả false.
// Điều 2 của constitution: hoàn thành đến từ exit code ghi trong `.evidence/`,
// không phải từ một cờ trong bộ nhớ.
// ─────────────────────────────────────────────────────────────────────────

// `gate: []` (không khai báo tier nào) KHÔNG có nghĩa là "xong ngay lập tức" —
// nghĩa đó sẽ biến một pipeline.json bị sửa thành cửa hậu tới `done` mà không
// cần một exit code nào. Không khai báo thì mặc định vẫn phải có T1.
export function requiredTiers(config, stageId) {
  const gate = config.stages?.[stageId]?.gate
  return Array.isArray(gate) && gate.length > 0 ? gate : ['t1']
}

// Artifact của stage = phần tử CUỐI của `outputs` (đúng thứ `runT1` chấm và
// `review-prompt` đưa cho reviewer).
export function artifactOf(config, stageId) {
  const outs = config.stages?.[stageId]?.outputs ?? []
  return outs[outs.length - 1] ?? null
}

// Hash artifact ĐANG nằm trên đĩa. `null` = stage không khai báo output nào —
// khi đó không có gì để chứng nhận nên phép so hash vô nghĩa; đây không phải
// cửa hậu: luật evidence bên dưới vẫn áp nguyên vẹn.
export function currentArtifactHash(featureDir, config, stageId) {
  const rel = artifactOf(config, stageId)
  return rel ? hashArtifact(featureDir, rel) : null
}

export function tierPassed(featureDir, config, state, stageId, tier) {
  const rec = state?.stages?.[stageId]?.tiers?.[tier]
  if (!rec || rec.result !== 'pass') return false
  if (hasFailure(featureDir, stageId, tier)) return false
  // R1: kết quả tier gắn chặt với bản artifact nó đã chấm. Hash lệch = artifact
  // đã bị sửa sau khi tier chạy → phán quyết cũ không còn hiệu lực. KHÔNG có
  // `artifact_hash` (state do bản pp cũ ghi) cũng tính là chưa qua: nguồn gốc
  // không rõ thì phải kiểm lại — đúng cách `isStale` đối xử với `inputs_hash`
  // vắng mặt.
  return (rec.artifact_hash ?? null) === currentArtifactHash(featureDir, config, stageId)
}

export function stageDone(featureDir, config, state, stageId) {
  const st = state?.stages?.[stageId]
  // BẪY ĐÃ CÓ TIỀN LỆ Ở `isStale`: stage `overridden` được hoàn tất bằng
  // QUYẾT ĐỊNH TAY của con người, không bằng gate — nó không có evidence,
  // không có artifact_hash, không có kết quả tier nào. Bắt nó chứng minh bằng
  // đúng những thứ đó sẽ re-gate nó mãi mãi và feature không bao giờ hoàn tất
  // (đúng vòng lặp vô hạn mà bản vá trước đã diệt). Miễn trừ y hệt §7.5.
  if (st?.overridden) return { done: true, outstanding: [], notes: [] }

  const outstanding = []
  const notes = []
  const artifact = artifactOf(config, stageId)
  for (const tier of requiredTiers(config, stageId)) {
    if (tierPassed(featureDir, config, state, stageId, tier)) continue
    outstanding.push(tier)
    const rec = st?.tiers?.[tier]
    // Tier ghi `pass`, log sạch → thứ duy nhất còn lại làm nó trượt là hash
    // artifact. Nói thẳng ra, đừng để người đọc tưởng tier chưa từng chạy.
    if (rec?.result === 'pass' && !hasFailure(featureDir, stageId, tier)) {
      notes.push(rec.artifact_hash
        ? `${tier}: ${artifact} đã bị SỬA SAU KHI ${tier} chạy — phán quyết cũ chấm cho bản khác, phải chạy lại ${tier}`
        : `${tier}: không có artifact_hash (state bản cũ) — không rõ ${tier} đã chấm bản nào, phải chạy lại`)
    }
  }

  // R3: §7.4 là luật về EVIDENCE, không phải luật về mảng `gate`. Mọi log tier
  // có mặt trên đĩa đều bị quét — một tier không nằm trong `gate` mà để lại
  // `Exit status:` khác 0 vẫn chặn `done`. (Tier có trong `gate` mà KHÔNG có
  // evidence thì vẫn chỉ là "còn thiếu", đúng như trước.)
  for (const tier of tiersWithEvidence(featureDir, stageId)) {
    if (outstanding.includes(tier)) continue
    if (!hasFailure(featureDir, stageId, tier)) continue
    outstanding.push(tier)
    notes.push(`${tier}: .evidence/${stageId}.${tier}.log có Exit status khác 0 (dù ${tier} không nằm trong gate) — §7.4 chặn done`)
  }
  return { done: outstanding.length === 0, outstanding, notes }
}

// ─────────────────────────────────────────────────────────────────────────
// R2 (review cuối) — DÒNG TRẠNG THÁI CHUẨN, MỘT HÀM, HAI LỆNH.
// `commands/pp.md` bước 4 dặn agent: "Chỉ khi `pp gate` / `pp review-record`
// in `✓ <stage>: done` thì stage mới xong". `gate` in dòng đó; `review-record`
// chỉ in evidence log rồi exit 0. Trên MỌI stage khai báo `t2` — tức mọi stage
// mặc định — tín hiệu mà agent được dặn phải chờ KHÔNG BAO GIỜ xuất hiện, và
// nó bị đẩy vào chỗ tự kết luận: đúng thứ cả hệ thống này sinh ra để chặn.
// Một hàm duy nhất sinh dòng đó cho cả hai lệnh, để chúng không thể trôi khỏi
// nhau nữa.
export function statusLine(feature, stageId, config, verdict) {
  if (verdict.done) {
    return `\n✓ ${stageId}: done — mọi tier bắt buộc (${requiredTiers(config, stageId).join(', ')}) đã xanh\n`
  }
  const notes = (verdict.notes ?? []).map((n) => `  ⚠ ${n}\n`).join('')
  // T2 không được chạy trước T1: khi cả hai còn thiếu, lối ra là `pp gate`.
  const how = verdict.outstanding.includes('t1')
    ? `  chạy: pp gate ${feature} ${stageId}\n`
    : verdict.outstanding.includes('t2')
      ? `  chạy: pp review-prompt ${feature} ${stageId}  →  pp review-record ${feature} ${stageId} --verdict <file.json>\n`
      : `  chạy: pp gate ${feature} ${stageId}\n`
  return `\n⏳ ${stageId}: CHƯA done — còn thiếu tier: ${verdict.outstanding.join(', ')}\n${notes}${how}`
}

// FIX review cuối (finding 6b): một stage bị tắt phải để lại DẤU VẾT, không
// biến mất im lặng. `nextStage` chỉ `continue` qua nó, nên STATE.md không
// phân biệt được "cố ý tắt" với "chưa từng tồn tại" — §7.3 muốn
// `{status: 'skipped', reason: 'disabled'}`. Chỉ ghi khi stage chưa có bản
// ghi nào: một stage từng chạy rồi mới bị tắt vẫn giữ nguyên lịch sử của nó.
function recordDisabled(config, state) {
  for (const [id, stage] of Object.entries(config.stages ?? {})) {
    if (stage.enabled) continue
    if (state.stages[id]) continue
    state.stages[id] = { status: 'skipped', reason: 'disabled' }
  }
}

// Ghi kết quả của MỘT tier vào STATE.md rồi hỏi `stageDone` xem cả stage đã
// xong chưa. Đây là ĐƯỜNG DUY NHẤT `status: 'done'` được ghi — `runT1` và
// `reviewRecordCmd` đều đi qua đây, không bên nào tự kết luận.
export function recordTierRun(featureDir, config, stageId, tier, { ok, evidence, inputsHash }) {
  // Đọc state tươi ngay tại thời điểm ghi (không dùng bản chụp cũ) để không
  // làm rớt cập nhật của stage khác xảy ra giữa lúc đọc và lúc ghi.
  const next = readState(featureDir)
  next.feature = config.feature
  next.stages = next.stages ?? {}
  const prev = next.stages[stageId] ?? {}
  const prevTier = prev.tiers?.[tier] ?? {}
  // R1: ghi hash artifact NGAY tại lúc ghi kết quả tier, để lần sau còn biết
  // phán quyết này được chấm cho bản artifact nào.
  const artifact_hash = currentArtifactHash(featureDir, config, stageId)
  // FIX review cuối (finding 7): `attempts` là BỘ ĐẾM RETRY (§9.1), không
  // phải bộ đếm số lần chạy. Bản cũ cộng 1 vô điều kiện nên chính các gate
  // XANH tiêu hết ngân sách: T1 pass = 1, T2 pass = 2, một lần re-gate = 3,
  // và lần đỏ THẬT SỰ đầu tiên bị `blocked` ngay với 0 lượt sửa. Chỉ đếm
  // LẦN ĐỎ; trần 3 áp cho số lần đỏ.
  const attempts = (prev.attempts ?? 0) + (ok ? 0 : 1)

  const entry = {
    ...prev,
    tiers: {
      ...(prev.tiers ?? {}),
      // attempts của từng tier giữ nguyên lịch sử số lần đỏ của tier đó
      // (không reset) — đây là phần sổ sách, không phải ngân sách.
      [tier]: { result: ok ? 'pass' : 'fail', evidence, attempts: (prevTier.attempts ?? 0) + (ok ? 0 : 1), artifact_hash },
    },
    attempts,
    // `evidence` top-level = log của lần chạy gần nhất (giữ tương thích với
    // consumer cũ); bằng chứng đầy đủ của từng tier nằm trong `tiers`.
    evidence,
  }
  // Re-gate (kể cả bởi T2) thu hồi approval cũ.
  delete entry.human

  // Một lần CHẠY GATE quyết định lại từ evidence: cờ `overridden` (miễn trừ ở
  // `stageDone` cho phía ĐỌC) không được tự làm gate xanh ở đây, nếu không một
  // lần chạy đỏ trên stage từng override sẽ bị ghi thành `done`.
  const { overridden: _overridden, ...evaluated } = entry
  const verdict = stageDone(
    featureDir,
    config,
    { ...next, stages: { ...next.stages, [stageId]: evaluated } },
    stageId,
  )

  if (verdict.done) {
    entry.status = 'done'
    entry.gate = 'pass'
    delete entry.outstanding
    // Stage đã xong thì ngân sách retry trả về đầy (lịch sử vẫn nằm ở
    // tiers[*].attempts và trong .evidence/).
    entry.attempts = 0
    // FIX review cuối (finding 8): `overridden` phải được xoá khi stage qua
    // gate SẠCH, đúng như `human` bị xoá. Bản cũ giữ cờ này qua `{...prev}`,
    // mà `isStale` lại kiểm nó TRƯỚC khi so hash — nên một lần dùng cửa
    // thoát hiểm miễn nhiễm §7.5 cho stage đó tới hết đời feature.
    // `override_count` KHÔNG xoá: đó là sổ ghi (constitution Điều 10).
    delete entry.overridden
    if (inputsHash) entry.inputs_hash = inputsHash
  } else if (!ok) {
    entry.status = attempts >= MAX_ATTEMPTS ? 'blocked' : 'failed'
    entry.gate = 'fail'
    entry.outstanding = verdict.outstanding
    // F1 — MỘT OVERRIDE KHÔNG SỐNG SÓT QUA MỘT GATE VỪA CHỨNG MINH LÀ ĐỎ.
    // Bản trước chỉ tước `overridden` khỏi BẢN SAO `evaluated` dùng để hỏi
    // `stageDone`; bản ghi `entry` xuống đĩa vẫn giữ nguyên cờ. Hệ quả quan
    // sát được: state `{status:'failed', gate:'fail', overridden:true}` kèm
    // `Exit status: 1` trong log T1 vẫn cho `pp approve` in `✓ đã duyệt` và
    // exit 0, vì `stageDone` đoản mạch ngay tại `overridden`. Override nghĩa
    // là "tôi xét thấy chấp nhận được"; một exit code đỏ SAU ĐÓ là dữ kiện
    // mới chống lại chính phán đoán ấy — người dùng chỉ cần override lại nếu
    // vẫn giữ ý. Xoá đúng như nhánh gate xanh đã xoá.
    // `override_count` KHÔNG xoá: đó là sổ ghi (constitution Điều 10).
    delete entry.overridden
  } else {
    // Tier này xanh nhưng stage CHƯA xong: không phải `failed` (không có gì
    // đỏ) và tuyệt đối không phải `done`. `in_progress` = còn tier phải chạy,
    // và Stop hook giữ phiên lại đúng như §9.1 mô tả.
    entry.status = 'in_progress'
    entry.gate = 'pending'
    entry.outstanding = verdict.outstanding
    if (inputsHash) entry.inputs_hash = inputsHash
  }

  next.stages[stageId] = entry
  recordDisabled(config, next)
  writeState(featureDir, next)
  return verdict
}

export function runT1(featureDir, config, state, stageId, checks) {
  const stage = config.stages[stageId]
  // REVIEW FINDING 1: an unknown stage id must fail loudly here too — this
  // protects every caller (gateCmd today, later tasks tomorrow) from an
  // unguarded `stage.outputs` property access turning a typo'd stage id into
  // an internal TypeError instead of a stated precondition violation.
  if (!stage) {
    throw new Error(`stage "${stageId}" không được khai báo trong pipeline.json`)
  }
  // FINDING 1: Read fresh state from disk at TOP for authoritative prev
  const prev = readState(featureDir).stages?.[stageId] ?? {}
  const attempt = (prev.attempts ?? 0) + 1
  const ev = newEvidence(featureDir, stageId, 't1', attempt)

  const primaryOutput = stage.outputs[stage.outputs.length - 1]
  const artifactPath = join(featureDir, primaryOutput)

  // FINDING 4: Check artifact existence before reading
  if (!existsSync(artifactPath)) {
    ev.record('artifact-exists', `Missing artifact: ${primaryOutput}`, 1)
  } else {
    const text = readFileSync(artifactPath, 'utf8')
    for (const check of checks) {
      try {
        const res = check.run(text, { featureDir, stage, config })
        ev.record(`pp-check ${res.name} ${primaryOutput}`, res.ok ? '' : res.messages.join('\n'), res.ok ? 0 : 1)
      } catch (err) {
        // FINDING 3: Record failing check on throw
        ev.record(`pp-check ${check.name} ${primaryOutput}`, String(err), 1)
      }
    }
  }

  // FINDING 2: Compute hash BEFORE calling finish()
  let inputsHash
  if (!ev.failed) {
    try {
      inputsHash = hashInputs(featureDir, stage.inputs)
    } catch (err) {
      // If hashInputs throws, record as failed check and fail the run
      ev.record('inputs-hash', String(err), 1)
    }
  }

  const ok = !ev.failed
  const evidence = ev.finish(ok ? 'PASS' : 'FAIL')
  const verdict = recordTierRun(featureDir, config, stageId, 't1', { ok, evidence, inputsHash })
  return { ok, evidencePath: evidence, ...verdict }
}
