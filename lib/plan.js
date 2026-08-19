import { stageOrder } from './config.js'
import { isStale } from './state.js'
// Vòng import plan ↔ gate là CỐ Ý và an toàn: gate.js chỉ đọc `MAX_ATTEMPTS`
// bên trong thân hàm, còn `stageDone` ở đây cũng chỉ được gọi khi `nextStage`
// chạy — không giá trị nào bị chạm lúc module đang khởi tạo.
import { stageDone } from './gate.js'

export const MAX_ATTEMPTS = 3

export function nextStage(featureDir, config, state) {
  for (const id of stageOrder(config)) {
    const stage = config.stages[id]
    if (!stage.enabled) continue
    const st = state.stages?.[id] ?? { status: 'pending', attempts: 0 }

    if (st.status === 'blocked') {
      // `?? 0` (deferred từ review Task 4): một stage blocked do sửa tay
      // STATE.md có thể không có `attempts` — không được in "đã thử
      // undefined/3 lần".
      return { stage: id, action: 'blocked', reason: `đã thử ${st.attempts ?? 0}/${MAX_ATTEMPTS} lần, cần người gỡ (pp unblock ${id})` }
    }
    // Tier trước đã xanh nhưng stage còn tier chưa chạy (vd. T1 xanh, T2 chưa
    // review). `outstanding` do chính hàm quyết định dùng chung ghi ra —
    // plan.js không tự suy luận lại luật gate.
    if (st.status === 'in_progress') {
      const missing = st.outstanding?.length ? st.outstanding.join(', ') : 'chưa rõ'
      return { stage: id, action: 'run', reason: `gate chưa đủ tier — còn: ${missing}` }
    }
    if (st.status === 'done') {
      if (isStale(featureDir, config, state, id)) {
        return { stage: id, action: 'regate', reason: 'input thượng nguồn đã đổi — phải chạy lại gate' }
      }
      // R4 (review cuối): CHỈ đường ghi mới đọc lại evidence; mọi lệnh chỉ-đọc
      // tin thẳng vào trường `status` trong STATE.md. Kiểm chứng: thêm một dòng
      // `Exit status: 1` vào log T1 của một stage đã done thì `pp status` vẫn
      // báo `await-human` và `pp approve` VẪN THÀNH CÔNG; xoá cả hai log
      // evidence cũng hoàn toàn vô hình. `done` là một KẾT LUẬN, phải suy lại
      // từ dữ kiện mỗi lần đọc chứ không phải một cờ được tin. Hỏi lại đúng
      // hàm quyết định dùng chung (nó tự miễn trừ stage `overridden`), nên
      // `status` và `advance` thừa hưởng luôn.
      const verdict = stageDone(featureDir, config, state, id)
      if (!verdict.done) {
        return {
          stage: id,
          action: 'regate',
          reason: `evidence hiện tại không còn chứng minh stage đã done (còn thiếu tier: ${verdict.outstanding.join(', ')}) — phải chạy lại gate`,
        }
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
