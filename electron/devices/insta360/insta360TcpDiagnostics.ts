import { extractAsciiStrings, parseDeviceInfo } from './insta360DeviceInfo'
import { diagnosticAscii, diagnosticHex, type Insta360MessageResponse } from './insta360TcpDiagnosticsCodec'
import { probeInsta360HttpFiles } from './insta360TcpDiagnosticsHttp'
import { connectDiagnosticSocket, Insta360DiagnosticTcpSession } from './insta360TcpDiagnosticsSession'
import { fileListBody } from './insta360TcpFileList'
import type { Insta360RawResponse } from './insta360TcpCodec'
import type {
  DiagnosticLogger,
  Insta360AuthProbe,
  Insta360DiagnosticFile,
  Insta360DiagnosticsOptions,
  Insta360DiagnosticsResult,
  Insta360TcpCommandResult,
} from './insta360TcpDiagnosticsTypes'

export type {
  DiagnosticLevel,
  DiagnosticLogger,
  Insta360AuthProbe,
  Insta360DiagnosticFile,
  Insta360DiagnosticsOptions,
  Insta360DiagnosticsResult,
  Insta360HttpProbeResult,
  Insta360TcpCommandResult,
} from './insta360TcpDiagnosticsTypes'

const CODE_GET_OPTIONS = 8
const CODE_GET_FILE_LIST = 13
const CODE_CHECK_AUTHORIZATION = 39
const CODE_REQUEST_AUTHORIZATION = 86
const CODE_PHONE_INFO = 220
const STATUS_OK = 200
const FILE_LIST_PAGE_SIZE = 50
const FILE_LIST_MAX_OFFSET = 5000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tcpHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return host.split(':')[0] || host
  }
}

function getOptionsSmallBody(): Buffer {
  return Buffer.concat([Buffer.from([0x08, 0x30, 0x08, 0x0f, 0x08, 0x0b])])
}

function getOptionsLargeBody(): Buffer {
  return Buffer.from(`
    08 01 08 03 08 02 08 4c 08 06 08 4e 08 4f 08 0b 08 55 08 0c
    08 0d 08 af 01 08 0e 08 0f 08 13 08 37 08 11 08 14 08 1e
    08 24 08 6e 08 72 08 75 08 59 08 74 08 73 08 25 08 26
    08 2a 08 28 08 29 08 30 08 31 08 32 08 42 08 84 01 08
    3a 08 3b 08 3c 08 43 08 44 08 5d 08 53 08 52 08 46 08
    58 08 67 08 10 08 61 08 85 01 08 86 01 08 77 08 7a 08
    7b 08 7c 08 80 01 08 81 01 08 87 01 08 96 01 08 95 01
    08 93 01 08 9b 01 08 9d 01 08 9e 01 08 a0 01 08 b3 01
    08 a1 01 08 16 08 50 08 51 08 a7 01 08 a9 01 08 ad 01
    08 b4 01 08 b0 01 08 b1 01 08 78 08 6f 08 79 08 ac 01
  `.replace(/\s+/g, ''), 'hex')
}

function commandResult(label: string, response: Insta360RawResponse): Insta360TcpCommandResult {
  return {
    label,
    ok: response.code === STATUS_OK,
    code: response.code,
    requestId: response.requestId,
    bodyBytes: response.body.length,
    trailer: diagnosticHex(response.trailer),
    ascii: extractAsciiStrings(response.body).join(' | ').slice(0, 800),
  }
}

function parsePathList(body: Buffer): string[] {
  const text = body.toString('latin1')
  const paths = new Set<string>()
  // eslint-disable-next-line no-control-regex
  for (const match of text.matchAll(/\/(?:storage_internal|sdcard|DCIM)[^\x00\n\r"'<>\s]+?\.(?:mp4|mov|lrv|jpg|jpeg|dng|insp|png|webp)/gi)) {
    paths.add(match[0])
  }
  return [...paths]
}

function pathToFile(host: string, filePath: string): Insta360DiagnosticFile {
  const name = decodeURIComponent(filePath.split('/').filter(Boolean).pop() ?? filePath)
  return { name, path: filePath, url: `http://${host}${filePath}`, size: null }
}

function inferAuth(message: Insta360MessageResponse | null): Insta360AuthProbe | null {
  if (!message) return null
  const bodyHex = diagnosticHex(message.body)
  const bodyAscii = diagnosticAscii(message.body)
  const bodyHasZero = message.body.includes(0x00)
  const bodyHasOne = message.body.includes(0x01)
  const authorized = message.body.length === 0 ? null : bodyHasOne && !bodyHasZero ? true : bodyHasZero ? false : null
  return {
    authorized,
    needsConfirm: authorized === false,
    message: authorized === true ? '已授权' : authorized === false ? '需要相机确认或尚未授权' : '授权响应未明确',
    requestId: message.requestId,
    messageCode: message.messageCode,
    bodyHex,
    bodyAscii,
  }
}

async function runTcp(
  host: string,
  port: number,
  log: DiagnosticLogger,
  options: Insta360DiagnosticsOptions,
): Promise<{ tcp: Insta360TcpCommandResult[]; info: Insta360RawResponse[]; auth: Insta360AuthProbe | null; files: Insta360DiagnosticFile[] }> {
  const socket = await connectDiagnosticSocket(tcpHost(host), port, 2000)
  const session = new Insta360DiagnosticTcpSession(socket, log)
  const tcp: Insta360TcpCommandResult[] = []
  const info: Insta360RawResponse[] = []
  const files = new Map<string, Insta360DiagnosticFile>()
  let auth: Insta360AuthProbe | null = null
  try {
    session.sendHello()
    await delay(500)

    if (!options.fileListOnly) {
      try {
        const message = await session.sendMessage('MSG CHECK_AUTHORIZATION', CODE_CHECK_AUTHORIZATION, Buffer.alloc(0), 2500)
        auth = inferAuth(message)
        tcp.push({ label: 'MSG CHECK_AUTHORIZATION', ok: true, requestId: message.requestId, bodyBytes: message.body.length, ascii: auth?.message })
      } catch (error) {
        tcp.push({ label: 'MSG CHECK_AUTHORIZATION', ok: false, error: error instanceof Error ? error.message : String(error) })
      }

      if (options.requestAuthorization) {
        session.notifyMessage('MSG PHONE_INFO notify before authorization', CODE_PHONE_INFO)
        try {
          const message = await session.sendMessage('MSG REQUEST_AUTHORIZATION', CODE_REQUEST_AUTHORIZATION, Buffer.alloc(0), 30000)
          auth = inferAuth(message) ?? auth
          tcp.push({ label: 'MSG REQUEST_AUTHORIZATION', ok: true, requestId: message.requestId, bodyBytes: message.body.length, ascii: auth?.message })
        } catch (error) {
          tcp.push({ label: 'MSG REQUEST_AUTHORIZATION', ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    if (!options.authOnly && !options.fileListOnly) {
      for (const command of [
        { label: 'GET_OPTIONS small', body: getOptionsSmallBody() },
        { label: 'GET_OPTIONS large', body: getOptionsLargeBody() },
      ]) {
        try {
          const response = await session.sendFile(command.label, CODE_GET_OPTIONS, command.body, 5000)
          tcp.push(commandResult(command.label, response))
          info.push(response)
        } catch (error) {
          tcp.push({ label: command.label, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    if (!options.authOnly) {
      for (const selector of [2, 3]) {
        for (let offset = 0; offset <= FILE_LIST_MAX_OFFSET; offset += FILE_LIST_PAGE_SIZE) {
          const label = `GET_FILE_LIST selector=${selector} offset=${offset}`
          try {
            const response = await session.sendFile(label, CODE_GET_FILE_LIST, fileListBody(selector, offset), 8000)
            tcp.push(commandResult(label, response))
            const paths = parsePathList(response.body)
            for (const filePath of paths) files.set(filePath, pathToFile(host, filePath))
            if (paths.length < FILE_LIST_PAGE_SIZE) break
          } catch (error) {
            tcp.push({ label, ok: false, error: error instanceof Error ? error.message : String(error) })
            break
          }
          await delay(30)
        }
      }
    }
  } finally {
    session.close()
  }
  return { tcp, info, auth, files: [...files.values()] }
}

export async function runInsta360TcpDiagnostics(
  host: string,
  port: number,
  log: DiagnosticLogger,
  options: Insta360DiagnosticsOptions = {},
): Promise<Insta360DiagnosticsResult> {
  log('INFO', '========== Insta360 协议诊断开始 ==========', { host, port, options })
  const tcpResults: Insta360TcpCommandResult[] = []
  let infoResponses: Insta360RawResponse[] = []
  let auth: Insta360AuthProbe | null = null
  let files: Insta360DiagnosticFile[] = []

  try {
    const result = await runTcp(host, port, log, options)
    tcpResults.push(...result.tcp)
    infoResponses = result.info
    auth = result.auth
    files = result.files
  } catch (error) {
    tcpResults.push({ label: 'TCP connect/session', ok: false, error: error instanceof Error ? error.message : String(error) })
    log('ERROR', '[TCP] diagnostic failed', { error: error instanceof Error ? error.message : String(error) })
  }

  const http = options.authOnly ? [] : await probeInsta360HttpFiles(host, files, log)
  const deviceInfo = parseDeviceInfo(infoResponses)
  const httpOk = http.some((item) => item.ok)
  const tcpOk = tcpResults.some((item) => item.ok)
  const summary = `TCP ${tcpOk ? '有有效响应' : '无有效响应'}；授权 ${auth?.message ?? '未确认'}；文件 ${files.length} 个；HTTP ${http.length === 0 ? '未探测' : httpOk ? '可访问' : '不可访问'}；设备 ${deviceInfo?.deviceName ?? '未解析'}`
  log('INFO', `========== Insta360 协议诊断结束：${summary} ==========`)
  return { success: tcpOk || httpOk, host, port, http, tcp: tcpResults, auth, files, deviceInfo, summary }
}
