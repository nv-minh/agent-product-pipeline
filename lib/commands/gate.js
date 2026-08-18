import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readConfig, stageOrder } from '../config.js'
import { readState } from '../state.js'
import { runT1 } from '../gate.js'
import { checksFor } from '../registry.js'
import { parseArgs } from '../args.js'

export function gateCmd(args, { root }) {
  // Dùng parseArgs dùng chung thay vì args.filter(a => !a.startsWith('--')):
  // pattern đó nhặt nhầm token khi flag đứng trước positional (--tier t1 demo
  // 40-testplan sẽ lấy "t1" làm feature). positional[0]/[1] luôn đúng thứ tự
  // feature rồi stage bất kể flag nằm ở đâu trên dòng lệnh.
  const { positional } = parseArgs(args)
  const [feature, stageId] = positional
  if (!feature || !stageId) { process.stdout.write('pp gate <feature> <stage> [--tier t1]\n'); return 2 }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  // REVIEW FINDING 1: a typo'd stage id must say so — naming the bad id and
  // listing the real ones — instead of falling through to runT1 and letting
  // an unguarded `config.stages[stageId].outputs` throw an internal
  // TypeError. Exit 2 (bad argument), not 1 (gate failed): the stage never ran.
  if (!config.stages[stageId]) {
    process.stdout.write(
      `pp: stage "${stageId}" không tồn tại trong pipeline.json của feature "${feature}"\n` +
      `Các stage có sẵn: ${stageOrder(config).join(', ')}\n`,
    )
    return 2
  }
  const r = runT1(dir, config, readState(dir), stageId, checksFor(stageId, dir, root))
  process.stdout.write(readFileSync(join(dir, r.evidencePath), 'utf8'))
  return r.ok ? 0 : 1
}
