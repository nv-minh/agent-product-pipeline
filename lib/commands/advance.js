import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readConfig } from '../config.js'
import { readState } from '../state.js'
import { nextStage } from '../plan.js'
import { requiredTiers } from '../gate.js'
import { loadSchema } from '../registry.js'
import { parseArgs } from '../args.js'
import { auditEvent } from '../audit.js'

// pp advance KHÔNG tự gọi LLM. Nó chỉ đọc STATE.md/pipeline.json và in ra một
// CHỈ THỊ mô tả stage kế tiếp — file nào phải đọc, skill nào phải gọi, file
// nào phải ghi. Một coding agent (qua /pp) đọc chỉ thị đó rồi tự thực hiện.
// Control flow (thứ tự stage, retry, blocked) luôn nằm ở shell script này,
// không bao giờ ở agent.
// B2/B3: chỉ thị phải nêu ĐỦ những gì T1 sẽ đòi. Heading bắt buộc đọc thẳng từ
// `schema/<stage>.json` — cùng một nguồn mà gate dùng, nên hai bên không thể nói
// khác nhau (nếu copy danh sách vào đây thì chắc chắn sẽ trôi).
function requiredHeadings(root, stage) {
  const name = stage.schema ?? stage.id
  try {
    // stage.schema (pp-bugfix/pp-change): cùng một nguồn schema với gate —
    // override mà chỉ gate biết thì chỉ thị sẽ nói thiếu heading, đúng cái
    // bẫy mà comment đầu hàm này cảnh báo.
    return { headings: loadSchema(root, name).requiredHeadings ?? [], warn: null }
  } catch (e) {
    // schema méo không được làm `pp advance` chết (gate báo lỗi đó đúng chỗ),
    // NHƯNG cũng không được im lặng bỏ dòng "Heading bắt buộc": chỉ thị thiếu
    // luật thì agent viết thiếu, rồi gate đỏ mà không ai hiểu vì sao. FINDING
    // (review 8c825c9..44c1ecb): trước bản vá, advance exit 0 không nói gì.
    return { headings: [], warn: `⚠ schema/${name}.json không đọc được (${e.message}) — chỉ thị dưới đây THIẾU danh sách heading bắt buộc; chạy pp doctor` }
  }
}

// D6 — lessons/ TỪNG LÀ SỔ CHỈ-GHI: override/unblock append vào đó, README hứa
// "inject vào prompt stage đó lần sau", và grep toàn lib/+bin/ ra đúng 1 writer,
// 0 reader. Vòng học (trụ cột 6, §6) không đóng: cùng một gate đỏ vì cùng một
// lý do ở feature sau, và bài học nằm im trong một file không ai mở. Đây là
// reader đó. Giới hạn 10 dòng CUỐI (bài học mới nhất) — một file lessons phình
// to không được nuốt cả chỉ thị; có dòng bị cắt thì NÓI, không cắt im lặng.
const LESSON_LINES_MAX = 10

function lessonLines(root, stageId) {
  let txt
  try {
    txt = readFileSync(join(root, 'lessons', `${stageId}.md`), 'utf8')
  } catch {
    return { shown: [], hidden: 0 } // chưa có bài học nào — im lặng đúng nghĩa
  }
  const lines = txt.split('\n').filter((l) => l.trim())
  const shown = lines.slice(-LESSON_LINES_MAX)
  return { shown, hidden: lines.length - shown.length }
}

// FINDING (review 8c825c9..44c1ecb): advanceCmd không destructure `workspace`
// dù bin/pp đã truyền nó vào mọi handler — nên dòng "Được đọc thêm" nói "code
// repo trong workspace" mà không nêu workspace nào. Mặc định là thư mục CHA của
// root (~/Desktop trong layout thật): một giấy phép đọc không nêu biên. Và T1
// `cited-paths` giải nghĩa MỌI cite theo đúng gốc đó, nên agent đoán sai gốc là
// gate đỏ oan — đúng "vòng gate đỏ vô ích" mà registry.js:18-19 lấy làm tiêu chí
// khai tử. Chỉ thị và gate phải nói về cùng một thư mục.
export function advanceCmd(args, { root, workspace }) {
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

  // advance không ghi state nhưng VẪN ghi audit: event dispatch là mỏ neo
  // "công việc stage bắt đầu ở đây" — usage-sync dựng cửa sổ thời gian gán
  // token về stage từ chính các event này. Mọi outcome đều ghi (kể cả
  // blocked/complete); complete không có stage nên không có key stage.
  auditEvent(dir, {
    actor: 'pp', event: 'dispatch', feature,
    ...(d.action === 'complete' ? {} : { stage: d.stage }),
    details: { action: d.action, reason: d.reason },
  })

  if (d.action === 'complete') { process.stdout.write(`✓ ${feature}: mọi stage đã xong\n`); return 0 }
  if (d.action === 'blocked') { process.stdout.write(`⛔ ${d.stage} blocked: ${d.reason}\n`); return 3 }
  if (d.action === 'await-human') { process.stdout.write(`🚦 ${d.stage}: ${d.reason}\n`); return 0 }

  const s = config.stages[d.stage]
  // FIX review cuối (finding 4f): chỉ thị phải NÊU TÊN các tier bắt buộc và
  // đúng lệnh chạy từng tier. Trước đây luật "gate có t2 thì phải review" chỉ
  // nằm trong văn xuôi của commands/pp.md — agent phải tự đọc pipeline.json
  // và tự quyết định, tức là control flow nằm trong model.
  const tiers = requiredTiers(config, d.stage)
  const { headings, warn: schemaWarn } = requiredHeadings(root, s)
  if (schemaWarn) process.stdout.write(`${schemaWarn}\n\n`)
  const lessons = lessonLines(root, d.stage)
  const steps = [`pp gate ${feature} ${d.stage}`]
  if (tiers.includes('t2')) {
    steps.push(`pp review-prompt ${feature} ${d.stage}  (subagent pp-reviewer, chỉ đọc)`)
    steps.push(`pp review-record ${feature} ${d.stage} --verdict <file.json>`)
  }
  // Cùng gốc mà `cited-paths` dùng (registry.js: `workspace ?? join(root,'..')`)
  // — nêu tên nó ra, để agent cite theo đúng thứ T1 sẽ kiểm.
  const citeRoot = workspace ?? join(root, '..')
  const phạmViĐọc = s.readsWorkspace
    ? `Chỉ đọc các file trong dòng Đọc, cộng code repo trong dòng "Được đọc thêm" — ngoài hai chỗ đó thì không quét.`
    : 'Chỉ đọc đúng các file dưới đây, không quét thư mục khác.'
  process.stdout.write(`CHỈ THỊ CHO STAGE ${d.stage}  (${d.action} — ${d.reason})

Chạy trong MỘT subagent mới. ${phạmViĐọc}

  Thư mục   : features/${feature}/
  Đọc       : ${s.inputs.map((i) => i.path + (i.optional ? ' (optional)' : '')).join(', ')}
  Gọi skill : ${s.skills.map((x) => '/' + x).join(' → ') || '(không có)'}
  Ghi       : ${s.outputs.map((o) => `features/${feature}/${o}`).join(', ')}
${s.readsWorkspace ? `  Được đọc thêm : ${citeRoot} (code repo — CHỈ ĐỌC: không ghi, không xoá, không chạy lệnh sửa file ở đó)\n    Đường dẫn cite trong artifact được T1 giải nghĩa theo ĐÚNG gốc này.\n` : ''}${headings.length ? `  Heading bắt buộc : ${headings.join(' · ')}\n` : ''}  Tier bắt buộc : ${tiers.join(', ')} — stage CHỈ done khi mọi tier trên đều xanh
  Sau đó    : ${steps.join('\n              ')}

Đầu mỗi artifact phải có frontmatter, đúng bốn khoá:
  ---
  feature: ${feature}
  stage: ${d.stage}
  updated: <ngày hôm nay, dạng YYYY-MM-DD>
  source: ${s.inputs[0]?.path ?? '<file nguồn>'}
  ---
${lessons.shown.length ? `
Bài học cũ của stage này (lessons/${d.stage}.md — từ những lần gate đỏ/override trước${lessons.hidden > 0 ? `; ${lessons.hidden} dòng cũ hơn không in` : ''}):
${lessons.shown.map((l) => `  ${l}`).join('\n')}
` : ''}
Ràng buộc: mọi đường dẫn cite phải có thật; AC viết EARS, đúng một SHALL mỗi AC;
không để lại TBD/TODO. Không được ghi STATE.md hay .evidence/.
`)
  return 0
}
