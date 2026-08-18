export interface WebGpuLutFile {
  path: string
  text: string
}

interface WebGpuLutApi {
  readLutFile?: (filePath: string) => Promise<WebGpuLutFile>
}

export async function readWebGpuLut(filePath: string): Promise<string> {
  const api = (window as unknown as { lunaRenderCore?: WebGpuLutApi }).lunaRenderCore
  if (!api?.readLutFile) throw new Error('当前应用不支持读取 LUT 文件')
  const result = await api.readLutFile(filePath)
  if (!result || typeof result.text !== 'string') throw new Error(`LUT 文件无效: ${filePath}`)
  return result.text
}
