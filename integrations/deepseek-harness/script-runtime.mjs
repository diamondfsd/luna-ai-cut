import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeLunaConfig, toLunaEnvironment } from './config.mjs'
import { createLunaSdk, LUNA_SDK_API } from './sdk-client.mjs'

const WORKER_FLAG = '--luna-freecut-script-worker'
const RESULT_PREFIX = 'LUNA_FREECUT_SCRIPT_RESULT:'
const ERROR_PREFIX = 'LUNA_FREECUT_SCRIPT_ERROR:'
const MAX_OUTPUT_LENGTH = 64_000

// Compatibility export retained for scripts and existing host imports.
export const SCRIPT_API = LUNA_SDK_API

function boundedOutput(value) {
  if (value.length <= MAX_OUTPUT_LENGTH) return value
  return `${value.slice(0, MAX_OUTPUT_LENGTH)}\n...[脚本输出已截断]`
}

function parseWorkerPayload(stdout) {
  const lines = stdout.split('\n')
  const resultLine = [...lines].reverse().find((line) => line.startsWith(RESULT_PREFIX))
  const errorLine = [...lines].reverse().find((line) => line.startsWith(ERROR_PREFIX))
  if (resultLine) {
    return { result: JSON.parse(resultLine.slice(RESULT_PREFIX.length)) }
  }
  if (errorLine) {
    const payload = JSON.parse(errorLine.slice(ERROR_PREFIX.length))
    throw new Error(payload.message || '剪辑脚本执行失败。')
  }
  return undefined
}

function abortError() {
  const error = new Error('剪辑脚本已取消。')
  error.name = 'AbortError'
  return error
}

async function terminate(child) {
  if (child.exitCode !== null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5_000)
    child.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill()
  })
}

/**
 * Execute a model-authored editing script in a separate Node.js process.
 *
 * @param {{ endpoint: string, token: string, projectId: string, cwd: string }} config - Host bridge configuration.
 * @param {{ code: string, signal?: AbortSignal }} input - ESM script and cancellation signal.
 * @returns {Promise<{ ok: true, message: string, data: { result: unknown, stdout: string, stderr: string } }>}
 */
export async function runEditScript(config, input) {
  if (!input || typeof input.code !== 'string' || input.code.trim() === '') {
    throw new TypeError('Luna 脚本必须是非空字符串。')
  }
  const resolvedConfig = normalizeLunaConfig(config)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'luna-freecut-script-'))
  try {
    const scriptPath = join(temporaryRoot, 'edit-script.mjs')
    await writeFile(scriptPath, input.code, { encoding: 'utf8', mode: 0o600 })

    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), WORKER_FLAG, scriptPath], {
      cwd: resolvedConfig.cwd,
      env: {
        ...toLunaEnvironment(resolvedConfig),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let abortListener
    const finish = (callback) => {
      if (settled) return
      settled = true
      if (input.signal && abortListener) input.signal.removeEventListener('abort', abortListener)
      callback()
    }

    return await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        stdout = `${stdout}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT_LENGTH * 2)
      })
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT_LENGTH * 2)
      })
      child.once('error', (error) => finish(() => reject(error)))
      child.once('close', (code, signal) => {
        finish(() => {
          if (input.signal?.aborted) {
            reject(abortError())
            return
          }
          try {
            const payload = parseWorkerPayload(stdout)
            if (!payload || code !== 0) {
              throw new Error(`剪辑脚本进程已退出（${String(code ?? signal ?? '未知原因')}）。${stderr.trim()}`)
            }
            resolve({
              ok: true,
              message: '剪辑脚本执行完成。',
              data: {
                result: payload.result,
                stdout: boundedOutput(stdout.replace(`${RESULT_PREFIX}${JSON.stringify(payload.result)}`, '').trim()),
                stderr: boundedOutput(stderr.trim()),
              },
            })
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        })
      })
      abortListener = () => {
        void terminate(child)
      }
      if (input.signal) {
        if (input.signal.aborted) abortListener()
        else input.signal.addEventListener('abort', abortListener, { once: true })
      }
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function runWorker(scriptPath) {
  const config = {
    endpoint: process.env.LUNA_SDK_ENDPOINT ?? process.env.LUNA_SCRIPT_ENDPOINT,
    token: process.env.LUNA_SDK_TOKEN ?? process.env.LUNA_SCRIPT_TOKEN,
    projectId: process.env.LUNA_SDK_PROJECT_ID ?? process.env.LUNA_SCRIPT_PROJECT_ID,
    sessionId: process.env.LUNA_SDK_SESSION_ID ?? process.env.LUNA_SCRIPT_SESSION_ID,
    cwd: process.env.LUNA_SDK_CWD ?? process.env.LUNA_SCRIPT_CWD,
    model: process.env.LUNA_SDK_MODEL ?? process.env.LUNA_SCRIPT_MODEL,
  }
  const resolvedConfig = normalizeLunaConfig(config)
  const module = await import(pathToFileURL(scriptPath).href)
  if (typeof module.default !== 'function') {
    throw new Error('剪辑脚本必须导出 default async function main(luna)。')
  }
  // Existing edit.run_script callers expect the historical { ok, data }
  // envelopes. The underlying transport still keeps the full protocol result;
  // only this compatibility boundary opts into the legacy projection.
  const result = await module.default(createLunaSdk(resolvedConfig, { legacyResults: true }))
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result ?? null)}\n`)
}

if (process.argv[2] === WORKER_FLAG) {
  runWorker(process.argv[3]).catch((error) => {
    process.stderr.write(`${ERROR_PREFIX}${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
    })}\n`)
    process.exitCode = 1
  })
}
