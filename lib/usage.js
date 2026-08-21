// lib/usage.js — khai thác token usage THẬT từ transcript Claude Code.
// pp không tự gọi LLM (không có SDK/http) nên token thật chỉ tồn tại ở
// ~/.claude/projects/<munged-cwd>/*.jsonl — LLM không thể tự khai token của
// chính mình, và evidence không nhận lời khai. Chỉ lưu SỐ + metadata gán về
// feature/stage; nội dung hội thoại không được copy (riêng tư + kích thước).
import { createReadStream, readdirSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { hashString } from './audit.js'

// Thứ tự ưu tiên: --transcripts → PP_TRANSCRIPTS (seam cho test) → mặc định
// ~/.claude/projects. Dùng os.homedir() chứ không đọc $HOME (Windows/CI).
export function transcriptsDir(flagDir) {
  if (typeof flagDir === 'string' && flagDir) return flagDir
  if (process.env.PP_TRANSCRIPTS) return process.env.PP_TRANSCRIPTS
  return join(homedir(), '.claude', 'projects')
}

// Quy tắc munge cwd của Claude Code: mọi ký tự không alphanumeric thành '-'
// (/home/alice/x → -home-alice-x). Chỉ quét đúng dir project này — không đụng
// transcript của project khác.
export function mungePath(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

const WINDOW_CAP_MS = 2 * 60 * 60 * 1000 // thiếu sự kiện đóng: cửa sổ tối đa 2h

// Dựng cửa sổ thời gian từ audit.jsonl: mỗi event dispatch/review-prompt của
// một stage mở cửa sổ [ts, sự kiện audit KẾ TIẾP) — cap +2h. Đây là phần
// HEURISTIC của việc gán token về stage (không phải phép đếm chính xác
// tuyệt đối); mỗi entry lưu kèm attrib/stage/ts thô để script sau tái gán
// mà không phải khai thác lại.
export function buildWindows(auditEvents) {
  const sorted = [...auditEvents].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const windows = []
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]
    if (e.event !== 'dispatch' && e.event !== 'review-prompt') continue
    if (!e.stage) continue
    const start = Date.parse(e.ts)
    if (Number.isNaN(start)) continue
    let end = i + 1 < sorted.length ? Date.parse(sorted[i + 1].ts) : start + WINDOW_CAP_MS
    if (end - start > WINDOW_CAP_MS) end = start + WINDOW_CAP_MS
    if (end <= start) end = start + 60_000 // hai event cùng giây: cửa sổ tối thiểu 1 phút
    windows.push({ start, end, stage: e.stage })
  }
  return windows
}

// D5 — mention từng so bằng `includes('features/<feature>')`: feature `auth`
// hút trọn mọi dòng của `auth-v2` (substring không có ranh giới). Ranh giới
// segment: sau tên feature phải là ký tự NGOÀI bảng chữ tên feature ([a-z0-9-],
// đã được C2 ép ở đầu vào) hoặc hết chuỗi. Tên đã qua allowlist nên nhúng thẳng
// vào regex không cần escape.
export function mentionRegex(feature) {
  return new RegExp(`features/${feature}(?![a-z0-9-])`)
}

function attribute(tsMs, windows) {
  for (const w of windows) {
    if (tsMs >= w.start && tsMs < w.end) return { attrib: 'window', stage: w.stage }
  }
  return null // caller tự thử mention fallback trên dòng thô
}

// Đọc các id đã có → Set. Idempotency dựa trên CHÍNH file output: chạy sync
// hai lần phải thêm 0 mục.
export function loadExistingIds(entriesPath) {
  const ids = new Set()
  let text
  try {
    text = readFileSync(entriesPath, 'utf8')
  } catch {
    return ids
  }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    try {
      ids.add(JSON.parse(l).id)
    } catch {
      // dòng hỏng: bỏ qua
    }
  }
  return ids
}

// Quét MỘT file transcript (streaming — transcript có thể hàng trăm MB).
// Trả về {added: entry[], scanned, skippedGarbage} — entry là những dòng
// assistant có usage, ĐÃ dedup, ĐÃ gán về feature (null = bỏ).
async function mineFile(filePath, { root, feature, windows, sinceMs, known }) {
  const sessionIdFromFile = basename(filePath, '.jsonl')
  const mentionRe = mentionRegex(feature)
  const added = []
  let scanned = 0
  let garbage = 0
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    let j
    try {
      j = JSON.parse(line)
    } catch {
      garbage++
      continue
    }
    const u = j?.message?.usage
    if (j?.type !== 'assistant' || !u) continue
    scanned++
    // Phiên của project khác lọt vào dir (hiếm): bỏ theo cwd của entry.
    // D5: so PREFIX, không so tuyệt đối — một session mở ở SUBDIR của repo
    // (backend-repo/src chẳng hạn) có cwd sâu hơn root và từng bị loại sạch.
    if (typeof j.cwd === 'string' && j.cwd !== root && !j.cwd.startsWith(root + '/')) continue
    // Dedup: MỘT API response sinh nhiều dòng (mỗi content block một dòng)
    // với usage giống hệt nhau — đếm theo (session, message.id). Đo thực tế:
    // không dedup thì token thổi phồng ~65%. Thiếu message.id thì hash cả
    // dòng để vẫn dedup tất định.
    const id = `${j.sessionId ?? sessionIdFromFile}:${j.message.id ?? 'h' + hashString(line)}`
    if (known.has(id)) continue
    const tsMs = Date.parse(j.timestamp ?? '')
    if (Number.isNaN(tsMs)) continue
    if (sinceMs !== null && tsMs < sinceMs) continue
    // Cửa sổ thời gian trước; trượt thì fallback mention trên dòng thô
    // (tool input, text nhắc tới feature) → thuộc feature nhưng không rõ stage.
    const a = attribute(tsMs, windows)
      ?? (mentionRe.test(line) ? { attrib: 'mention', stage: null } : null)
    if (!a) continue
    known.add(id) // cũng dedup TRONG một lượt quét nhiều dòng trùng
    added.push({
      v: 1,
      id,
      ts: j.timestamp,
      session: j.sessionId ?? sessionIdFromFile,
      model: j.message.model ?? null,
      sidechain: Boolean(j.isSidechain),
      attrib: a.attrib,
      stage: a.stage,
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    })
  }
  return { added, scanned, garbage }
}

// Quét mọi *.jsonl trong dir munged của root. Trả về null khi dir không tồn
// tại (thiếu dữ liệu — không phải lỗi).
export async function mineProject(transcriptsBase, { root, feature, windows, sinceMs, known }) {
  const projDir = join(transcriptsBase, mungePath(root))
  let files
  try {
    files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl')).sort()
  } catch {
    return null
  }
  const added = []
  let scanned = 0
  let garbage = 0
  for (const f of files) {
    const r = await mineFile(join(projDir, f), { root, feature, windows, sinceMs, known })
    added.push(...r.added)
    scanned += r.scanned
    garbage += r.garbage
  }
  return { added, scanned, garbage, files: files.length, projDir }
}

export function entriesPath(featureDir) {
  return join(featureDir, '.usage', 'entries.jsonl')
}

export function appendEntries(featureDir, entries) {
  mkdirSync(join(featureDir, '.usage'), { recursive: true })
  appendFileSync(entriesPath(featureDir), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''))
}

// Đọc lại toàn bộ entries (sau append) để in rollup.
export function readEntries(featureDir) {
  let text
  try {
    text = readFileSync(entriesPath(featureDir), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    try {
      out.push(JSON.parse(l))
    } catch {
      // dòng hỏng: bỏ qua
    }
  }
  return out
}
