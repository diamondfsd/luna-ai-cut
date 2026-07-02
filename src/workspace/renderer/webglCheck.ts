export interface WebGLSupportResult {
  supported: boolean
  message?: string
}

export function checkWebGLSupport(): WebGLSupportResult {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { alpha: false })
  if (!gl) {
    return { supported: false, message: '当前设备不支持工作台预览' }
  }

  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { supported: true }
}
