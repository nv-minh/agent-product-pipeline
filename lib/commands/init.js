import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeState } from '../state.js'

// Templates ship với chính công cụ pp (trong repo cài đặt), không phải với
// `--root` mà người dùng trỏ tới — hai thứ trùng nhau trong dùng thực tế
// (root mặc định = repo cài đặt), nhưng test dùng --root trỏ vào thư mục
// tạm không có templates/, nên phải dò theo vị trí file này, không theo root.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function initCmd(args, { root }) {
  const feature = args.find((a) => !a.startsWith('--'))
  if (!feature) { process.stdout.write('pp init <feature> [--size S|M|L]\n'); return 2 }
  if (!root) {
    process.stdout.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }
  const sizeIdx = args.indexOf('--size')
  const size = sizeIdx === -1 ? 'M' : args[sizeIdx + 1]

  const dir = join(root, 'features', feature)
  if (existsSync(dir)) { process.stdout.write(`pp: features/${feature} đã tồn tại\n`); return 1 }

  const tplPath = join(PKG_ROOT, 'templates', `pipeline.${size}.json`)
  const tpl = readFileSync(existsSync(tplPath) ? tplPath : join(PKG_ROOT, 'templates', 'pipeline.M.json'), 'utf8')

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pipeline.json'), tpl.replaceAll('__FEATURE__', feature))
  writeFileSync(join(dir, '00-brief.md'), `# Brief — ${feature}

Viết 3–10 dòng dạng DELTA so với hiện trạng: hôm nay hệ thống làm gì,
sau thay đổi này nó làm khác đi ở đâu, và vì sao cần.
`)
  writeState(dir, { feature, current: null, stages: {} })
  process.stdout.write(`đã tạo features/${feature} (size ${size})\nbước tiếp: viết 00-brief.md rồi chạy  pp status ${feature}\n`)
  return 0
}
