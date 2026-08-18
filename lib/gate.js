import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { newEvidence } from './evidence.js'
import { readState, writeState, hashInputs } from './state.js'
import { MAX_ATTEMPTS } from './plan.js'

export function runT1(featureDir, config, state, stageId, checks) {
  const stage = config.stages[stageId]
  // REVIEW FINDING 1: an unknown stage id must fail loudly here too — this
  // protects every caller (gateCmd today, later tasks tomorrow) from an
  // unguarded `stage.outputs` property access turning a typo'd stage id into
  // an internal TypeError instead of a stated precondition violation.
  if (!stage) {
    throw new Error(`stage "${stageId}" không được khai báo trong pipeline.json`)
  }
  // FINDING 1: Read fresh state from disk at TOP for authoritative prev
  const diskState = readState(featureDir)
  const prev = diskState.stages?.[stageId] ?? { attempts: 0 }
  const attempt = (prev.attempts ?? 0) + 1
  const ev = newEvidence(featureDir, stageId, 't1', attempt)

  const primaryOutput = stage.outputs[stage.outputs.length - 1]
  const artifactPath = join(featureDir, primaryOutput)

  // FINDING 4: Check artifact existence before reading
  if (!existsSync(artifactPath)) {
    ev.record(`artifact-exists`, `Missing artifact: ${primaryOutput}`, 1)
    const ok = false
    const evidence = ev.finish('FAIL')
    const next = readState(featureDir)
    next.feature = config.feature
    next.stages = next.stages ?? {}
    const newEntry = {
      ...prev,
      status: attempt >= MAX_ATTEMPTS ? 'blocked' : 'failed',
      attempts: attempt,
      gate: 'fail',
      evidence,
    }
    // FINDING 6: Clear human field on any run
    delete newEntry.human
    next.stages[stageId] = newEntry
    writeState(featureDir, next)
    return { ok, evidencePath: evidence }
  }

  const text = readFileSync(artifactPath, 'utf8')

  // FINDING 2 & 3: Compute inputs_hash BEFORE finish, wrap checks in try/catch
  let inputsHash
  if (checks.length > 0) {
    for (const check of checks) {
      try {
        const res = check.run(text, { featureDir, stage, config })
        ev.record(`pp-check ${res.name} ${primaryOutput}`, res.ok ? '' : res.messages.join('\n'), res.ok ? 0 : 1)
      } catch (err) {
        // FINDING 3: Record failing check on throw
        ev.record(`pp-check ${check.name} ${primaryOutput}`, String(err), 1)
      }
    }
  }

  const ok = !ev.failed

  // FINDING 2: Compute hash BEFORE calling finish()
  if (ok) {
    try {
      inputsHash = hashInputs(featureDir, stage.inputs)
    } catch (err) {
      // If hashInputs throws, record as failed check and fail the run
      ev.record(`inputs-hash`, String(err), 1)
    }
  }

  const evidence = ev.finish(ok && !ev.failed ? 'PASS' : 'FAIL')

  const next = readState(featureDir)
  next.feature = config.feature
  next.stages = next.stages ?? {}
  const finalOk = !ev.failed
  const newEntry = {
    ...prev,
    status: finalOk ? 'done' : attempt >= MAX_ATTEMPTS ? 'blocked' : 'failed',
    attempts: attempt,
    gate: finalOk ? 'pass' : 'fail',
    evidence,
    ...(finalOk && inputsHash ? { inputs_hash: inputsHash } : {}),
  }
  // FINDING 6: Clear human field on any run
  delete newEntry.human
  next.stages[stageId] = newEntry
  writeState(featureDir, next)
  return { ok: finalOk, evidencePath: evidence }
}
