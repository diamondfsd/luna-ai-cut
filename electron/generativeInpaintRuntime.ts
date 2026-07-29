import type { WorkspaceGenerativeRemovalCapability } from '../src/shared/types'

export function selectGenerativeGpuDevice(
  output: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Pick<WorkspaceGenerativeRemovalCapability, 'backend' | 'deviceName'> | null {
  if (platform === 'darwin' && arch === 'arm64') {
    const match = output.match(/^MTL\d+\t(.+)$/m)
    return match ? { backend: 'metal', deviceName: match[1].trim() } : null
  }
  if (platform === 'win32') {
    const match = output.match(/^(CUDA\d+)\t(.+)$/mi)
    if (match && /NVIDIA/i.test(match[2])) return { backend: 'cuda', deviceName: match[2].trim() }
  }
  return null
}

export function verifyGpuOnlyGenerativeLog(log: string, backend: string): void {
  const escaped = backend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`Initializing backend: ${escaped}`, 'i').test(log)
    || !/offload_params_to_cpu:\s*false/i.test(log)
    || !/total params memory size[^\n]*RAM 0\.00MB/i.test(log)
    || /Initializing backend:\s*CPU/i.test(log)) {
    throw new Error('生成式重建未能完全使用显卡，已停止处理')
  }
}
