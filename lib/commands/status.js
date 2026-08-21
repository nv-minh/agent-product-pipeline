import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { nextStage } from '../plan.js'
import { parseArgs } from '../args.js'

// FINDING (review 8c825c9..44c1ecb): `type` và `from` có 1 writer, 0 reader —
// đúng mẫu "sổ chỉ-ghi" mà advance.js:31-36 (D6) đã lấy làm bài học. Spec §3.1
// hứa status/report phân loại được loại việc; chỉ audit làm được. Và chính lỗ
// hiển thị này khiến hai lỗi khác không thể bị phát hiện: pipeline chạy sai
// loại, hoặc feature gốc đã chết, đều vô hình với người dùng.
//
// Trả về các dòng phụ (rỗng nếu pipeline không có gì để nói).
export function originLines(root, config) {
  const lines = [`  loại việc     : ${config.type}`]
  if (!config.from) return lines
  // `from_path` là đường dẫn đã resolve lúc init; pipeline cũ chỉ có `from` thì
  // dò lại cả hai nơi thay vì đoán một nơi.
  const ứngViên = config.fromPath
    ? [config.fromPath]
    : [`../${config.from}`, `../_archive/${config.from}`]
  const có = ứngViên.find((rel) => existsSync(join(root, 'features', rel.replace(/^\.\.\//, ''))))
  if (!có) {
    lines.push(
      `  feature gốc   : ${config.from} ⚠ KHÔNG còn trong features/ hay _archive/ ` +
      '— 05-impact đang chạy như brownfield, artifact cũ không nằm trong inputs_hash nữa',
    )
    return lines
  }
  // Có thư mục nhưng rỗng artifact cũng là một liên kết chết trên thực tế.
  const thiếuHết = ['00-brief.md', '10-prd.md', '40-testplan.md']
    .every((f) => !existsSync(join(root, 'features', có.replace(/^\.\.\//, ''), f)))
  lines.push(
    `  feature gốc   : ${config.from} (${có})` +
    (thiếuHết ? ' ⚠ không còn artifact nào được nối — đang chạy như brownfield' : ''),
  )
  return lines
}

export function statusCmd(args, { root }) {
  const { positional } = parseArgs(args)
  const feature = positional[0]
  if (!feature) {
    process.stderr.write('pp status <feature> — muốn xem tổng mọi feature: pp report\n')
    return 2
  }
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const dir = join(root, 'features', feature)
  const config = readConfig(dir)
  const state = readState(dir)
  const d = nextStage(dir, config, state)

  const phụ = originLines(root, config)
  if (d.action === 'complete') {
    process.stdout.write(`✓ ${feature}: mọi stage đã xong\n${phụ.join('\n')}\n`)
    return 0
  }
  process.stdout.write(
    `${feature}\n${phụ.join('\n')}\n` +
    `  stage kế tiếp : ${d.stage}\n  hành động     : ${d.action}\n  lý do         : ${d.reason}\n`,
  )
  return d.action === 'blocked' ? 3 : 0
}
