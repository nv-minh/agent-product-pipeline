import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { nextStage } from '../plan.js'
import { parseArgs } from '../args.js'

export function statusCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const feature = positional[0]
  if (!feature) { process.stdout.write('pp status <feature>\n'); return 2 }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  const state = readState(dir)
  const d = nextStage(dir, config, state)

  if (d.action === 'complete') { process.stdout.write(`✓ ${feature}: mọi stage đã xong\n`); return 0 }
  process.stdout.write(`${feature}\n  stage kế tiếp : ${d.stage}\n  hành động     : ${d.action}\n  lý do         : ${d.reason}\n`)
  return d.action === 'blocked' ? 3 : 0
}
