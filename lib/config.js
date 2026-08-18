import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED_STAGE_FIELDS = ['enabled', 'inputs', 'outputs', 'gate']

function parseInput(raw) {
  const optional = raw.endsWith('?')
  return { path: optional ? raw.slice(0, -1) : raw, optional }
}

export function readConfig(featureDir) {
  const file = join(featureDir, 'pipeline.json')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`không đọc được ${file}: ${e.message}`)
  }
  for (const k of ['feature', 'stages']) {
    if (!raw[k]) throw new Error(`${file}: thiếu field "${k}"`)
  }
  const stages = {}
  for (const [id, s] of Object.entries(raw.stages)) {
    for (const f of REQUIRED_STAGE_FIELDS) {
      if (s[f] === undefined) throw new Error(`${file}: stage "${id}" thiếu field "${f}"`)
    }
    stages[id] = {
      id,
      enabled: s.enabled,
      skills: s.skills ?? [],
      inputs: s.inputs.map(parseInput),
      outputs: s.outputs,
      gate: s.gate,
      human: s.human ?? false,
      budget: s.budget,
      handoff: s.handoff,
    }
  }
  return { feature: raw.feature, size: raw.size ?? 'M', stages }
}

export function stageOrder(config) {
  return Object.keys(config.stages).sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  )
}
