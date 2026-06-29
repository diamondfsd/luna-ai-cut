export interface WebGLSupportResult {
  supported: boolean
  message?: string
}

export function checkWebGLSupport(): WebGLSupportResult {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { alpha: false })
  if (!gl) {
    return { supported: false, message: '当前设备不支持 WebGL2，无法使用工作台' }
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : 'WebGL2'
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { supported: true, message: renderer }
}
