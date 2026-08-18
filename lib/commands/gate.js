import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readConfig } from '../config.js'
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
  const r = runT1(dir, readConfig(dir), readState(dir), stageId, checksFor(stageId, dir, root))
  process.stdout.write(readFileSync(join(dir, r.evidencePath), 'utf8'))
  return r.ok ? 0 : 1
}
