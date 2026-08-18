import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseAcIds } from './prd.js'

const DEFAULT_ATTRS = ['id', 'ac_ref', 'type', 'priority']
const DEFAULT_FIELDS = ['precondition', 'steps', 'expected']
const KNOWN_TYPES = ['positive', 'negative']

function countOccurrences(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

// FINDING 3: strip fenced code blocks before parsing so a <tc> that only appears
// inside a ``` ... ``` example is treated as illustrative, not a real test case.
function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

function tcBlocks(text) {
  return [...stripFences(text).matchAll(/<tc\s+([^>]*)>([\s\S]*?)<\/tc>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
    return { attrs, body: m[2], raw: m[0] }
  })
}

// FINDING 2: parse "field: value" blocks the same way prd.js parses Q/A blocks — a
// value may begin on the line AFTER the field name and continue until the next known
// field name or the end of the tc body, instead of requiring it on the same line.
function parseFieldBlocks(body, fields) {
  const namePattern = fields.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`^\\s*(${namePattern})\\s*:`, 'gm')
  const starts = [...body.matchAll(re)]
  const values = new Map()
  starts.forEach((m, i) => {
    const name = m[1]
    const from = m.index + m[0].length
    const to = i + 1 < starts.length ? starts[i + 1].index : body.length
    if (!values.has(name)) values.set(name, body.slice(from, to).trim())
  })
  return values
}

// FINDING 4: recognize a known type case-insensitively (e.g. "Negative" ==
// "negative"); a value that doesn't match any known kind returns null so callers
// can fail loudly instead of silently treating it as "no type".
function normalizeType(type) {
  return KNOWN_TYPES.find((k) => k === type?.trim().toLowerCase()) ?? null
}

export function checkTraceability(prdText, planText) {
  const acIds = parseAcIds(prdText)
  const covered = new Set(tcBlocks(planText).map((tc) => tc.attrs.ac_ref).filter(Boolean))
  const missing = acIds.filter((id) => !covered.has(id))
  const messages = missing.length
    ? [`${missing.length}/${acIds.length} AC chưa có test case: ${missing.join(', ')}`]
    : []
  return { name: 'traceability', ok: messages.length === 0, messages }
}

export function checkTcSchema(planText, attrs = DEFAULT_ATTRS, fields = DEFAULT_FIELDS) {
  const messages = []
  const blocks = tcBlocks(planText)
  if (blocks.length === 0) messages.push('không tìm thấy test case nào')

  // FINDING 1: duplicate TC ids must fail, not silently overwrite each other in
  // downstream traceability/coverage aggregation.
  const ids = blocks.map((tc) => tc.attrs.id).filter(Boolean)
  for (const [id, count] of countOccurrences(ids)) {
    if (count > 1) messages.push(`TC id "${id}" bị lặp lại ${count} lần`)
  }

  blocks.forEach((tc, i) => {
    const label = tc.attrs.id ?? `TC #${i + 1}`
    for (const a of attrs) if (!tc.attrs[a]) messages.push(`${label}: thiếu thuộc tính "${a}"`)

    // FINDING 4: an unrecognized `type` value must fail loudly, with the bad value
    // named, instead of silently making the AC look uncovered with no explanation.
    if (tc.attrs.type && !normalizeType(tc.attrs.type)) {
      messages.push(`${label}: type "${tc.attrs.type}" không hợp lệ — phải là "${KNOWN_TYPES.join('" hoặc "')}"`)
    }

    const values = parseFieldBlocks(tc.body, fields)
    for (const f of fields) {
      const value = values.get(f)
      if (value === undefined) messages.push(`${label}: thiếu trường "${f}"`)
      else if (!value) messages.push(`${label}: trường "${f}" bỏ trống`)
    }
  })
  return { name: 'tc-schema', ok: messages.length === 0, messages }
}

export function checkTypeRatio(prdText, planText) {
  const byAc = new Map()
  for (const tc of tcBlocks(planText)) {
    if (!tc.attrs.ac_ref) continue
    const type = normalizeType(tc.attrs.type)
    if (!type) continue
    if (!byAc.has(tc.attrs.ac_ref)) byAc.set(tc.attrs.ac_ref, new Set())
    byAc.get(tc.attrs.ac_ref).add(type)
  }
  const messages = []
  for (const id of parseAcIds(prdText)) {
    const types = byAc.get(id) ?? new Set()
    for (const need of KNOWN_TYPES) {
      if (!types.has(need)) messages.push(`${id}: thiếu case "${need}"`)
    }
  }
  return { name: 'type-ratio', ok: messages.length === 0, messages }
}

export function testplanChecks(featureDir, schema) {
  const prdPath = join(featureDir, '10-prd.md')
  const prd = existsSync(prdPath) ? readFileSync(prdPath, 'utf8') : ''
  return [
    { name: 'traceability', run: (t) => checkTraceability(prd, t) },
    { name: 'tc-schema', run: (t) => checkTcSchema(t, schema.requiredTcAttrs, schema.requiredTcFields) },
    { name: 'type-ratio', run: (t) => checkTypeRatio(prd, t) },
  ]
}
