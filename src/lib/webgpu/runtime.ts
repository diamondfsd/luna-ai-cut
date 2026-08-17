export interface WebGpuRuntimeCapabilities {
  preferredCanvasFormat: GPUTextureFormat
  adapterInfo: {
    vendor: string
    architecture: string
    device: string
    description: string
  }
  features: string[]
  limits: {
    maxTextureDimension1D: number
    maxTextureDimension2D: number
    maxTextureDimension3D: number
    maxBufferSize: number
  }
}

export interface WebGpuRuntimeOptions {
  powerPreference?: GPUPowerPreference
  onDeviceLost?: (message: string, reason: GPUDeviceLostReason) => void
  onUncapturedError?: (message: string, error: GPUError) => void
}

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu)
}

export function webGpuUnavailableMessage(): string {
  if (typeof navigator === 'undefined') return '当前环境无法访问 WebGPU'
  if (!navigator.gpu) return '当前 Electron 环境没有可用的 WebGPU'
  return '没有找到可用的 GPU 适配器'
}

export class WebGpuRuntime {
  readonly adapter: GPUAdapter
  readonly device: GPUDevice
  readonly capabilities: WebGpuRuntimeCapabilities

  private destroyed = false
  private readonly onUncapturedError: (event: Event) => void

  private constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    capabilities: WebGpuRuntimeCapabilities,
    options: WebGpuRuntimeOptions,
  ) {
    this.adapter = adapter
    this.device = device
    this.capabilities = capabilities

    this.onUncapturedError = (event: Event) => {
      const gpuEvent = event as GPUUncapturedErrorEvent
      options.onUncapturedError?.(
        gpuEvent.error.message || 'WebGPU 执行失败',
        gpuEvent.error,
      )
    }
    this.device.addEventListener('uncapturederror', this.onUncapturedError)

    void this.device.lost.then((info) => {
      if (this.destroyed) return
      options.onDeviceLost?.(
        info.message || `WebGPU 设备已丢失（${info.reason}）`,
        info.reason,
      )
    })
  }

  static async create(options: WebGpuRuntimeOptions = {}): Promise<WebGpuRuntime> {
    if (!isWebGpuAvailable()) throw new Error(webGpuUnavailableMessage())

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: options.powerPreference ?? 'high-performance',
    })
    if (!adapter) throw new Error(webGpuUnavailableMessage())

    let device: GPUDevice
    try {
      device = await adapter.requestDevice()
    } catch (error) {
      throw new Error(`无法创建 WebGPU 设备：${formatWebGpuError(error)}`)
    }

    return new WebGpuRuntime(adapter, device, {
      preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat(),
      adapterInfo: adapterInfoFor(adapter),
      features: Array.from(adapter.features, String),
      limits: {
        maxTextureDimension1D: device.limits.maxTextureDimension1D,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        maxTextureDimension3D: device.limits.maxTextureDimension3D,
        maxBufferSize: device.limits.maxBufferSize,
      },
    }, options)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.device.removeEventListener('uncapturederror', this.onUncapturedError)
    this.device.destroy()
  }
}

function adapterInfoFor(adapter: GPUAdapter): WebGpuRuntimeCapabilities['adapterInfo'] {
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info
  return {
    vendor: info?.vendor ?? '',
    architecture: info?.architecture ?? '',
    device: info?.device ?? '',
    description: info?.description ?? '',
  }
}

export function formatWebGpuError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? error)
  }
  return String(error)
}
