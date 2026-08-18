import { stageOrder } from './config.js'
import { isStale } from './state.js'

export const MAX_ATTEMPTS = 3

export function nextStage(featureDir, config, state) {
  for (const id of stageOrder(config)) {
    const stage = config.stages[id]
    if (!stage.enabled) continue
    const st = state.stages?.[id] ?? { status: 'pending', attempts: 0 }

    if (st.status === 'blocked') {
      return { stage: id, action: 'blocked', reason: `đã thử ${st.attempts}/${MAX_ATTEMPTS} lần, cần người gỡ (pp unblock ${id})` }
    }
    if (st.status === 'done') {
      if (isStale(featureDir, config, state, id)) {
        return { stage: id, action: 'regate', reason: 'input thượng nguồn đã đổi — phải chạy lại gate' }
      }
      if (stage.human && st.human !== 'approved') {
        return { stage: id, action: 'await-human', reason: `gate xanh, chờ duyệt: pp approve ${id}` }
      }
      continue
    }
    if (st.status === 'failed') {
      if ((st.attempts ?? 0) >= MAX_ATTEMPTS) {
        return { stage: id, action: 'blocked', reason: `đã thử ${st.attempts}/${MAX_ATTEMPTS} lần, cần người gỡ (pp unblock ${id})` }
      }
      return { stage: id, action: 'retry', reason: `gate đỏ, lần thử ${st.attempts ?? 0}/${MAX_ATTEMPTS}` }
    }
    return { stage: id, action: 'run', reason: 'chưa chạy' }
  }
  return { stage: null, action: 'complete', reason: 'mọi stage đã bật đều done và được duyệt' }
}
