import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TOKEN = 'phc_mFKe7j96gzrDmRZM9prkHRWzDXVsNU9hnHYruVBJTQDy'
const ENDPOINT = 'https://eu.i.posthog.com/i/v0/e/'
const PAGE_NAMES: Record<string, string> = {
  '/library': '相机素材',
  '/local-resources': '本地素材',
  '/ai-selection': 'AI 选片',
  '/workspace': '编辑',
  '/settings': '设置',
}

interface UsageOptions {
  enabled: boolean
  userData: string
  appVersion: string
  osName: string
  osVersion: string
  arch: string
  environment: 'development' | 'production'
  send?: typeof fetch
}

export function createUsageAnalytics(options: UsageOptions) {
  let identity: Promise<string> | undefined
  let started = false
  let lastPage: string | undefined
  let pending = 0

  async function loadIdentity(): Promise<string> {
    const file = join(options.userData, 'usage-id')
    try {
      const id = (await readFile(file, 'utf8')).trim()
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Invalid usage identity')
      }
      return id
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(options.userData, { recursive: true })
      const id = randomUUID()
      await writeFile(file, id, { flag: 'wx', mode: 0o600 })
      return id
    }
  }

  async function capture(event: string, page?: string): Promise<void> {
    if (!options.enabled || pending >= 8) return
    pending += 1
    const timestamp = new Date().toISOString()
    try {
      identity ??= loadIdentity()
      const distinctId = await identity
      await (options.send ?? fetch)(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          api_key: TOKEN,
          event,
          timestamp,
          uuid: randomUUID(),
          properties: {
            distinct_id: distinctId,
            app_version: options.appVersion,
            os_name: options.osName,
            os_version: options.osVersion,
            arch: options.arch,
            environment: options.environment,
            $geoip_disable: true,
            $process_person_profile: false,
            ...(page ? { page_name: page } : {}),
          },
        }),
      })
    } catch {
      // Statistics must never interrupt startup or navigation; no offline backlog.
    } finally {
      pending -= 1
    }
  }

  return {
    opened(): Promise<void> {
      if (started) return Promise.resolve()
      started = true
      return capture('app_opened')
    },
    pageOpened(path: unknown): Promise<void> {
      if (typeof path !== 'string' || !Object.prototype.hasOwnProperty.call(PAGE_NAMES, path)) return Promise.resolve()
      if (lastPage === path) return Promise.resolve()
      lastPage = path
      return capture('page_opened', PAGE_NAMES[path])
    },
  }
}
