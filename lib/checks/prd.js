import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkSectionChecklist, extractSection } from './common.js'

// FINDING 1: use \s+ instead of a literal space so a wrapped line between
// clauses (e.g. condition on one line, "THE SYSTEM SHALL" on the next) still matches.
const EARS = [
  /^THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^WHEN\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^WHILE\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^IF\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
  /^WHEN\s+.+\s+WHILE\s+.+\s+IF\s+.+\s+THE\s+SYSTEM\s+SHALL\s+.+$/s,
]

// BUG FIX: the old regex only matched the exact literal shapes `<ac id="X">` and
// `<ac id="X" story="Y">` (and `<us id="X">` with id required to be the FIRST
// attribute). Any other attribute — including a plausible typo like
// `story-x="US-1"` instead of `story="US-1"`, or `id` appearing after another
// attribute, or an attribute missing altogether — made the whole block invisible:
// checkIds never saw it (so it wasn't flagged as an orphan), checkEars never saw
// its body (so malformed EARS content passed blank), and parseAcIds silently
// dropped it out of test-plan traceability. A single mistyped attribute name could
// therefore remove an AC from every check while the gate reported green — exactly
// the LLM-authoring mistake T1 exists to catch. We now match the tag generically
// by name (mirroring `tcBlocks` in testplan.js), parse whatever attributes are
// actually present into a map, and VALIDATE explicitly instead of skipping.
const AC_KNOWN_ATTRS = new Set(['id', 'story'])
const US_KNOWN_ATTRS = new Set(['id'])

function parseAttrs(raw) {
  return Object.fromEntries([...raw.matchAll(/([^\s="]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]))
}

function excerpt(text, n = 40) {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function acBlocks(text) {
  return [...text.matchAll(/<ac\b([^>]*)>([\s\S]*?)<\/ac>/g)].map((m, i) => {
    const attrs = parseAttrs(m[1])
    return { index: i + 1, attrs, id: attrs.id, story: attrs.story, body: m[2].trim() }
  })
}

function usBlocks(text) {
  return [...text.matchAll(/<us\b([^>]*)>([\s\S]*?)<\/us>/g)].map((m, i) => {
    const attrs = parseAttrs(m[1])
    return { index: i + 1, attrs, id: attrs.id, body: m[2].trim() }
  })
}

function countOccurrences(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

// Only ids that actually exist — a block with a missing id has already been
// reported as a failure by checkIds and must not surface as "undefined" in
// downstream traceability (checkTraceability / checkTypeRatio in testplan.js).
export function parseAcIds(text) {
  return acBlocks(text)
    .map((ac) => ac.id)
    .filter(Boolean)
}

export function checkEars(text, file) {
  const messages = []
  const acs = acBlocks(text)
  for (const ac of acs) {
    // A malformed wrapper (missing/unrecognized attribute) is still reported by
    // checkIds; here we still label it so the EARS message is locatable even when
    // there's no id to name.
    const label = ac.id ?? `AC #${ac.index} (thiếu id) — nội dung: "${excerpt(ac.body)}"`
    const shalls = (ac.body.match(/THE SYSTEM SHALL/g) ?? []).length
    if (shalls === 0) {
      messages.push(`${file}: ${label} không viết theo EARS — thiếu "THE SYSTEM SHALL"`)
    } else if (shalls > 1) {
      messages.push(`${file}: ${label} có ${shalls} chữ SHALL — AC bị gộp, phải tách thành ${shalls} AC`)
    } else if (!EARS.some((re) => re.test(ac.body))) {
      messages.push(`${file}: ${label} không khớp pattern EARS nào (WHEN / WHILE / IF / ubiquitous)`)
    }
  }
  if (acs.length === 0) messages.push(`${file}: không tìm thấy AC nào`)
  return { name: 'ears', ok: messages.length === 0, messages }
}

// FINDING 2: duplicate US-*/AC-* ids must fail, not silently overwrite each other.
export function checkIds(text, file) {
  const messages = []

  const usList = usBlocks(text)
  for (const us of usList) {
    const label = us.id ?? `user story #${us.index} — nội dung: "${excerpt(us.body)}"`
    if (!us.id) messages.push(`${file}: ${label} thiếu thuộc tính id`)
    for (const attr of Object.keys(us.attrs)) {
      if (!US_KNOWN_ATTRS.has(attr)) {
        messages.push(`${file}: ${label} có thuộc tính không hợp lệ "${attr}"`)
      }
    }
  }

  const usIds = usList.map((us) => us.id).filter(Boolean)
  const stories = new Set(usIds)
  if (stories.size === 0) messages.push(`${file}: không tìm thấy user story nào`)

  for (const [id, count] of countOccurrences(usIds)) {
    if (count > 1) messages.push(`${file}: US id "${id}" bị lặp lại ${count} lần`)
  }

  const acs = acBlocks(text)
  for (const ac of acs) {
    const label = ac.id ?? `AC #${ac.index} — nội dung: "${excerpt(ac.body)}"`
    if (!ac.id) messages.push(`${file}: ${label} thiếu thuộc tính id`)
    for (const attr of Object.keys(ac.attrs)) {
      if (!AC_KNOWN_ATTRS.has(attr)) {
        messages.push(`${file}: ${label} có thuộc tính không hợp lệ "${attr}"`)
      }
    }
  }

  const acIds = acs.map((ac) => ac.id).filter(Boolean)
  for (const [id, count] of countOccurrences(acIds)) {
    if (count > 1) messages.push(`${file}: AC id "${id}" bị lặp lại ${count} lần`)
  }

  for (const ac of acs) {
    if (!ac.id) continue // already reported above
    if (!ac.story) messages.push(`${file}: ${ac.id} là AC mồ côi — thiếu thuộc tính story`)
    else if (!stories.has(ac.story)) messages.push(`${file}: ${ac.id} trỏ tới story không tồn tại "${ac.story}"`)
  }
  return { name: 'ids', ok: messages.length === 0, messages }
}

// FINDING 3: scope the risk checklist to the "## Rủi ro" section only, and strip
// fenced code blocks from that slice, so an example-only or out-of-section mention
// cannot satisfy the check.
//
// B3: cơ chế này (một section, một danh sách mục, mỗi mục phải có kết luận —
// "không áp dụng vì …" cũng tính) nay nằm ở checks/common.js và được
// `edgeCaseChecklist` của 40-testplan dùng lại. Thông điệp không đổi một ký tự.
export function checkRiskChecklist(text, file, requiredItems) {
  return checkSectionChecklist(text, file, {
    name: 'risk-checklist',
    heading: '## Rủi ro',
    label: 'mục rủi ro',
    items: requiredItems,
  })
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

// Trụ cột 2 (bản 2026-08-21): "ép hỏi trước khi viết" có HAI đường hợp lệ —
// 8 câu như cũ, hoặc khối tự đánh giá độ rõ khi agent thấy brief + refs đã đủ.
// T1 chỉ kiểm cấu trúc của khối (heading có mặt, hai dòng nhãn không bỏ trống,
// không quá clearQuestionsMax câu); lời khai "đủ rõ" có ĐÁNG TIN hay không là
// việc của T2 (rubric #7) và human gate — tầng deterministic không phán xét nổi.
export const CLARITY_HEADING = '## Tự đánh giá độ rõ'
const CLARITY_LABELS = ['Lý do đủ rõ', 'Giả định đã xác minh']

function parseClarityBlock(text) {
  const section = extractSection(text, CLARITY_HEADING)
  if (section === null) return null
  // Cùng quy tắc "cùng dòng" của checkSectionChecklist: giá trị của nhãn là
  // phần còn lại của CHÍNH dòng đó — không mượn được nội dung dòng sau.
  const lines = section.replace(/```[\s\S]*?```/g, '').split('\n')
  const value = (label) => {
    const re = new RegExp(`${label}[ \\t]*:(.*)$`)
    const hit = lines.map((l) => re.exec(l)).find(Boolean)
    return hit ? hit[1].trim() : null
  }
  return { reason: value(CLARITY_LABELS[0]), assumptions: value(CLARITY_LABELS[1]) }
}

export function checkQuestionsAnswered(featureDir, minQuestions = 8, clearQuestionsMax = 2) {
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
  const clarity = parseClarityBlock(text)
  if (clarity === null) {
    if (distinct < minQuestions) {
      messages.push(
        `10-questions.md: mới có ${distinct} câu hỏi phân biệt, cần tối thiểu ${minQuestions}` +
          ` — hoặc, nếu brief + refs đủ rõ, khai khối "${CLARITY_HEADING}" (Lý do đủ rõ + Giả định đã xác minh) và chỉ tối đa ${clearQuestionsMax} câu verify`,
      )
    }
  } else {
    if (!clarity.reason) {
      messages.push(
        `10-questions.md: khối "${CLARITY_HEADING}" thiếu dòng "Lý do đủ rõ: …" — phải nêu vì sao brief + refs đủ rõ để không cần hỏi ${minQuestions} câu`,
      )
    }
    if (!clarity.assumptions) {
      messages.push(
        `10-questions.md: khối "${CLARITY_HEADING}" thiếu dòng "Giả định đã xác minh: …" — mỗi giả định phải kèm cách đã xác minh (cite path code/refs); không có giả định nào thì ghi thẳng "không có"`,
      )
    }
    if (distinct > clearQuestionsMax) {
      messages.push(
        `10-questions.md: khai "${CLARITY_HEADING}" nhưng hỏi ${distinct} câu — khối này chỉ dành cho tối đa ${clearQuestionsMax} câu verify; cần hỏi nhiều hơn thì xoá khối và hỏi đủ ${minQuestions} câu`,
      )
    }
  }

  for (const b of blocks) {
    if (!b.answered) messages.push(`10-questions.md: ${b.label} chưa có câu trả lời`)
  }

  return { name: 'questions', ok: messages.length === 0, messages }
}

// FINDING (review 8c825c9..44c1ecb): `## Delta` là heading duy nhất của
// schema/10-prd.change.json không có gì đứng sau nó — `## Rủi ro` có
// checkRiskChecklist + rubric #4, `## Out of scope` có rubric #2, còn Delta thì
// T1 chỉ kiểm chuỗi có mặt và rubric không có một chữ nào về nó. Spec §5.2 đòi
// mỗi thay đổi đánh dấu ADDED/MODIFIED/REMOVED "PRD delta, không phải PRD viết
// lại" — luật đó chưa từng được thi hành ở tier nào. Dùng lại đúng cơ chế
// checkSectionChecklist (0 cơ chế mới, Điều 1): nó đòi mỗi marker có KẾT LUẬN,
// nên `REMOVED: không có.` là hợp lệ và một section rỗng thì đỏ.
export function checkDeltaChecklist(text, file, requiredItems) {
  return checkSectionChecklist(text, file, {
    name: 'delta-checklist',
    heading: '## Delta',
    label: 'mục delta',
    items: requiredItems,
  })
}

export function prdChecks(schema) {
  const checks = [
    { name: 'ears', run: (t) => checkEars(t, '10-prd.md') },
    { name: 'ids', run: (t) => checkIds(t, '10-prd.md') },
    { name: 'risk-checklist', run: (t) => checkRiskChecklist(t, '10-prd.md', schema.riskChecklist) },
    { name: 'questions', run: (_t, ctx) => checkQuestionsAnswered(ctx.featureDir, schema.minQuestions, schema.clearQuestionsMax) },
  ]
  // Chỉ pipeline nào khai deltaChecklist mới bị đòi — pipeline feature thường
  // không có field đó nên hành vi cũ y nguyên.
  if (schema.deltaChecklist?.length) {
    checks.push({
      name: 'delta-checklist',
      run: (t) => checkDeltaChecklist(t, '10-prd.md', schema.deltaChecklist),
    })
  }
  return checks
}
