import { getTimelineCodingSession } from './coding-workspace/session-registry'

export interface WorkspaceCommandResult {
  argv: string[]
  stdout: string
  exitCode: number
}

function commandError(message: string): never {
  throw new Error(`命令不可用：${message}`)
}

function format(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function normalizeDirectoryPath(path: string | undefined): string | undefined {
  if (!path || !path.endsWith('/')) return path
  return path.replace(/\/+$/, '') || path
}

function positionals(args: readonly string[], allowedFlags: ReadonlySet<string>): string[] {
  const values: string[] = []
  let optionsEnded = false
  for (const arg of args) {
    if (!optionsEnded && arg === '--') {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && arg.startsWith('-')) {
      if (!allowedFlags.has(arg)) commandError(`不支持参数 ${arg}`)
      continue
    }
    values.push(arg)
  }
  return values
}

function runList(args: readonly string[]): string {
  const recursive = args.includes('-R') || args.includes('--recursive')
  const paths = positionals(args, new Set(['-R', '--recursive', '-a', '-l', '-la', '-al']))
  if (paths.length > 1) commandError('ls 最多接收一个目录')
  const result = getTimelineCodingSession().workspace.list({
    path: normalizeDirectoryPath(paths[0]),
    recursive,
    limit: 200,
  })
  const lines = result.entries.map((entry) =>
    `${entry.type === 'directory' ? 'd' : '-'}\t${entry.path}${entry.size === undefined ? '' : `\t${entry.size}`}`,
  )
  if (result.nextCursor !== undefined) lines.push(`... 结果未完全显示，下一位置 ${result.nextCursor}`)
  return lines.join('\n')
}

function runSearch(args: readonly string[]): string {
  const caseSensitive = !args.includes('-i') && !args.includes('--ignore-case')
  const values = positionals(
    args,
    new Set(['-n', '--line-number', '-i', '--ignore-case', '-F', '--fixed-strings']),
  )
  if (values.length < 1 || values.length > 2) commandError('rg 需要查询文字，可选一个目录')
  const result = getTimelineCodingSession().workspace.search({
    query: values[0]!,
    path: normalizeDirectoryPath(values[1]),
    caseSensitive,
    limit: 200,
  })
  const lines = result.matches.map((match) =>
    `${match.path}:${match.line}:${match.column}:${match.preview}`,
  )
  if (result.nextCursor !== undefined) lines.push(`... 结果未完全显示，下一位置 ${result.nextCursor}`)
  return lines.join('\n')
}

function runRead(args: readonly string[]): string {
  const values = positionals(args, new Set(['-n']))
  if (values.length !== 2) commandError('sed 用法为 sed -n 开始行,结束行p 文件')
  const range = /^(\d+)(?:,(\d+))?p$/.exec(values[0]!)
  if (!range) commandError('sed 只支持按行读取，例如 1,200p')
  const start = Number(range[1])
  const end = Number(range[2] ?? range[1])
  if (start < 1 || end < start || end - start + 1 > 400) commandError('sed 每次最多读取 400 行')
  const lines = getTimelineCodingSession().workspace.read(values[1]!).content.split('\n')
  return lines.slice(start - 1, end).join('\n')
}

function runCount(args: readonly string[]): string {
  const lineMode = args.includes('-l')
  const wordMode = args.includes('-w')
  const byteMode = args.includes('-c')
  const paths = positionals(args, new Set(['-l', '-w', '-c']))
  if (paths.length !== 1) commandError('wc 需要一个文件路径')
  const content = getTimelineCodingSession().workspace.read(paths[0]!).content
  const count = lineMode
    ? content.match(/\n/g)?.length ?? 0
    : wordMode
      ? content.trim().split(/\s+/).filter(Boolean).length
      : byteMode
        ? new TextEncoder().encode(content).length
        : content.length
  return `${count}\t${paths[0]}`
}

function gitLogLimit(args: readonly string[]): number {
  let limit = 20
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--oneline') continue
    if (arg === '-n') {
      limit = Number(args[index + 1])
      index += 1
      continue
    }
    const match = /^--max-count=(\d+)$/.exec(arg)
    if (match) {
      limit = Number(match[1])
      continue
    }
    commandError(`git log 不支持参数 ${arg}`)
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) commandError('git log 数量无效')
  return limit
}

async function runGit(args: readonly string[]): Promise<string> {
  const [subcommand, ...rest] = args
  const repository = getTimelineCodingSession().repository
  if (subcommand === 'status') {
    if (positionals(rest, new Set(['--short', '-s'])).length > 0) {
      commandError('git status 当前不接收路径参数')
    }
    return format(await repository.status())
  }
  if (subcommand === 'diff') {
    if (rest.length > 0) commandError('git diff 当前不接收额外参数')
    return format(await repository.diff())
  }
  if (subcommand === 'log') return format(await repository.log(gitLogLimit(rest)))
  if (subcommand === 'branch') {
    if (rest.length > 0) commandError('git branch 只支持查看分支')
    return format(await repository.branches())
  }
  commandError('git 只支持 status、diff、log 和 branch 查询')
}

export async function executeWorkspaceCommand(argv: readonly string[]): Promise<WorkspaceCommandResult> {
  if (argv.length === 0 || argv.length > 20) commandError('参数数量无效')
  if (argv.some((arg) => !arg || arg.length > 512 || /[\0\r\n]/.test(arg))) {
    commandError('参数内容无效')
  }
  const [command, ...args] = argv
  let stdout: string
  if (command === 'ls') stdout = runList(args)
  else if (command === 'rg') stdout = runSearch(args)
  else if (command === 'sed') stdout = runRead(args)
  else if (command === 'wc') stdout = runCount(args)
  else if (command === 'git') stdout = await runGit(args)
  else commandError('只支持 ls、rg、sed、wc 和 git')
  return { argv: [...argv], stdout, exitCode: 0 }
}
