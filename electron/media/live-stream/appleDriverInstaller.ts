import type { AppleDriverDownloadStatus } from '../../../src/shared/types'
import type { DownloadDefinition, DownloadOptions } from '../resumableDownloadService'

interface AppleDriverInstallerDependencies {
  platform: string
  arch: string
  definition: DownloadDefinition
  destinationDir: () => string
  download: (directory: string, definition: DownloadDefinition, options: DownloadOptions) => Promise<string>
  verifySignature: (filePath: string) => Promise<void>
  openInstaller: (filePath: string) => Promise<string>
  onError?: (error: unknown) => void
}

export class AppleDriverInstaller {
  private operation: Promise<void> | null = null
  private controller: AbortController | null = null
  private progress: AppleDriverDownloadStatus
  private readonly dependencies: AppleDriverInstallerDependencies

  constructor(dependencies: AppleDriverInstallerDependencies) {
    this.dependencies = dependencies
    this.progress = { state: 'idle', completedBytes: 0, totalBytes: dependencies.definition.sizeBytes }
  }

  status(): AppleDriverDownloadStatus {
    return { ...this.progress }
  }

  cancel(): void {
    this.controller?.abort()
  }

  install(): Promise<void> {
    if (this.operation) return this.operation
    if (this.dependencies.platform !== 'win32' || this.dependencies.arch !== 'x64') {
      return Promise.reject(new Error('当前系统不支持安装此驱动'))
    }
    const controller = new AbortController()
    this.controller = controller
    const signal = controller.signal
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 10 * 60_000)
    timeout.unref()
    this.progress = { ...this.progress, state: 'downloading', completedBytes: 0 }
    const task = Promise.resolve().then(async () => {
      signal.throwIfAborted()
      const filePath = await this.dependencies.download(
        this.dependencies.destinationDir(), this.dependencies.definition, {
          signal, label: '驱动', maxBytes: this.dependencies.definition.sizeBytes,
          onProgress: ({ completedBytes, totalBytes }) => {
            if (!signal.aborted) this.progress = { state: 'downloading', completedBytes, totalBytes }
          },
        },
      )
      signal.throwIfAborted()
      this.progress = { ...this.progress, state: 'verifying' }
      await this.dependencies.verifySignature(filePath)
      signal.throwIfAborted()
      this.progress = { ...this.progress, state: 'opening' }
      const error = await this.dependencies.openInstaller(filePath)
      if (error) throw new Error('无法打开安装程序，请重试')
      this.progress = { ...this.progress, state: 'opened' }
    }).catch((error: unknown) => {
      const phase = this.progress.state
      this.progress = { ...this.progress, state: 'error' }
      this.dependencies.onError?.(error)
      if (timedOut) throw new Error('驱动下载超时，请重试')
      if (signal.aborted) throw new Error('下载已取消')
      if (phase === 'verifying') throw new Error('驱动验证失败，请重新下载')
      if (phase === 'opening') throw new Error('无法打开安装程序，请重试')
      throw new Error('驱动下载失败，请重试')
    }).finally(() => {
      clearTimeout(timeout)
      this.operation = null
      this.controller = null
    })
    this.operation = task
    return task
  }
}
