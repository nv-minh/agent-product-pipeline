import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { nextStage } from '../plan.js'
import { requiredTiers } from '../gate.js'
import { parseArgs } from '../args.js'

// pp advance KHÔNG tự gọi LLM. Nó chỉ đọc STATE.md/pipeline.json và in ra một
// CHỈ THỊ mô tả stage kế tiếp — file nào phải đọc, skill nào phải gọi, file
// nào phải ghi. Một coding agent (qua /pp) đọc chỉ thị đó rồi tự thực hiện.
// Control flow (thứ tự stage, retry, blocked) luôn nằm ở shell script này,
// không bao giờ ở agent.
export function advanceCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const feature = positional[0]
  if (!feature) { process.stdout.write('pp advance <feature>\n'); return 2 }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  const d = nextStage(dir, config, readState(dir))

  if (d.action === 'complete') { process.stdout.write(`✓ ${feature}: mọi stage đã xong\n`); return 0 }
  if (d.action === 'blocked') { process.stdout.write(`⛔ ${d.stage} blocked: ${d.reason}\n`); return 3 }
  if (d.action === 'await-human') { process.stdout.write(`🚦 ${d.stage}: ${d.reason}\n`); return 0 }

  const s = config.stages[d.stage]
  // FIX review cuối (finding 4f): chỉ thị phải NÊU TÊN các tier bắt buộc và
  // đúng lệnh chạy từng tier. Trước đây luật "gate có t2 thì phải review" chỉ
  // nằm trong văn xuôi của commands/pp.md — agent phải tự đọc pipeline.json
  // và tự quyết định, tức là control flow nằm trong model.
  const tiers = requiredTiers(config, d.stage)
  const steps = [`pp gate ${feature} ${d.stage}`]
  if (tiers.includes('t2')) {
    steps.push(`pp review-prompt ${feature} ${d.stage}  (subagent pp-reviewer, chỉ đọc)`)
    steps.push(`pp review-record ${feature} ${d.stage} --verdict <file.json>`)
  }
  process.stdout.write(`CHỈ THỊ CHO STAGE ${d.stage}  (${d.action} — ${d.reason})

Chạy trong MỘT subagent mới. Chỉ đọc đúng các file dưới đây, không quét thư mục khác.

  Thư mục   : features/${feature}/
  Đọc       : ${s.inputs.map((i) => i.path + (i.optional ? ' (optional)' : '')).join(', ')}
  Gọi skill : ${s.skills.map((x) => '/' + x).join(' → ') || '(không có)'}
  Ghi       : ${s.outputs.join(', ')}
  Tier bắt buộc : ${tiers.join(', ')} — stage CHỈ done khi mọi tier trên đều xanh
  Sau đó    : ${steps.join('\n              ')}

Ràng buộc: mọi đường dẫn cite phải có thật; AC viết EARS, đúng một SHALL mỗi AC;
không để lại TBD/TODO. Không được ghi STATE.md hay .evidence/.
`)
  return 0
}
