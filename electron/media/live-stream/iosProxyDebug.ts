import { spawn, type ChildProcess } from 'node:child_process'

/** Capture both streams: iproxy can report errors on stdout as well as stderr. */
export function startDebugProxy(binary: string, port: number, phonePort: number, phoneId: string) {
  const child = spawn(binary, ['-u', phoneId, `${port}:${phonePort}`], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = ''
  const append = (chunk: Buffer | string) => {
    output = (output + String(chunk)).slice(-4_000)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  return {
    child,
    async failureDetail(): Promise<string> {
      // exit may precede the final data event; close is emitted after streams close.
      if (child.exitCode !== null || child.signalCode !== null) await closed
      const status = child.signalCode ? `信号 ${child.signalCode}` : `退出码 ${child.exitCode ?? '未知'}`
      const detail = output.trim().split(phoneId).join('[手机标识]').split(binary).join('[连接工具]')
      return `iproxy 已退出（${status}）${detail ? `：${detail}` : '，没有输出错误信息'}`
    },
  }
}

export type DebugProxy = { child: ChildProcess; failureDetail(): Promise<string> }
