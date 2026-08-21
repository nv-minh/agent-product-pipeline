import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { runT1, statusLine } from '../gate.js'
import { checksFor } from '../registry.js'
import { parseArgs } from '../args.js'
import { auditEvent } from '../audit.js'
import { unknownStageId, upstreamBlocked } from './precond.js'

export function gateCmd(args, { root, workspace }) {
  // Dùng parseArgs dùng chung thay vì args.filter(a => !a.startsWith('--')):
  // pattern đó nhặt nhầm token khi flag đứng trước positional (--tier t1 demo
  // 40-testplan sẽ lấy "t1" làm feature). positional[0]/[1] luôn đúng thứ tự
  // feature rồi stage bất kể flag nằm ở đâu trên dòng lệnh.
  const { positional, flags } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stderr.write('pp gate <feature> <stage> [--tier t1]\n'); return 2 }
  // B4 — `--tier` ĐƯỢC QUẢNG CÁO TRONG USAGE RỒI BỊ BỎ QUA IM LẶNG.
  // Quan sát được: `pp gate demo 10-prd --tier t2` chạy T1 và ghi
  // `.evidence/10-prd.t1.log`, exit 0. Người gõ lệnh đó tin là T2 vừa chạy; sổ
  // sách ghi t1. Đây là loại sai tệ nhất mà một CLI có thể mắc — làm một việc
  // KHÁC việc được yêu cầu rồi báo thành công.
  //
  // `pp gate` không thể chạy T2: T2 là tầng đối kháng, cần một reviewer bên
  // ngoài (§5). Nên lối ra không phải "thực thi --tier t2" mà là nói thẳng và
  // chỉ đúng đường. exit 2 (đối số sai — gate chưa hề chạy), không phải 1.
  const tier = flags.tier
  if (tier !== undefined && String(tier).toLowerCase() !== 't1') {
    const shown = typeof tier === 'string' ? `"${tier}"` : '(không có giá trị)'
    process.stderr.write(
      `pp: --tier ${shown} không hợp lệ — \`pp gate\` chỉ chạy T1.\n` +
      'T2 là tầng đối kháng, chạy bằng reviewer bên ngoài:\n' +
      `  pp review-prompt ${feature} ${stageId}\n` +
      `  pp review-record ${feature} ${stageId} --verdict <file.json>\n` +
      'Bỏ --tier, hoặc dùng --tier t1.\n',
    )
    return 2
  }
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  // REVIEW FINDING 1: a typo'd stage id must say so — naming the bad id and
  // listing the real ones — instead of falling through to runT1 and letting
  // an unguarded `config.stages[stageId].outputs` throw an internal
  // TypeError. Exit 2 (bad argument), not 1 (gate failed): the stage never ran.
  if (!config.stages[stageId]) return unknownStageId(feature, stageId, config)
  // B5: kiểm TRƯỚC khi chạy T1 — một stage chưa tới lượt thì không được để lại
  // evidence, không được đụng vào `attempts`, không được ghi gì vào STATE.md.
  const state = readState(dir)
  if (upstreamBlocked(dir, config, state, feature, stageId)) return 1
  const stage = config.stages[stageId]
  // FINDING (review 8c825c9..44c1ecb): schema hỏng JSON từng bay ra `bin/pp`
  // `.catch` và exit 1 — ĐÚNG MÃ của "gate đỏ", nên conductor bắt agent viết
  // lại artifact trong khi lỗi nằm ở bản cài. Lỗi cấu hình là exit 2 (đối số/
  // môi trường sai, gate chưa hề chạy), cùng hạng với template hỏng ở init.
  let checks
  try {
    checks = checksFor(stageId, dir, root, workspace, stage.schema ?? stageId)
  } catch (e) {
    const name = stage.schema ?? stageId
    process.stderr.write(
      `pp: schema/${name}.json không đọc được: ${e.message}\n` +
      'Đây là lỗi cấu hình của bản cài, KHÔNG phải artifact sai — gate chưa chạy.\n' +
      'Sửa file schema đó rồi chạy lại (pp doctor kiểm được cả bộ).\n',
    )
    return 2
  }
  const r = runT1(dir, config, state, stageId, checks)
  // Sổ kiểm toán: một event cho MỖI lần chạy gate — đỏ hay xanh đều ghi, vì
  // chuỗi đỏ-then-xanh chính là lịch sử retry đáng giá của stage.
  auditEvent(dir, {
    actor: 'pp', event: 'gate', feature, stage: stageId, ok: r.ok,
    details: { tier: 't1', evidence: r.evidencePath },
  })
  process.stdout.write(readFileSync(join(dir, r.evidencePath), 'utf8'))
  // FIX review cuối (finding 4e) + R2: T1 xanh KHÔNG có nghĩa là stage xong.
  // Dòng kết luận luôn được in, và do `statusLine` sinh ra — cùng một hàm với
  // `pp review-record`, nên hai lệnh không thể nói khác nhau.
  // N8: `r.ok === false` nghĩa là T1 VỪA đỏ ở chính lệnh này — statusLine phải
  // bảo "sửa artifact rồi chạy lại", không phải "chạy" (người đọc vừa chạy xong).
  process.stdout.write(statusLine(feature, stageId, config, r, { t1JustFailed: !r.ok }))
  return r.ok ? 0 : 1
}
