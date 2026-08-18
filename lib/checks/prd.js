import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// FINDING 1: use \s+ instead of a literal space so a wrapped line between
// clauses (e.g. condition on one line, "THE SYSTEM SHALL" on the next) still matches.
const EARS = [
  /^THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^WHEN\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^WHILE\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^IF\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^WHEN\s+.+\s+WHILE\s+.+\s+IF\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
]

function acBlocks(text) {
  return [...text.matchAll(/<ac id="([^"]+)"(?:\s+story="([^"]+)")?\s*>([\s\S]*?)<\/ac>/g)].map(
    (m) => ({ id: m[1], story: m[2], body: m[3].trim() }),
  )
}

function countOccurrences(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

export function parseAcIds(text) {
  return acBlocks(text).map((ac) => ac.id)
}

export function checkEars(text, file) {
  const messages = []
  for (const ac of acBlocks(text)) {
    const shalls = (ac.body.match(/THE SYSTEM SHALL/g) ?? []).length
    if (shalls === 0) {
      messages.push(`${file}: ${ac.id} không viết theo EARS — thiếu "THE SYSTEM SHALL"`)
    } else if (shalls > 1) {
      messages.push(`${file}: ${ac.id} có ${shalls} chữ SHALL — AC bị gộp, phải tách thành ${shalls} AC`)
    } else if (!EARS.some((re) => re.test(ac.body))) {
      messages.push(`${file}: ${ac.id} không khớp pattern EARS nào (WHEN / WHILE / IF / ubiquitous)`)
    }
  }
  if (acBlocks(text).length === 0) messages.push(`${file}: không tìm thấy AC nào`)
  return { name: 'ears', ok: messages.length === 0, messages }
}

// FINDING 2: duplicate US-*/AC-* ids must fail, not silently overwrite each other.
export function checkIds(text, file) {
  const usIds = [...text.matchAll(/<us id="([^"]+)"/g)].map((m) => m[1])
  const stories = new Set(usIds)
  const messages = []
  if (stories.size === 0) messages.push(`${file}: không tìm thấy user story nào`)

  for (const [id, count] of countOccurrences(usIds)) {
    if (count > 1) messages.push(`${file}: US id "${id}" bị lặp lại ${count} lần`)
  }

  const acs = acBlocks(text)
  for (const [id, count] of countOccurrences(acs.map((ac) => ac.id))) {
    if (count > 1) messages.push(`${file}: AC id "${id}" bị lặp lại ${count} lần`)
  }

  for (const ac of acs) {
    if (!ac.story) messages.push(`${file}: ${ac.id} là AC mồ côi — thiếu thuộc tính story`)
    else if (!stories.has(ac.story)) messages.push(`${file}: ${ac.id} trỏ tới story không tồn tại "${ac.story}"`)
  }
  return { name: 'ids', ok: messages.length === 0, messages }
}

// FINDING 3: scope the risk checklist to the "## Rủi ro" section only, and strip
// fenced code blocks from that slice, so an example-only or out-of-section mention
// cannot satisfy the check.
function extractRiskSection(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === '## Rủi ro')
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n')
}

export function checkRiskChecklist(text, file, requiredItems) {
  const messages = []
  const section = extractRiskSection(text)
  if (section === null) {
    for (const item of requiredItems) {
      messages.push(`${file}: thiếu mục rủi ro "${item}" — không tìm thấy heading "## Rủi ro"`)
    }
    return { name: 'risk-checklist', ok: false, messages }
  }
  const scoped = section.replace(/```[\s\S]*?```/g, '')
  for (const item of requiredItems) {
    const re = new RegExp(`${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)`, 'i')
    const m = scoped.match(re)
    if (!m) messages.push(`${file}: thiếu mục rủi ro "${item}"`)
    else if (!m[1].trim()) messages.push(`${file}: mục rủi ro "${item}" bỏ trống — phải có kết luận, kể cả "không áp dụng vì …"`)
  }
  return { name: 'risk-checklist', ok: messages.length === 0, messages }
}

// FINDING 4 & 5: a small block parser — split on "Q<number>:" line-start boundaries,
// take everything after the first "A:" in a block (even on a following line) as the
// answer, and count DISTINCT question numbers rather than matched pairs.
function parseQuestionBlocks(text) {
  const starts = [...text.matchAll(/^Q(\d+):/gm)]
  return starts.map((m, i) => {
    const from = m.index
    const to = i + 1 < starts.length ? starts[i + 1].index : text.length
    const block = text.slice(from, to)
    const answerMatch = block.match(/^A:([\s\S]*)$/m)
    const answer = answerMatch ? answerMatch[1].trim() : ''
    return { label: `Q${m[1]}`, answered: answer.length > 0 }
  })
}

export function checkQuestionsAnswered(featureDir, minQuestions = 8) {
  const p = join(featureDir, '10-questions.md')
  if (!existsSync(p)) {
    return { name: 'questions', ok: false, messages: ['thiếu 10-questions.md — phải hỏi trước khi viết PRD'] }
  }
  const text = readFileSync(p, 'utf8')
  const blocks = parseQuestionBlocks(text)
  const messages = []

  const counts = countOccurrences(blocks.map((b) => b.label))
  for (const [label, count] of counts) {
    if (count > 1) messages.push(`10-questions.md: ${label} bị lặp lại ${count} lần`)
  }

  const distinct = counts.size
  if (distinct < minQuestions) {
    messages.push(`10-questions.md: mới có ${distinct} câu hỏi phân biệt, cần tối thiểu ${minQuestions}`)
  }

  for (const b of blocks) {
    if (!b.answered) messages.push(`10-questions.md: ${b.label} chưa có câu trả lời`)
  }

  return { name: 'questions', ok: messages.length === 0, messages }
}

export function prdChecks(schema) {
  return [
    { name: 'ears', run: (t) => checkEars(t, '10-prd.md') },
    { name: 'ids', run: (t) => checkIds(t, '10-prd.md') },
    { name: 'risk-checklist', run: (t) => checkRiskChecklist(t, '10-prd.md', schema.riskChecklist) },
    { name: 'questions', run: (_t, ctx) => checkQuestionsAnswered(ctx.featureDir, schema.minQuestions) },
  ]
}
