import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EARS = [
  /^THE SYSTEM SHALL .+$/s,
  /^WHEN .+ THE SYSTEM SHALL .+$/s,
  /^WHILE .+ THE SYSTEM SHALL .+$/s,
  /^IF .+ THE SYSTEM SHALL .+$/s,
  /^WHEN .+ WHILE .+ IF .+ THE SYSTEM SHALL .+$/s,
]

function acBlocks(text) {
  return [...text.matchAll(/<ac id="([^"]+)"(?:\s+story="([^"]+)")?\s*>([\s\S]*?)<\/ac>/g)].map(
    (m) => ({ id: m[1], story: m[2], body: m[3].trim() }),
  )
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

export function checkIds(text, file) {
  const stories = new Set([...text.matchAll(/<us id="([^"]+)"/g)].map((m) => m[1]))
  const messages = []
  if (stories.size === 0) messages.push(`${file}: không tìm thấy user story nào`)
  for (const ac of acBlocks(text)) {
    if (!ac.story) messages.push(`${file}: ${ac.id} là AC mồ côi — thiếu thuộc tính story`)
    else if (!stories.has(ac.story)) messages.push(`${file}: ${ac.id} trỏ tới story không tồn tại "${ac.story}"`)
  }
  return { name: 'ids', ok: messages.length === 0, messages }
}

export function checkRiskChecklist(text, file, requiredItems) {
  const messages = []
  for (const item of requiredItems) {
    const re = new RegExp(`${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)`, 'i')
    const m = text.match(re)
    if (!m) messages.push(`${file}: thiếu mục rủi ro "${item}"`)
    else if (!m[1].trim()) messages.push(`${file}: mục rủi ro "${item}" bỏ trống — phải có kết luận, kể cả "không áp dụng vì …"`)
  }
  return { name: 'risk-checklist', ok: messages.length === 0, messages }
}

export function checkQuestionsAnswered(featureDir, minQuestions = 8) {
  const p = join(featureDir, '10-questions.md')
  if (!existsSync(p)) {
    return { name: 'questions', ok: false, messages: ['thiếu 10-questions.md — phải hỏi trước khi viết PRD'] }
  }
  const text = readFileSync(p, 'utf8')
  const pairs = [...text.matchAll(/^(Q\d+):[^\n]*\n+A:([^\n]*)/gm)]
  const messages = []
  if (pairs.length < minQuestions) {
    messages.push(`10-questions.md: mới có ${pairs.length} câu, cần tối thiểu ${minQuestions}`)
  }
  for (const m of pairs) {
    if (!m[2].trim()) messages.push(`10-questions.md: ${m[1]} chưa có câu trả lời`)
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
