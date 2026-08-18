import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { newEvidence } from './evidence.js'
import { readState, writeState, hashInputs } from './state.js'
import { MAX_ATTEMPTS } from './plan.js'

export function runT1(featureDir, config, state, stageId, checks) {
  const stage = config.stages[stageId]
  const prev = state.stages?.[stageId] ?? { attempts: 0 }
  const attempt = (prev.attempts ?? 0) + 1
  const ev = newEvidence(featureDir, stageId, 't1', attempt)

  const primaryOutput = stage.outputs[stage.outputs.length - 1]
  const text = readFileSync(join(featureDir, primaryOutput), 'utf8')

  for (const check of checks) {
    const res = check.run(text, { featureDir, stage, config })
    ev.record(`pp-check ${res.name} ${primaryOutput}`, res.ok ? '' : res.messages.join('\n'), res.ok ? 0 : 1)
  }

  const ok = !ev.failed
  const evidence = ev.finish(ok ? 'PASS' : 'FAIL')

  const next = readState(featureDir)
  next.feature = config.feature
  next.stages = next.stages ?? {}
  next.stages[stageId] = {
    ...prev,
    status: ok ? 'done' : attempt >= MAX_ATTEMPTS ? 'blocked' : 'failed',
    attempts: attempt,
    gate: ok ? 'pass' : 'fail',
    evidence,
    ...(ok ? { inputs_hash: hashInputs(featureDir, stage.inputs) } : {}),
  }
  writeState(featureDir, next)
  return { ok, evidencePath: evidence }
}
