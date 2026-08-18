// Parser dùng chung cho mọi lệnh: tách flag (--foo, --foo giá-trị) khỏi
// positional args, để không còn kiểu `args.find(a => !a.startsWith('--'))`
// nhặt nhầm giá trị của flag làm positional khi flag đứng trước.
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok.startsWith('--')) {
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
