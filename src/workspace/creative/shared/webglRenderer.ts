const VERTEX_SOURCE = `#version 300 es
  in vec2 aPosition;
  out vec2 vUv;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vUv = aPosition * 0.5 + 0.5;
  }
`

const FRAGMENT_SOURCE = `#version 300 es
  precision mediump float;
  uniform sampler2D uTexture;
  uniform highp sampler3D uLut3d;
  uniform bool uUseLut;
  uniform vec2 uImageSize;
  uniform vec2 uCanvasSize;
  uniform float uScale;
  uniform vec2 uOffset;
  in vec2 vUv;
  out vec4 fragColor;

  vec3 applyLut(vec3 color) {
    return texture(uLut3d, clamp(color, 0.0, 1.0)).rgb;
  }

  void main() {
    vec2 uv = vUv;

    // Cover-fill: map canvas UV to image UV, preserve aspect ratio
    float imageAspect = uImageSize.x / uImageSize.y;
    float canvasAspect = uCanvasSize.x / uCanvasSize.y;

    if (imageAspect > canvasAspect) {
      uv.x = (uv.x - 0.5) * (canvasAspect / imageAspect) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (imageAspect / canvasAspect) + 0.5;
    }

    // Zoom from center
    uv = (uv - 0.5) / uScale + 0.5;

    // Pan offset
    float sx = uCanvasSize.x / uImageSize.x;
    float sy = uCanvasSize.y / uImageSize.y;
    float s = max(sx, sy);
    uv -= uOffset / (uImageSize * s);

    vec4 color = texture(uTexture, uv);
    if (uUseLut) color.rgb = applyLut(color.rgb);
    fragColor = color;
  }
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[TripleStitch] Shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[TripleStitch] Program link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  return program
}

export interface CreativeGLState {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  uTextureLoc: WebGLUniformLocation
  uLut3dLoc: WebGLUniformLocation
  uUseLutLoc: WebGLUniformLocation
  uImageSizeLoc: WebGLUniformLocation
  uCanvasSizeLoc: WebGLUniformLocation
  uScaleLoc: WebGLUniformLocation
  uOffsetLoc: WebGLUniformLocation
  texture: WebGLTexture
  lutTexture: WebGLTexture | null
  useLut: boolean
}

export function initCreativeGL(canvas: HTMLCanvasElement): CreativeGLState | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    premultipliedAlpha: false,
    desynchronized: true,
  }) as WebGL2RenderingContext | null

  if (!gl) {
    console.warn('[TripleStitch] WebGL not available')
    return null
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
  if (!vs || !fs) return null

  const program = createProgram(gl, vs, fs)
  if (!program) return null

  const posLoc = gl.getAttribLocation(program, 'aPosition')
  gl.useProgram(program)

  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  const buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  // Image texture
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0)

  const uLut3dLoc = gl.getUniformLocation(program, 'uLut3d')!
  const uUseLutLoc = gl.getUniformLocation(program, 'uUseLut')!
  gl.uniform1i(uLut3dLoc, 1) // LUT on texture unit 1
  gl.uniform1i(uUseLutLoc, 0)

  console.log('[TripleStitch] GL initialized')
  return {
    gl,
    program,
    uTextureLoc: gl.getUniformLocation(program, 'uTexture')!,
    uLut3dLoc,
    uUseLutLoc,
    uImageSizeLoc: gl.getUniformLocation(program, 'uImageSize')!,
    uCanvasSizeLoc: gl.getUniformLocation(program, 'uCanvasSize')!,
    uScaleLoc: gl.getUniformLocation(program, 'uScale')!,
    uOffsetLoc: gl.getUniformLocation(program, 'uOffset')!,
    texture,
    lutTexture: null,
    useLut: false,
  }
}

export function loadCreativeLut(state: CreativeGLState, lutBuffer: ArrayBufferLike, lutSize: number): void {
  const gl = state.gl
  if (state.lutTexture) gl.deleteTexture(state.lutTexture)

  const data = new Float32Array(lutBuffer)
  const rgba = new Uint8Array(lutSize * lutSize * lutSize * 4)
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    rgba[j] = Math.round(Math.max(0, Math.min(1, data[i])) * 255)
    rgba[j + 1] = Math.round(Math.max(0, Math.min(1, data[i + 1])) * 255)
    rgba[j + 2] = Math.round(Math.max(0, Math.min(1, data[i + 2])) * 255)
    rgba[j + 3] = 255
  }

  const tex = gl.createTexture()
  if (!tex) return

  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_3D, tex)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lutSize, lutSize, lutSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)

  const err = gl.getError()
  if (err !== gl.NO_ERROR) {
    console.warn('[TripleStitch] LUT texImage3D failed:', err)
    gl.deleteTexture(tex)
    state.lutTexture = null
    state.useLut = false
    gl.uniform1i(state.uUseLutLoc, 0)
    return
  }

  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  state.lutTexture = tex
  state.useLut = true
  gl.uniform1i(state.uUseLutLoc, 1)
  console.log('[TripleStitch] LUT loaded, size=', lutSize)
}

export function clearCreativeLut(state: CreativeGLState): void {
  if (state.lutTexture) {
    state.gl.deleteTexture(state.lutTexture)
    state.lutTexture = null
  }
  state.useLut = false
  state.gl.uniform1i(state.uUseLutLoc, 0)
}

export function destroyCreativeGL(state: CreativeGLState): void {
  state.gl.deleteTexture(state.texture)
  if (state.lutTexture) state.gl.deleteTexture(state.lutTexture)
  state.gl.deleteProgram(state.program)
  console.log('[TripleStitch] GL destroyed')
}

export function renderCreativeFrame(
  state: CreativeGLState,
  source: TexImageSource,
  imageW: number,
  imageH: number,
  canvasW: number,
  canvasH: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const { gl, program, uImageSizeLoc, uCanvasSizeLoc, uScaleLoc, uOffsetLoc, texture, lutTexture, useLut } = state

  gl.viewport(0, 0, canvasW, canvasH)
  gl.clearColor(0.067, 0.067, 0.067, 1) // #111 background
  gl.clear(gl.COLOR_BUFFER_BIT)

  // Upload source texture (unit 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

  // Bind LUT texture (unit 1)
  if (useLut && lutTexture) {
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, lutTexture)
  }

  gl.useProgram(program)
  gl.uniform2f(uImageSizeLoc, imageW, imageH)
  gl.uniform2f(uCanvasSizeLoc, canvasW, canvasH)
  gl.uniform1f(uScaleLoc, scale)
  gl.uniform2f(uOffsetLoc, offsetX, offsetY)

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}
