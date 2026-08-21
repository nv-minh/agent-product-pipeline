import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeState } from '../state.js'
import { readConfig } from '../config.js'
import { nextStage } from '../plan.js'
import { parseArgs } from '../args.js'
import { auditEvent } from '../audit.js'
import { FEATURE_NAME } from './precond.js'

// Templates ship với chính công cụ pp (trong repo cài đặt), không phải với
// `--root` mà người dùng trỏ tới — hai thứ trùng nhau trong dùng thực tế
// (root mặc định = repo cài đặt), nhưng test dùng --root trỏ vào thư mục
// tạm không có templates/, nên phải dò theo vị trí file này, không theo root.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function initCmd(args, { root }) {
  const { positional, flags } = parseArgs(args)
  const feature = positional[0]
  if (!feature) {
    process.stderr.write('pp init <feature> [--size S|M] [--type feature|bugfix|change] [--from <feature-cũ>]\n')
    return 2
  }
  if (!root) {
    process.stderr.write('pp: không tìm thấy gốc repo (không có constitution.md ở thư mục cha nào)\n')
    return 2
  }

  // C4 — constitution.md là quy ước CHUNG (GitHub Spec Kit dùng đúng tên này),
  // nên "có constitution.md" không đủ để kết luận "đây là product-repo của pp".
  // Đứng nhầm trong một repo Spec Kit mà gõ `pp init` từng scaffold nguyên bộ
  // features/ + STATE.md vào repo của người ta. `init` là lệnh DUY NHẤT tạo cây
  // thư mục, nên chỉ nó đòi marker riêng `.pp-root`; các lệnh còn lại giữ
  // fallback constitution.md để clone cũ vẫn đọc được.
  if (!existsSync(join(root, '.pp-root'))) {
    process.stderr.write(
      `pp: ${root} chưa có file .pp-root — init từ chối scaffold.\n` +
      'constitution.md không đủ để chắc đây là product-repo của pp (Spec Kit cũng dùng tên đó).\n' +
      `Nếu đây đúng là product-repo: touch ${join(root, '.pp-root')}  rồi chạy lại.\n`,
    )
    return 2
  }

  const dir = join(root, 'features', feature)
  if (existsSync(dir)) { process.stderr.write(`pp: features/${feature} đã tồn tại\n`); return 1 }

  // pp-bugfix/pp-change (spec §3.1): --type chọn LOẠI pipeline. Type lạ exit 2
  // KHÔNG fallback — size là gợi ý nên đoán được, type là ngữ nghĩa của cả
  // pipeline nên đoán sai là chạy sai pipeline.
  const TYPES = ['feature', 'bugfix', 'change']
  const type = typeof flags.type === 'string' ? flags.type : 'feature'
  if (!TYPES.includes(type)) {
    process.stderr.write(
      `pp: --type "${type}" không hợp lệ — chỉ nhận: ${TYPES.join(', ')}.\n` +
      'Không fallback: type là ngữ nghĩa của cả pipeline, không đoán thay.\n',
    )
    return 2
  }

  // --from (spec §3.2): liên kết feature gốc — chỉ type change có ngữ nghĩa
  // này. Feature cũ có thể đang sống (features/) hoặc đã ship (_archive/).
  //
  // --from là một mảnh path (nối vào `../${from}/...` bên dưới) NÊN phải qua
  // đúng luật tên feature (FEATURE_NAME, cùng regex badFeatureName dùng ở
  // precond.js) — đóng cùng lớp lỗi path traversal: trước bản vá,
  // `--from '../../outside/evil'` ghi thẳng "../../outside/evil" vào
  // pipeline.json và tiêm inputs trỏ ra NGOÀI repo, exit 0 (xem
  // tests/path-safety.test.js). Kiểm `flags.from !== undefined` (không phải
  // `typeof === 'string'`) để bắt luôn hai ca im lặng: bare `--from` cuối
  // lệnh (parseArgs trả `true`) và `--from ''` — cả hai từng bị coi lặng lẽ
  // là "không có --from", làm mất liên kết người dùng đã yêu cầu mà không ai
  // biết.
  if (flags.from !== undefined && (typeof flags.from !== 'string' || !FEATURE_NAME.test(flags.from))) {
    const shown = typeof flags.from === 'string' ? `"${flags.from}"` : '(thiếu giá trị)'
    process.stderr.write(
      `pp: --from ${shown} không hợp lệ — phải là tên feature: chỉ chữ thường a-z, ` +
      `số và gạch nối, bắt đầu bằng chữ hoặc số (${FEATURE_NAME}).\n` +
      '--from rỗng hoặc thiếu giá trị KHÔNG được ngầm coi là "không có --from"; ' +
      'chuỗi chứa "/", ".." hay khoảng trắng sẽ trỏ ra NGOÀI features/ (path traversal).\n',
    )
    return 2
  }
  const from = typeof flags.from === 'string' ? flags.from : null
  if (from && type !== 'change') {
    process.stderr.write('pp: --from chỉ có nghĩa với --type change (liên kết feature gốc cho impact analysis)\n')
    return 2
  }
  // FINDING (review 8c825c9..44c1ecb): `existsSync` một mình nhận cả FILE (ba
  // input được tiêm rồi không bao giờ tồn tại — feature khai "có gốc" mà không
  // có dữ liệu nào) và cả SYMLINK trỏ ra ngoài root (pp băm file ngoài repo vào
  // inputs_hash rồi ra lệnh cho subagent đọc chúng). Feature gốc phải là một
  // thư mục THẬT nằm dưới features/ — cùng tinh thần C2: một mảnh path không
  // được dẫn ra khỏi vùng mà guard đang canh.
  const featuresReal = (() => {
    try { return realpathSync(join(root, 'features')) } catch { return join(root, 'features') }
  })()
  const dirTrongFeatures = (p) => {
    try {
      if (!statSync(p).isDirectory()) return false
      const real = realpathSync(p)
      return real === featuresReal || real.startsWith(featuresReal + sep)
    } catch { return false }
  }
  let fromRel = null
  if (from) {
    if (dirTrongFeatures(join(root, 'features', from))) fromRel = `../${from}`
    else if (dirTrongFeatures(join(root, 'features', '_archive', from))) fromRel = `../_archive/${from}`
    else if (existsSync(join(root, 'features', from)) || existsSync(join(root, 'features', '_archive', from))) {
      process.stderr.write(
        `pp: --from "${from}" tồn tại nhưng không phải một thư mục feature nằm trong features/.\n` +
        'Feature gốc phải là thư mục thật (không phải file, không phải symlink trỏ ra ngoài repo):\n' +
        'inputs của 05-impact được băm vào inputs_hash và được subagent đọc — chúng không được trỏ ra ngoài root.\n',
      )
      return 2
    } else {
      const list = (p) => {
        try {
          return readdirSync(p, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
            .map((e) => e.name)
        } catch { return [] }
      }
      // FINDING (review 8c825c9..44c1ecb): bản cũ in `_archive/<tên>` cho
      // feature đã ship. Gõ lại y nguyên chuỗi đó → exit 2 "không hợp lệ" (từ
      // 44c1ecb, `--from` phải khớp FEATURE_NAME) — pp gợi ý một lệnh không
      // chạy được, đúng ở lúc người dùng đang bế tắc (bài học plan.js:10-15).
      // `--from` nhận TÊN, không nhận đường dẫn: init tự tìm ở cả hai nơi.
      const đangSống = list(join(root, 'features'))
      const đãShip = list(join(root, 'features', '_archive'))
      const dòngỨngViên = [
        đangSống.length ? `Feature đang có: ${đangSống.join(', ')}\n` : '',
        đãShip.length ? `Đã ship (features/_archive/): ${đãShip.join(', ')}\n` : '',
      ].join('')
      process.stderr.write(
        `pp: --from "${from}" không tồn tại trong features/ hay features/_archive/.\n` +
        (dòngỨngViên || 'Chưa có feature nào.\n') +
        '--from nhận TÊN feature (init tự tìm ở cả hai nơi), không nhận đường dẫn.\n',
      )
      return 2
    }
  }

  let size = null
  let tplPath
  let fallbackNote = ''
  if (type === 'feature') {
    const requestedSize = typeof flags.size === 'string' ? flags.size : 'M'
    size = requestedSize
    tplPath = join(PKG_ROOT, 'templates', `pipeline.${size}.json`)
    if (!existsSync(tplPath)) {
      fallbackNote = `pp: không có template cho size "${requestedSize}", dùng M thay thế (fallback)\n`
      size = 'M'
      tplPath = join(PKG_ROOT, 'templates', 'pipeline.M.json')
    }
  } else {
    // --size vô nghĩa với bugfix/change: mỗi type đúng một template. Nhưng
    // USAGE in `--size` cạnh `--type` nên người dùng có lý do gõ cả hai — bỏ
    // qua thì phải NÓI (cùng luật B4 ở gate.js:19-27: làm một việc khác việc
    // được yêu cầu rồi báo thành công là loại sai tệ nhất của một CLI).
    if (flags.size !== undefined) {
      fallbackNote = `pp: --size bị bỏ qua với --type ${type} — mỗi loại việc đúng một pipeline, không có biến thể S/M\n`
    }
    tplPath = join(PKG_ROOT, 'templates', `pipeline.${type}.json`)
    if (!existsSync(tplPath)) {
      process.stderr.write(`pp: thiếu templates/pipeline.${type}.json — bản cài pp không toàn vẹn (chạy pp doctor)\n`)
      return 2
    }
  }
  // Parse để (a) bắt template hỏng JSON ngay tại cửa thay vì ghi một
  // pipeline.json hỏng, (b) Task 5 tiêm from/inputs vào object này.
  //
  // FINDING (review 8c825c9..44c1ecb): `readFileSync` từng nằm TRONG cùng try,
  // nên nhánh fallback (size thiếu → tplPath đổi về M mà không existsSync lại)
  // báo `ENOENT` dưới nhãn "không phải JSON hợp lệ" — quy lỗi "hỏng" cho một
  // file KHÔNG TỒN TẠI, đúng ngay tình huống doctor 5b vừa được thêm để bắt.
  if (!existsSync(tplPath)) {
    process.stderr.write(
      `pp: thiếu ${tplPath} — bản cài pp không toàn vẹn (chạy pp doctor)\n`,
    )
    return 2
  }
  let pipeline
  try {
    pipeline = JSON.parse(readFileSync(tplPath, 'utf8').replaceAll('__FEATURE__', feature))
  } catch (e) {
    process.stderr.write(`pp: template ${tplPath} không phải JSON hợp lệ: ${e.message}\n`)
    return 2
  }

  if (fromRel) {
    pipeline.from = from
    // Ghi cả đường dẫn đã resolve: `from: "old-widget"` một mình không cho biết
    // bản nào được chọn khi tên trùng ở cả features/ và _archive/, và không
    // lệnh nào kiểm lại được liên kết còn sống hay đã chết.
    pipeline.from_path = fromRel
    // Artifact cũ nào thiếu thì `?` bỏ qua — brownfield một phần vẫn chạy.
    pipeline.stages['05-impact'].inputs.push(
      `${fromRel}/00-brief.md?`, `${fromRel}/10-prd.md?`, `${fromRel}/40-testplan.md?`,
    )
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pipeline.json'), JSON.stringify(pipeline, null, 2) + '\n')
  // Brief scaffold theo type — brief vẫn là tiếng nói của người, nhưng khung
  // gợi ý đúng loại việc (spec §3.1): bugfix cần Unchanged behavior để
  // 40-regression truy vết; change là DELTA trên hành vi ĐÃ CÓ.
  const BRIEFS = {
    feature: `Viết 3–10 dòng dạng DELTA so với hiện trạng: hôm nay hệ thống làm gì,
sau thay đổi này nó làm khác đi ở đâu, và vì sao cần.
`,
    bugfix: `Viết theo bốn mục, mỗi mục 1–3 dòng (thiếu thông tin thì ghi câu hỏi, đừng đoán):

Hiện tượng: hệ thống đang làm SAI gì — mô tả quan sát được, kèm log nếu có.
Mong đợi: đúng ra nó phải thế nào.
Unchanged behavior: những hành vi phải GIỮ NGUYÊN sau khi fix.
Cách tái hiện (nếu biết): các bước + môi trường.
`,
    change: `Viết 3–10 dòng dạng DELTA trên hành vi ĐÃ CÓ: hôm nay hệ thống làm gì
(hành vi nào, ở đâu), sau thay đổi này nó khác đi ở đâu, và vì sao cần.
Có feature gốc trong features/ hay _archive/ thì nêu tên (init --from);
không có thì stage 05-impact sẽ đọc code hiện trạng thay.
`,
  }
  writeFileSync(join(dir, '00-brief.md'), `# Brief — ${feature}\n\n${BRIEFS[type]}`)
  // D4 — `current: null` hiển thị "(hoàn tất)": một feature vừa sinh ra đã
  // tự nhận là xong. `nextStage` trên state rỗng trả về stage bật đầu tiên —
  // hỏi nó thay vì đoán, để init và mọi lần ghi sau cùng một nguồn sự thật.
  const state = { feature, current: null, stages: {} }
  state.current = nextStage(dir, readConfig(dir), state).stage
  writeState(dir, state)
  // init là lệnh của người (conductor không tự tạo feature) → actor human.
  // Ghi size THẬT dùng (sau fallback), không phải size yêu cầu.
  auditEvent(dir, {
    actor: 'human', event: 'init', feature,
    details: { type, ...(size ? { size } : {}), ...(from ? { from } : {}) },
  })
  if (fallbackNote) process.stdout.write(fallbackNote)
  const shape = type === 'feature' ? `size ${size}` : `type ${type}`
  process.stdout.write(`đã tạo features/${feature} (${shape})\nbước tiếp: viết 00-brief.md rồi chạy  pp status ${feature}\n`)
  return 0
}
