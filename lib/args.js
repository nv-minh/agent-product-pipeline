// Parser dùng chung cho mọi lệnh: tách flag (--foo, --foo giá-trị) khỏi
// positional args, để không còn kiểu `args.find(a => !a.startsWith('--'))`
// nhặt nhầm giá trị của flag làm positional khi flag đứng trước.
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok.startsWith('--')) {
      // FINDING (review 8c825c9..44c1ecb): dạng `--k=v` TỪNG tạo key "k=v" và
      // để `flags.k` undefined, nên mọi flag có default im lặng bị đoán thay:
      // `--type=bugfix` chạy pipeline feature, `--from=x` mất liên kết,
      // `--tier=t2` chạy T1, `--root=/khác` ghi vào repo khác — tất cả exit 0.
      // Tách ở dấu `=` ĐẦU TIÊN: `--reason=vì a=b` giữ nguyên phần giá trị.
      const eq = tok.indexOf('=')
      if (eq > 2) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1)
        continue
      }
      const key = tok.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(tok)
    }
  }
  return { positional, flags }
}
