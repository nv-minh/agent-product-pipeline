import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readState, writeState } from '../state.js'
import { readConfig, stageOrder } from '../config.js'
import { stageDone } from '../gate.js'
import { parseArgs } from '../args.js'
import { auditEvent } from '../audit.js'

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
  process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
  return 2
}

// Trùng chức năng với helper cùng tên (không export) đã có sẵn ở gate.js và
// review.js. Giữ một bản sao cục bộ ở đây thay vì tách ra file dùng chung —
// đúng tinh thần "thay đổi nhỏ nhất": Task 14 chỉ thêm file mới, không đụng
// vào gate.js/review.js đang xanh để tách abstraction dùng chung.
function unknownStageId(feature, stageId, config) {
  process.stdout.write(
    `pp: stage "${stageId}" không tồn tại trong pipeline.json của feature "${feature}"\n` +
    `Các stage có sẵn: ${stageOrder(config).join(', ')}\n`,
  )
  return 2
}

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
function mergeFreshStage(dir, stageId, patch) {
  const fresh = readState(dir)
  fresh.stages = fresh.stages ?? {}
  const prev = fresh.stages[stageId] ?? {}
  const delta = typeof patch === 'function' ? patch(prev) : patch
  fresh.stages[stageId] = { ...prev, ...delta }
  writeState(dir, fresh)
  return fresh.stages[stageId]
}

export function approveCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stdout.write('pp approve <feature> <stage>\n'); return 2 }
  if (!root) return rootMissing()

  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  // CARRY-FORWARD 3: stage id sai chính tả phải báo rõ tên và liệt kê stage
  // thật, exit 2 — không phải để `state.stages[stageId]` undefined rồi rơi
  // xuống nhánh "chưa có gate pass" một cách gây hiểu lầm (2 khác 1: đây là
  // đối số sai, stage còn chưa hề tồn tại, không phải gate chưa xanh).
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

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
  const st = state.stages?.[stageId]
  if (st?.status === 'failed' || st?.status === 'blocked') {
    process.stdout.write(
      `pp: ${stageId} đang ở trạng thái "${st.status}" — không duyệt được. ` +
      `Chạy lại \`pp gate ${feature} ${stageId}\` cho xanh, hoặc dùng ` +
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
    process.stdout.write(
      `pp: ${stageId} chưa qua gate theo evidence hiện tại — không duyệt được (còn thiếu tier: ${verdict.outstanding.join(', ')}).\n`,
    )
    for (const n of verdict.notes) process.stdout.write(`  ⚠ ${n}\n`)
    return 1
  }

  mergeFreshStage(dir, stageId, { human: 'approved' })
  auditEvent(dir, { actor: 'human', event: 'approve', feature, stage: stageId })
  process.stdout.write(`✓ đã duyệt ${stageId}\n`)
  return 0
}

export function overrideCmd(args, { root }) {
  const { positional, flags } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stdout.write('pp override <feature> <stage> --reason "<lý do>"\n'); return 2 }
  if (!root) return rootMissing()

  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

  const reason = requireReason(flags)
  if (reason === null) {
    process.stdout.write('pp: override bắt buộc có --reason khác rỗng. Cửa thoát hiểm phải ghi sổ.\n')
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
  if (!feature || !stageId) { process.stdout.write('pp unblock <feature> <stage> --reason "<lý do>"\n'); return 2 }
  if (!root) return rootMissing()

  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)

  const reason = requireReason(flags)
  if (reason === null) {
    process.stdout.write('pp: unblock bắt buộc có --reason khác rỗng.\n')
    return 2
  }

  mergeFreshStage(dir, stageId, { status: 'pending', attempts: 0 })
  noteLesson(root, stageId, `unblock (${feature}): ${reason}`)
  auditEvent(dir, { actor: 'human', event: 'unblock', feature, stage: stageId, reason })
  process.stdout.write(`↻ đã gỡ block ${stageId}, attempts về 0\n`)
  return 0
}
