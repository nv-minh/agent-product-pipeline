import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PLACEHOLDER = /\bTBD\b|\bTODO\b|\bFIXME\b|\bXXX\b|\?\?\?|\{\{[^}]*\}\}/

export function checkPlaceholders(text, file) {
  const messages = []
  text.split('\n').forEach((line, i) => {
    const m = line.match(PLACEHOLDER)
    if (m) messages.push(`${file} dòng ${i + 1}: còn placeholder "${m[0]}"`)
  })
  return { name: 'placeholders', ok: messages.length === 0, messages }
}

export function checkHeadings(text, required, file) {
  const messages = required
    .filter((h) => !text.includes(h))
    .map((h) => `${file}: thiếu heading bắt buộc "${h}"`)
  return { name: 'headings', ok: messages.length === 0, messages }
}

const LOOKS_LIKE_PATH = /^[\w./@-]+\/[\w./@-]+\.[a-z]{1,5}$/i

export function checkCitedPaths(text, repoRoot, file) {
  const messages = []
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const candidate = m[1].trim()
    if (!LOOKS_LIKE_PATH.test(candidate)) continue

    // FINDING 5: Skip non-repo-relative paths
    // Skip if contains a scheme (://)
    if (candidate.includes('://')) continue
    // Skip if starts with @ (scoped package)
    if (candidate.startsWith('@')) continue
    // Skip if first path segment contains a dot (hostname-like)
    const firstSegment = candidate.split('/')[0]
    if (firstSegment.includes('.')) continue

    if (!existsSync(join(repoRoot, candidate))) {
      messages.push(`${file}: cite đường dẫn không tồn tại "${candidate}"`)
    }
  }
  return { name: 'cited-paths', ok: messages.length === 0, messages }
}
