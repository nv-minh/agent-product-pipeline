import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readState, writeState, staleOrUnverifiable, withStateLock } from '../state.js'
import { readConfig } from '../config.js'
import { stageDone } from '../gate.js'
import { nextStage } from '../plan.js'
import { parseArgs } from '../args.js'
import { auditEvent } from '../audit.js'
import { unknownStageId, upstreamBlocked } from './precond.js'

// CORRECTION so với brief: brief định nghĩa một `parse(args)` cục bộ lọc
// positional bằng `args.filter(a => ... args.indexOf(a) ...)`. `indexOf`
// trả về vị trí ĐẦU TIÊN của một giá trị trong mảng, không phải vị trí của
// phần tử đang được xét — nên khi một giá trị lặp lại (ví dụ chữ --reason
// trùng tên feature, hoặc trùng một stage id) việc lọc dựa nhầm vào "token
// đứng trước lần xuất hiện ĐẦU TIÊN của giá trị đó" thay vì "token đứng
// ngay trước CHÍNH token đang xét". Đây là lớp bug đã bị loại khỏi toàn bộ
// project. Dùng `parseArgs` (dò theo VỊ TRÍ token, không theo GIÁ TRỊ) như
// mọi lệnh khác trong bin/pp.

function rootMissing() {
  process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
  return 2
}

// (`unknownStageId` từng có một bản copy ở đây, một ở gate.js và một ở review.js
// — ba bản là đã quá rule-of-three của Điều 1. Nay dùng chung ./precond.js.)

// CARRY-FORWARD 4: `--reason` là bắt buộc cho override/unblock, và phải khác
// rỗng sau khi trim. Một flag đứng cuối dòng lệnh (không có giá trị theo
// sau, hoặc theo sau ngay bởi một flag khác) được parseArgs trả về boolean
// `true`, không phải chuỗi — phải bị từ chối giống hệt trường hợp thiếu hẳn
// --reason, không được để `true.trim()` ném TypeError ra ngoài.
function requireReason(flags) {
  const r = flags.reason
  if (typeof r !== 'string' || r.trim() === '') return null
  return r
}

// override/unblock đều phải "ghi sổ": append một dòng có ngày vào
// lessons/<stage>.md, tạo thư mục nếu chưa có. Đây là bằng chứng cho
// nguyên tắc "cửa thoát hiểm phải có ghi sổ" — không phải log để trang trí.
function noteLesson(root, stageId, line) {
  mkdirSync(join(root, 'lessons'), { recursive: true })
  appendFileSync(join(root, 'lessons', `${stageId}.md`), `- ${new Date().toISOString().slice(0, 10)} — ${line}\n`)
}

// CARRY-FORWARD 2: merge lên state đọc TƯƠI từ đĩa ngay tại thời điểm ghi —
// không dùng lại một snapshot đã đọc trước đó trong hàm gọi (vd. snapshot
// dùng để validate gate/stage). `patch` có thể là object hoặc một hàm nhận
// stage hiện tại (đọc tươi) và trả object patch — dùng hàm khi patch cần
// đọc giá trị cũ (như override_count) từ chính bản ghi tươi đó, không phải
// từ một bản chụp cũ hơn.
// `drop` xoá HẲN các key khỏi bản ghi stage. Cần một cơ chế xoá tường minh vì
// merge thuần không bao giờ bỏ được key: `unblock` phải tước những cờ mà một lần
// override để lại, không phải chỉ ghi thêm lên trên chúng (xem A4 ở unblockCmd).
// C1: cụm đọc-tươi → merge → ghi phải nằm trong cùng khoá với `recordTierRun` —
// một `pp approve` chen giữa lúc `pp gate` đang đọc-và-ghi (hoặc ngược lại) là
// lost update trên chính sổ cái.
function mergeFreshStage(dir, stageId, patch, drop = []) {
  return withStateLock(dir, () => {
    const fresh = readState(dir)
    fresh.stages = fresh.stages ?? {}
    const prev = fresh.stages[stageId] ?? {}
    const delta = typeof patch === 'function' ? patch(prev) : patch
    const next = { ...prev, ...delta }
    for (const k of drop) delete next[k]
    fresh.stages[stageId] = next
    // D4: approve/override/unblock đều dời vị trí pipeline — `current` phải
    // dời theo, cùng cách recordTierRun làm (xem chú thích ở đó).
    try {
      fresh.current = nextStage(dir, readConfig(dir), fresh).stage
    } catch {
      fresh.current = stageId
    }
    writeState(dir, fresh)
    return next
  })
}

export function approveCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stderr.write('pp approve <feature> <stage>\n'); return 2 }
  if (!root) return rootMissing()

  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  // CARRY-FORWARD 3: stage id sai chính tả phải báo rõ tên và liệt kê stage
  // thật, exit 2 — không phải để `state.stages[stageId]` undefined rồi rơi
  // xuống nhánh "chưa có gate pass" một cách gây hiểu lầm (2 khác 1: đây là
  // đối số sai, stage còn chưa hề tồn tại, không phải gate chưa xanh).
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)
  // FINDING (review 8c825c9..44c1ecb): approveCmd TỪNG không đọc `stage.human`,
  // nên chữ ký người đóng được lên stage không có human gate (15-fixplan,
  // 40-regression, 05-impact, 40-testplan) — exit 0, STATE ghi
  // `human: approved`, audit ghi một event actor:human. Điều 9 và spec §2(Q3)
  // chốt "đúng một gate mỗi pipeline"; một sổ kiểm toán có 3 chữ ký người
  // không còn trả lời được câu hỏi nó tồn tại để trả lời: ai đã gác cửa nào.
  // exit 2 (đối số sai — stage này không có gì để duyệt), không phải 1.
  if (!config.stages[stageId].human) {
    process.stderr.write(
      `pp: ${stageId} không có human gate (human: false trong pipeline.json) — không có gì để duyệt.\n` +
      `Stage này done ngay khi mọi tier bắt buộc xanh; \`pp status ${feature}\` cho biết bước kế tiếp.\n`,
    )
    return 2
  }

  const state = readState(dir)
  // Duyệt một stage chưa xanh sẽ vô hiệu hoá chính cái gate của con người —
  // từ chối thẳng, exit 1 (thao tác thất bại, không phải đối số sai).
  // F1 — DUYỆT MỘT STAGE KHÔNG Ở TRẠNG THÁI CÓ THỂ HOÀN TẤT LÀ VÔ NGHĨA.
  // `stageDone` đoản mạch trên `overridden`, nên một stage mang cả
  // `overridden: true` LẪN `status: 'failed'` (gate chạy lại và đỏ, hoặc
  // STATE.md bị sửa tay) từng lọt qua nhánh dưới và được duyệt. `recordTierRun`
  // nay xoá `overridden` khi gate đỏ, nhưng trạng thái là một dữ kiện ĐỘC LẬP:
  // chữ ký của con người không được đặt lên một stage mà chính sổ sách đang
  // ghi là failed/blocked, dù cờ nào còn sót lại. Lối ra là `pp gate` cho
  // xanh, hoặc `pp unblock` / `pp override` — những lệnh có ghi sổ.
  // A4: kiểm theo DANH SÁCH TRẮNG, không theo danh sách đen. Bản cũ chỉ loại
  // `failed`/`blocked`, nên mọi trạng thái khác — kể cả `pending` — đều lọt vào
  // nhánh dưới, và ở đó `stageDone` đoản mạch trên `overridden`. Chữ ký của con
  // người chỉ được đặt lên một stage mà sổ sách đang ghi là `done`.
  const st = state.stages?.[stageId]
  if (st?.status !== 'done') {
    process.stderr.write(
      `pp: ${stageId} đang ở trạng thái "${st?.status ?? 'pending'}" — không duyệt được. ` +
      `Chạy \`pp gate ${feature} ${stageId}\` cho xanh, hoặc dùng ` +
      `\`pp unblock\` / \`pp override\` (có ghi sổ) trước khi duyệt.\n`,
    )
    return 1
  }

  // R4 (review cuối): hỏi lại `stageDone` — KHÔNG đọc trường `gate` trong
  // STATE.md. Kiểm chứng: thêm một dòng `Exit status: 1` vào log T1 của một
  // stage đã done thì `pp approve` VẪN THÀNH CÔNG và feature đi tiếp, vì cờ
  // `gate: 'pass'` vẫn nằm nguyên đó. Chữ ký của con người phải đặt lên dữ
  // kiện hiện tại, không lên một lời khai cũ. (`stageDone` tự miễn trừ stage
  // `overridden` — một override THUẦN, chưa có lần chạy gate nào, vẫn duyệt
  // được; đó là thứ giữ cho pipeline kết thúc.)
  const verdict = stageDone(dir, config, state, stageId)
  if (!verdict.done) {
    process.stderr.write(
      `pp: ${stageId} chưa qua gate theo evidence hiện tại — không duyệt được (còn thiếu tier: ${verdict.outstanding.join(', ')}).\n`,
    )
    for (const n of verdict.notes) process.stdout.write(`  ⚠ ${n}\n`)
    return 1
  }

  // B6 — `approve` DUYỆT ĐƯỢC ĐÚNG CÁI STAGE MÀ `pp status` ĐANG BÁO `regate`.
  //
  // `stageDone` chỉ hỏi "evidence của CHÍNH stage này có đỡ được chữ done"; nó
  // không bao giờ hỏi "input thượng nguồn có còn như lúc gate xanh". Quan sát
  // được, không suy đoán: 10-prd done + T2 xanh, nối thêm vào `00-brief.md` dòng
  // "mọi yêu cầu ở trên bị thay bằng: cho phép ẩn danh xoá dữ liệu", rồi
  //
  //   pp status  demo        → regate — "input thượng nguồn đã đổi"
  //   pp approve demo 10-prd → "✓ đã duyệt", exit 0
  //
  // Chữ ký của con người vừa được đặt lên một PRD viết cho một bản brief KHÁC.
  // Spec §7.6 nói thẳng: "Human gate đã duyệt cũng bị thu hồi nếu input đổi" —
  // vậy thì càng không được CẤP MỚI một approval khi input đã đổi.
  // `staleOrUnverifiable` là đúng phép bọc mà `pp report` đã dùng (nay dùng
  // chung), nên ba lệnh nói cùng một chuyện về cùng một stage.
  if (staleOrUnverifiable(dir, config, state, stageId)) {
    process.stderr.write(
      `pp: ${stageId} đã done nhưng INPUT THƯỢNG NGUỒN đã đổi kể từ lần gate xanh — không duyệt được.\n` +
      `Chạy lại \`pp gate ${feature} ${stageId}\` trên bản hiện tại rồi duyệt.\n`,
    )
    return 1
  }

  // B5: không ký lên một stage khi stage trước nó còn chưa xong — chữ ký sẽ nói
  // về một cái nền chưa tồn tại.
  if (upstreamBlocked(dir, config, state, feature, stageId)) return 1

  mergeFreshStage(dir, stageId, { human: 'approved' })
  auditEvent(dir, { actor: 'human', event: 'approve', feature, stage: stageId })
  process.stdout.write(`✓ đã duyệt ${stageId}\n`)
  return 0
}

export function overrideCmd(args, { root }) {
  const { positional, flags } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stderr.write('pp override <feature> <stage> --reason "<lý do>"\n'); return 2 }
  if (!root) return rootMissing()

  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

  const reason = requireReason(flags)
  if (reason === null) {
    process.stderr.write('pp: override bắt buộc có --reason khác rỗng. Cửa thoát hiểm phải ghi sổ.\n')
    return 2
  }

  const merged = mergeFreshStage(dir, stageId, (prev) => ({
    status: 'done',
    gate: 'pass',
    // CARRY-FORWARD 1: `overridden: true` là thứ DUY NHẤT ngăn `isStale`
    // (lib/state.js) coi một stage `done` không có `inputs_hash` là stale
    // mãi mãi — override không bao giờ ghi `inputs_hash` (không có "input
    // đã qua kiểm" nào để hash, gate vốn đỏ). Bỏ cờ này sẽ khiến
    // `pp advance`/`pp status` quay lại đòi re-gate đúng stage vừa được
    // người duyệt tay, vô hạn.
    overridden: true,
    // Đếm số lần override TRÊN CHÍNH stage này (không phải toàn feature) —
    // đây là con số constitution.md dùng để nói "gate bị override ≥3 lần
    // nghĩa là gate đó sai, sửa luật, đừng sửa người" (xem pp report).
    override_count: (prev.override_count ?? 0) + 1,
    reason,
  }))
  noteLesson(root, stageId, `override (${feature}): ${reason}`)
  // Mirror vào audit (lessons/ vẫn là sổ chính của quyết định người — audit
  // chỉ thêm ts đầy đủ + bộ đếm để báo cáo/mining dùng).
  auditEvent(dir, {
    actor: 'human', event: 'override', feature, stage: stageId, reason,
    details: { count: merged.override_count },
  })
  process.stdout.write(`⚠ đã override ${stageId} — đã ghi vào lessons/${stageId}.md\n`)
  return 0
}

export function unblockCmd(args, { root }) {
  const { positional, flags } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stderr.write('pp unblock <feature> <stage> --reason "<lý do>"\n'); return 2 }
  if (!root) return rootMissing()

  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

  const reason = requireReason(flags)
  if (reason === null) {
    process.stderr.write('pp: unblock bắt buộc có --reason khác rỗng.\n')
    return 2
  }

  // A4 — `unblock` PHẢI TƯỚC CÁC CỜ MỘT LẦN OVERRIDE ĐỂ LẠI, VÀ CHỈ ĐƯỢC GỠ THỨ
  // ĐANG BỊ KHOÁ.
  //
  // Bản cũ merge đúng `{status:'pending', attempts:0}` và không đụng gì khác, nên
  // `overridden: true` sống sót. `stageDone` đoản mạch `true` trên `overridden`, và
  // `approveCmd` chỉ chặn `failed`/`blocked` — nên chuỗi ba lệnh dưới đây từng
  // thành công (quan sát được, không suy đoán):
  //
  //   pp override demo 10-prd --reason x   → status done, overridden true
  //   pp unblock  demo 10-prd --reason y   → status pending, overridden VẪN true
  //   pp approve  demo 10-prd              → "✓ đã duyệt", exit 0
  //
  // Kết quả: `{status:'pending', gate:'pass', overridden:true, human:'approved'}`
  // trên một stage KHÔNG CÓ thư mục `.evidence/` nào — chữ ký của con người đặt lên
  // một stage chưa từng chạy một lần gate. Đúng thứ Điều 2 tồn tại để chặn.
  //
  // Thêm nữa: bản cũ không có tiền điều kiện trạng thái NÀO, nên `pp unblock` gỡ
  // được cả một stage đang `done` và đã được duyệt, âm thầm huỷ approval đó.
  // `bin/pp` vẫn tự mô tả lệnh này là "Gỡ một stage blocked".
  const st = readState(dir).stages?.[stageId]
  const status = st?.status
  if (status !== 'blocked' && status !== 'failed') {
    process.stderr.write(
      `pp: ${stageId} đang ở trạng thái "${status ?? 'pending'}" — không có gì để gỡ. ` +
      '`unblock` chỉ dùng cho stage `blocked` hoặc `failed`.\n' +
      (status === 'done'
        ? `Muốn làm lại stage đã done thì sửa artifact rồi chạy \`pp gate ${feature} ${stageId}\` — ` +
          'một lần gate sẽ tự thu hồi approval và cờ override.\n'
        : ''),
    )
    return 1
  }

  // `override_count` KHÔNG bị xoá: đó là sổ ghi của Điều 10 ("gate bị override ≥3
  // lần nghĩa là gate đó sai"). Mọi cờ còn lại đều là kết luận của một lượt chạy
  // cũ và không được sống sót qua một lần reset.
  mergeFreshStage(dir, stageId, { status: 'pending', attempts: 0 },
    ['overridden', 'gate', 'human', 'reason', 'outstanding'])
  noteLesson(root, stageId, `unblock (${feature}): ${reason}`)
  auditEvent(dir, { actor: 'human', event: 'unblock', feature, stage: stageId, reason })
  process.stdout.write(`↻ đã gỡ block ${stageId}, attempts về 0\n`)
  return 0
}
