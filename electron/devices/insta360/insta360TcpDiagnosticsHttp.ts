import { directHttpFetch } from '../common/directHttp'
import type { DiagnosticLogger, Insta360DiagnosticFile, Insta360HttpProbeResult } from './insta360TcpDiagnosticsTypes'

export async function probeInsta360HttpFiles(
  host: string,
  files: Insta360DiagnosticFile[],
  log: DiagnosticLogger,
): Promise<Insta360HttpProbeResult[]> {
  const targets = files.slice(0, 5)
  const results: Insta360HttpProbeResult[] = []
  for (const file of targets) {
    try {
      const response = await directHttpFetch(file.url, { method: 'HEAD', signal: AbortSignal.timeout(2500), timeoutMs: 2500 })
      const result = {
        path: file.path,
        ok: response.ok,
        status: response.status,
        server: response.headers.get('server'),
        contentType: response.headers.get('content-type'),
      }
      results.push(result)
      log(response.ok ? 'INFO' : 'WARN', `[HTTP] HEAD ${file.path}`, result)
    } catch (error) {
      const result = { path: file.path, ok: false, error: error instanceof Error ? error.message : String(error) }
      results.push(result)
      log('WARN', `[HTTP] HEAD ${file.path} failed`, result)
    }
  }
  if (results.length === 0) {
    try {
      const response = await directHttpFetch(`http://${host}/`, { signal: AbortSignal.timeout(2000), timeoutMs: 2000 })
      results.push({
        path: '/',
        ok: response.ok,
        status: response.status,
        server: response.headers.get('server'),
        contentType: response.headers.get('content-type'),
        preview: (await response.text()).slice(0, 300),
      })
    } catch (error) {
      results.push({ path: '/', ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

