// lib/evidence.js
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_ATTEMPTS } from './plan.js'

const DIR = '.evidence'

export function evidencePath(stageId) {
  return `${DIR}/${stageId}.log`
}

export function newEvidence(featureDir, stageId, tier, attempt) {
  mkdirSync(join(featureDir, DIR), { recursive: true })
  const lines = [`[${new Date().toISOString()}]  pp gate ${stageId} --tier ${tier}`]
  const ev = {
    failed: false,
    record(command, output, exitStatus) {
      lines.push(`$ ${command}`)
      if (output && output.trim()) {
        lines.push(...output.trimEnd().split('\n').map((l) => `  ${l}`))
      }
      lines.push(`Exit status: ${exitStatus}`)
      if (exitStatus !== 0) ev.failed = true
    },
    finish(result) {
      lines.push(`RESULT: ${result} (${tier}) — attempt ${attempt}/${MAX_ATTEMPTS}`, '')
      writeFileSync(join(featureDir, evidencePath(stageId)), lines.join('\n'))
      return evidencePath(stageId)
    },
  }
  return ev
}

export function hasFailure(featureDir, stageId) {
  const p = join(featureDir, evidencePath(stageId))
  if (!existsSync(p)) return true
  return readFileSync(p, 'utf8')
    .split('\n')
    .some((l) => {
      const m = /^Exit status: (-?\d+)[ \t]*$/.exec(l)
      return m && Number(m[1]) !== 0
    })
}
