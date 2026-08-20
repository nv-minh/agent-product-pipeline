# Constitution — Product

Nguyên tắc bất di bất dịch. **Mọi artifact trong `features/` kế thừa file này**, và T2 reviewer
chấm artifact **ngược lại** các điều dưới đây. Sửa file này là quyết định có chủ đích, không phải
việc làm tiện tay — mỗi lần sửa ghi lý do vào commit message.

> Trạng thái: **v0 — bản nháp đầu**, rút từ `ORCHESTRATOR_ORCHESTRATOR.md` và `AGENTS.md` hiện có.
> Sẽ được tinh chỉnh ở bước bootstrap (§10.2 của design spec) sau khi chạy feature mồi.

---

## Điều 1 — Đơn giản là ràng buộc, không phải sở thích

Thay đổi nhỏ nhất thoả mãn yêu cầu và test. YAGNI triệt để. Tái dùng code sẵn có trước.
Ít file mới nhất, ít lớp nhất. Quy tắc ba lần trước khi trừu tượng hoá.
Cái gì phức tạp hơn mức cần thì **nêu ra, không âm thầm xây**.

Diff bị over-engineer thì bị từ chối — kể cả khi nó chạy đúng.

## Điều 2 — Hoàn thành là dữ kiện, không phải lời khai

Không agent nào được tự tuyên bố xong. Trạng thái `done` chỉ đến từ exit code của gate,
ghi trong `.evidence/`. Không có evidence thì chưa xong.

## Điều 3 — Neo vào code thật

Mọi artifact khi nhắc tới file, endpoint, entity phải trích dẫn đường dẫn **có thật** trong repo.
Không suy đoán độ phức tạp — đọc code rồi hãy viết. Đường dẫn không tồn tại là lỗi, không phải sơ suất.

## Điều 4 — Contract đi trước

Mọi thay đổi endpoint / schema / status code phải chốt contract trước khi code.
Thứ tự bắt buộc: chốt contract → backend (producer) → backend compile ổn định →
frontend regenerate SDK (`yarn sdk:generate`) → frontend code.
Frontend **không bao giờ** tự gõ tay kiểu API — chỉ dùng client sinh ra trong `src/libs/sdk`.

## Điều 5 — Ranh giới repo là tuyệt đối

BE-Worker không sửa `web-repo/`. FE-Worker không sửa `backend-repo/`.
Không thực thể nào ngoài `bin/pp` ghi vào `STATE.md` hoặc `.evidence/`.
Việc cắt ngang hai repo phải tách thành một task BE và một task FE riêng biệt.

## Điều 6 — Acceptance criteria viết bằng EARS

Mỗi AC là **một** câu `SHALL`, một hành vi:

```
WHEN  <sự kiện>            THE SYSTEM SHALL <hành vi>
WHILE <trạng thái>         THE SYSTEM SHALL <hành vi>
IF    <điều kiện>          THE SYSTEM SHALL <hành vi>
                           THE SYSTEM SHALL <năng lực>
```

Hai chữ `SHALL` trong một AC nghĩa là AC bị gộp — phải tách. AC không kiểm được thì không phải AC.

## Điều 7 — Test có trước code

`40-testplan` hoàn tất trước `60-dev`. Code chỉ cần làm test xanh, không hơn.
Mọi AC phải có ít nhất một case thuận và một case nghịch.

## Điều 8 — Định nghĩa hoàn thành theo repo

- `backend-repo`: `yarn lint` sạch · `yarn build` pass · `*.spec.ts` liên quan xanh
- `web-repo`: `yarn lint` sạch · `yarn build` pass · vitest xanh
- Commit theo Conventional Commits `type(scope): description`
  (FE ép bằng `.husky/commit-msg`; BE và repo này không có hook — tự giữ kỷ luật)

## Điều 9 — Con người quyết đúng hai chỗ

Human gate sau `10-prd` và sau `30-contract`. Không thêm gate thứ ba mà không có lý do ghi lại.
Đổi lại, con người có nghĩa vụ trả lời câu hỏi ở stage 10 một cách thực chất —
chất lượng PRD bị chặn trên bởi chất lượng câu trả lời đó.

## Điều 10 — Sai thì ghi lại

Mỗi lần gate đỏ, hoặc mỗi lần con người phải sửa tay, ghi một dòng vào `lessons/<stage>.md`.
Một gate bị `override` từ ba lần trở lên nghĩa là **gate đó sai** — sửa luật gate, đừng sửa người.
