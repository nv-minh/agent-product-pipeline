// lib/commands/doctor.js — TẦNG THI HÀNH CÓ ĐANG BẬT KHÔNG?
//
// A1: cả tầng chặn §5.3 (PreToolUse + Stop) nằm ngoài code — nó chỉ chạy nếu
// một file settings.json nào đó đăng ký hai script trong hooks/. Trước lệnh này,
// KHÔNG CÓ CÁCH NÀO biết nó đang bật: clone mới về là hook tắt im lặng, trong
// khi mọi STATE.md vẫn in banner "PreToolUse hook chặn agent ghi file này" —
// một lời đảm bảo không ai kiểm chứng được. Đúng loại "lời khai thay cho dữ
// kiện" mà cả hệ thống này tồn tại để chặn, chỉ là ở tầng cấu hình.
//
// `pp doctor` KHÔNG tin cấu hình: với phần luật guard, nó gọi CHÍNH hàm
// `classifyPath` mà hook dùng và kiểm hành vi thật. Với phần đăng ký hook, nó
// chỉ đọc được file trên đĩa — nên nó nói rõ giới hạn đó thay vì tuyên bố hook
// "đang chạy" (chỉ Claude Code biết điều đó; settings có thể bị disableAllHooks,
// bị ghi đè bởi tầng khác, hoặc chưa được nạp lại trong phiên hiện tại).
import { existsSync, readFileSync, accessSync, constants, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { classifyPath, bashWriteTarget } from './guard.js'

const OK = '✓'
const BAD = '✗'
const WARN = '!'

function line(mark, label, detail) {
  return `  ${mark} ${label.padEnd(30)} ${detail}\n`
}

// Một settings.json có đăng ký script này không? Trả về tên file đã tìm thấy để
// người dùng biết luật đang đến từ ĐÂU (user/project/local có thể chồng nhau).
function findHookRegistration(files, event, needle) {
  const found = []
  for (const f of files) {
    if (!existsSync(f)) continue
    let json
    try {
      json = JSON.parse(readFileSync(f, 'utf8'))
    } catch {
      found.push({ file: f, broken: true })
      continue
    }
    const groups = json?.hooks?.[event]
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      for (const h of g?.hooks ?? []) {
        const cmd = typeof h?.command === 'string' ? h.command : ''
        if (cmd.includes(needle)) found.push({ file: f, matcher: g.matcher ?? '(mọi tool)' })
      }
    }
  }
  return found
}

function isExecutable(p) {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function doctorCmd(_args, { root, workspace }) {
  let out = 'pp doctor — tầng thi hành\n\n'
  let bad = 0
  let warn = 0

  // ── 1. Gốc repo + workspace ─────────────────────────────────────────────
  if (root) {
    out += line(OK, 'gốc product-repo', root)
  } else {
    out += line(BAD, 'gốc product-repo', 'KHÔNG tìm thấy (không có constitution.md ở thư mục cha nào)')
    bad++
  }
  if (workspace) {
    const exists = existsSync(workspace)
    out += line(exists ? OK : WARN, 'workspace (gốc cite path)', exists ? workspace : `${workspace} — KHÔNG tồn tại`)
    if (!exists) warn++
  }

  // ── 2. Script hook có mặt và chạy được ──────────────────────────────────
  const scripts = [
    ['hooks/pre-tool-use.sh', 'PreToolUse'],
    ['hooks/stop.sh', 'Stop'],
  ]
  // Script nằm cạnh chính lib/ này (theo package), không theo --root: một
  // --root trỏ đi đâu khác không được làm doctor báo thiếu script.
  //
  // FINDING (review 8c825c9..44c1ecb): `new URL(...).pathname` giữ nguyên
  // percent-encoding, nên cài pp dưới đường dẫn có khoảng trắng ("My Drive")
  // làm mọi existsSync() ở đây trả false — doctor báo thiếu cả 4 template và
  // exit 1 trong khi init (dùng fileURLToPath) chạy bình thường. Dùng đúng
  // cách init dùng, để hai bên nói về cùng một thư mục.
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  for (const [rel] of scripts) {
    const p = join(pkgRoot, rel)
    if (!existsSync(p)) {
      out += line(BAD, rel, 'KHÔNG tồn tại')
      bad++
    } else if (!isExecutable(p)) {
      out += line(WARN, rel, 'tồn tại nhưng KHÔNG có quyền chạy (chmod +x)')
      warn++
    } else {
      out += line(OK, rel, 'tồn tại, chạy được')
    }
  }

  // ── 3. Luật guard có thật sự chặn không (gọi hàm thật) ──────────────────
  // Đây là phần doctor kiểm bằng DỮ KIỆN, không bằng cấu hình.
  const probeRoot = root ?? '/repo'
  const mustBlock = [
    [join(probeRoot, 'features', 'demo', 'STATE.md'), 'STATE.md'],
    [join(probeRoot, 'features', 'demo', '.evidence', 'x.t1.log'), '.evidence/x'],
    [join(probeRoot, 'features', 'demo', 'pipeline.json'), 'pipeline.json'],
    [join(probeRoot, 'features', 'demo', 'audit.jsonl'), 'audit.jsonl'],
    [join(probeRoot, 'features', 'demo', '.review', '10-prd.1.json'), '.review/x'],
    [join(probeRoot, 'features', 'demo', '.usage', 'entries.jsonl'), '.usage/x'],
    // A2: CHÍNH thư mục, không có dấu `/` cuối — đường mà `rm -rf .evidence` đi qua.
    [join(probeRoot, 'features', 'demo', '.evidence'), '.evidence (thư mục)'],
    [join(probeRoot, 'features', 'demo', '.review'), '.review (thư mục)'],
    [join(probeRoot, 'features', 'demo', '.usage'), '.usage (thư mục)'],
  ]
  const leaked = mustBlock.filter(([p]) => !classifyPath(p).blocked).map(([, name]) => name)
  if (leaked.length) {
    out += line(BAD, 'luật guard-write', `KHÔNG chặn: ${leaked.join(', ')}`)
    bad++
  } else {
    out += line(OK, 'luật guard-write', `chặn đủ ${mustBlock.length}/${mustBlock.length} đường được bảo vệ`)
  }
  // Và phải CHO QUA đúng những thứ agent cần ghi — một guard chặn tất cả cũng
  // là một guard hỏng (nó sẽ bị tắt, rồi không còn gì bảo vệ).
  const mustAllow = [
    [join(probeRoot, 'features', 'demo', '10-prd.md'), 'artifact stage'],
    [join(probeRoot, 'features', 'demo', '.review-10-prd.json'), 'inbox verdict'],
    [join(probeRoot, 'lib', 'gate.js'), 'code ngoài features/'],
  ]
  const overblocked = mustAllow.filter(([p]) => classifyPath(p).blocked).map(([, name]) => name)
  if (overblocked.length) {
    out += line(BAD, 'guard-write không chặn oan', `chặn NHẦM: ${overblocked.join(', ')}`)
    bad++
  } else {
    out += line(OK, 'guard-write không chặn oan', 'artifact + inbox verdict + code vẫn ghi được')
  }

  // A2: luật Bash là lớp phòng thủ thứ hai — kiểm nó có thật sự bắt các đường
  // thẳng, và có thật sự không chặn việc ĐỌC evidence (commands/pp.md dặn agent
  // hiển thị log cho người dùng; một guard chặn cả đọc sẽ bị tắt).
  const stateProbe = join(probeRoot, 'features', 'demo', 'STATE.md')
  const bashMustBlock = [
    [`echo x > ${stateProbe}`, 'chuyển hướng >'],
    [`sed -i "" s/a/b/ ${stateProbe}`, 'sed -i'],
    [`rm -rf ${join(probeRoot, 'features', 'demo', '.evidence')}`, 'rm -rf .evidence'],
  ]
  const bashLeaked = bashMustBlock.filter(([c]) => !bashWriteTarget(c)).map(([, n]) => n)
  const readProbe = `cat ${join(probeRoot, 'features', 'demo', '.evidence', 'x.t1.log')}`
  if (bashLeaked.length) {
    out += line(BAD, 'luật guard-write (Bash)', `KHÔNG chặn: ${bashLeaked.join(', ')}`)
    bad++
  } else if (bashWriteTarget(readProbe)) {
    out += line(BAD, 'luật guard-write (Bash)', 'chặn cả việc ĐỌC evidence — sẽ bị tắt, rồi mất luôn bảo vệ')
    bad++
  } else {
    out += line(OK, 'luật guard-write (Bash)', `chặn ${bashMustBlock.length}/${bashMustBlock.length} đường ghi, không chặn đọc`)
  }

  // ── 4. Hook có được ĐĂNG KÝ ở một settings.json nào chưa ─────────────────
  const settingsFiles = [
    join(homedir(), '.claude', 'settings.json'),
    ...(root ? [join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')] : []),
  ]
  for (const [rel, event] of scripts) {
    const hits = findHookRegistration(settingsFiles, event, rel)
    const brokenFiles = hits.filter((h) => h.broken)
    for (const b of brokenFiles) {
      out += line(BAD, `${event} settings`, `${b.file} không phải JSON hợp lệ — CẢ FILE bị bỏ qua`)
      bad++
    }
    const real = hits.filter((h) => !h.broken)
    if (real.length === 0) {
      out += line(BAD, `hook ${event}`, `CHƯA đăng ký ở đâu — ${rel} không bao giờ được gọi`)
      // N4 (lab 2026-08-21): nêu hệ quả mà không kèm lối sửa là bắt người dùng
      // tự viết JSON hooks từ trí nhớ. In đúng snippet trùng bản đang chạy trong
      // .claude/settings.json của repo (JSON.stringify lo phần escape) — dán là chạy.
      const hookEntry = { type: 'command', command: `bash "$CLAUDE_PROJECT_DIR/${rel}"`, timeout: 10 }
      const group = event === 'PreToolUse'
        ? { matcher: 'Write|Edit|NotebookEdit|Bash', hooks: [hookEntry] }
        : { hooks: [hookEntry] }
      const snippet = JSON.stringify({ hooks: { [event]: [group] } })
      out +=
        '    sửa — dán vào "hooks" của .claude/settings.json (repo hoặc ~/.claude/settings.json):\n' +
        `      ${snippet}\n`
      bad++
    } else {
      const where = real.map((h) => `${h.file}${h.matcher ? ` [${h.matcher}]` : ''}`).join(', ')
      out += line(OK, `hook ${event}`, `đăng ký tại ${where}`)
      // A2: matcher không có Bash thì hook không bao giờ thấy `echo … > STATE.md`.
      if (event === 'PreToolUse') {
        const covered = real.map((h) => h.matcher ?? '')
        const missing = ['Write', 'Edit', 'NotebookEdit', 'Bash'].filter((t) => !covered.some((m) => m.includes(t)))
        if (missing.length) {
          out += line(WARN, '  matcher PreToolUse', `thiếu ${missing.join(', ')} — hook không thấy các tool đó`)
          warn++
        }
      }
    }
  }

  // ── 4b. permissions.deny — thứ ép được Bash THẬT SỰ ─────────────────────
  // Lớp heuristic trong guard.js chỉ bắt các đường thẳng; một chuỗi shell vòng vo
  // luôn lách được. `permissions.deny` (và sandbox.filesystem.denyWrite khi bật
  // sandbox) mới là chỗ ranh giới được thi hành. Thiếu nó không phải lỗi chí tử,
  // nhưng phải nói ra thay vì để người dùng tưởng hook là đủ.
  const denyRules = []
  for (const f of settingsFiles) {
    if (!existsSync(f)) continue
    try {
      const d = JSON.parse(readFileSync(f, 'utf8'))?.permissions?.deny
      if (Array.isArray(d)) denyRules.push(...d)
    } catch { /* file méo đã được báo ở trên */ }
  }
  const needDeny = ['STATE.md', 'pipeline.json', 'audit.jsonl', '.evidence', '.review', '.usage']
  const missingDeny = needDeny.filter((n) => !denyRules.some((r) => r.includes(n)))
  if (missingDeny.length) {
    out += line(WARN, 'permissions.deny', `chưa chặn: ${missingDeny.join(', ')} — Bash vòng vo vẫn ghi được`)
    warn++
  } else {
    out += line(OK, 'permissions.deny', `${needDeny.length}/${needDeny.length} đường được chặn ở tầng quyền`)
  }

  // ── 5. Tài sản T1/T2 ────────────────────────────────────────────────────
  if (root) {
    for (const sub of ['schema', 'rubric', 'templates', 'constitution.md']) {
      const p = join(root, sub)
      if (existsSync(p)) out += line(OK, sub, 'có')
      else {
        out += line(BAD, sub, 'THIẾU — gate/review sẽ không chạy được')
        bad++
      }
    }
  }

  // ── 5b. Template pipeline theo loại việc ────────────────────────────────
  // pp init đọc template theo PKG_ROOT (bản cài pp), không theo --root — thiếu
  // hay hỏng JSON là init từ chối ngay cửa với type (spec pp-bugfix §8).
  //
  // FINDING (review 8c825c9..44c1ecb): thông điệp cũ nói "pp init sẽ từ chối
  // type/size này" cho CẢ BỐN template — sai với S/M: init fallback về M và
  // exit 0 (init.js:119-123). Doctor và init không được nói khác nhau về cùng
  // một tình huống, nên mỗi template nói đúng hệ quả của chính nó.
  const schemaRefs = new Set()
  for (const t of ['pipeline.S.json', 'pipeline.M.json', 'pipeline.bugfix.json', 'pipeline.change.json']) {
    const isSize = t === 'pipeline.S.json' || t === 'pipeline.M.json'
    // M là đích của fallback: thiếu nó thì không còn gì để lùi về.
    const hệQuả = t === 'pipeline.M.json'
      ? 'pp init không còn template nào để fallback'
      : isSize ? 'pp init sẽ fallback về M' : 'pp init sẽ từ chối type này'
    const p = join(pkgRoot, 'templates', t)
    if (!existsSync(p)) {
      out += line(BAD, `templates/${t}`, `KHÔNG tồn tại — ${hệQuả}`)
      bad++
      continue
    }
    try {
      const tpl = JSON.parse(readFileSync(p, 'utf8'))
      for (const s of Object.values(tpl.stages ?? {})) {
        if (typeof s.schema === 'string') schemaRefs.add(s.schema)
      }
      out += line(OK, `templates/${t}`, 'JSON hợp lệ')
    } catch {
      out += line(BAD, `templates/${t}`, `JSON HỎNG — ${hệQuả}`)
      bad++
    }
  }

  // ── 5c. Schema mà template/pipeline khai TƯỜNG MINH ─────────────────────
  // 5b đi được 90% đường rồi dừng ngay trước bước quan trọng nhất: file schema
  // mà template trỏ tới. Thiếu nó thì gate chạy trên schema rỗng — nay
  // `checksFor` trả check `schema-ref` đỏ, nhưng doctor phải thấy TRƯỚC khi một
  // vòng gate bị đốt (đúng lý do lệnh này tồn tại).
  if (root) {
    // Feature đang sống có thể khai schema khác template (sửa tay) — gate đọc
    // chính nó, nên doctor phải đọc chính nó.
    const featureRefs = []
    const fdir = join(root, 'features')
    if (existsSync(fdir)) {
      for (const e of readdirSync(fdir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue
        const p = join(fdir, e.name, 'pipeline.json')
        if (!existsSync(p)) continue
        try {
          for (const [id, s] of Object.entries(JSON.parse(readFileSync(p, 'utf8')).stages ?? {})) {
            if (typeof s.schema === 'string') featureRefs.push([s.schema, `${e.name}/${id}`])
          }
        } catch { /* pipeline.json hỏng: mục 5 và gate báo đúng chỗ */ }
      }
    }
    const refs = [
      ...[...schemaRefs].map((n) => [n, 'template']),
      ...featureRefs,
    ]
    for (const [name, nguồn] of refs) {
      const p = join(root, 'schema', `${name}.json`)
      if (!existsSync(p)) {
        out += line(BAD, `schema/${name}.json`, `KHÔNG tồn tại (${nguồn} khai) — gate mất heading + checklist`)
        bad++
        continue
      }
      try {
        JSON.parse(readFileSync(p, 'utf8'))
        out += line(OK, `schema/${name}.json`, `có (${nguồn} khai)`)
      } catch {
        out += line(BAD, `schema/${name}.json`, `JSON HỎNG (${nguồn} khai) — gate sẽ exit 2`)
        bad++
      }
    }
  }

  out += '\n'
  if (bad === 0 && warn === 0) {
    out += 'Tất cả kiểm tra đạt.\n'
  } else {
    out += `${bad} lỗi, ${warn} cảnh báo.\n`
  }
  // Nói thẳng giới hạn: doctor đọc được cấu hình trên đĩa, KHÔNG quan sát được
  // phiên Claude Code đang chạy. Không được để người dùng hiểu "✓" là "hook vừa
  // chạy" — đó lại là một lời đảm bảo không kiểm chứng được.
  out += 'Lưu ý: doctor đọc cấu hình trên đĩa. Nó không thấy được phiên Claude Code\n' +
    'hiện tại — settings mới ghi có thể cần mở /hooks hoặc mở lại phiên để được nạp,\n' +
    'và disableAllHooks (hoặc một tầng settings khác) vẫn có thể tắt hết.\n'

  process.stdout.write(out)
  return bad > 0 ? 1 : 0
}
