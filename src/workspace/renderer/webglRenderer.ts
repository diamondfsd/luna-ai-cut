import type { EditPipeline } from '../shared/editPipeline'
import fragmentSource from './shaders/pipeline.glsl?raw'
import vertexSource from './shaders/vertex.glsl?raw'

type UniformName =
  | 'u_texture'
  | 'u_resolution'
  | 'u_aspectRatio'
  | 'u_crop'
  | 'u_rotate'
  | 'u_flip'
  | 'u_scale'
  | 'u_exposure'
  | 'u_contrast'
  | 'u_saturation'
  | 'u_vibrance'
  | 'u_temperature'
  | 'u_tint'
  | 'u_highlights'
  | 'u_shadows'
  | 'u_whites'
  | 'u_blacks'
  | 'u_clarity'
  | 'u_dehaze'
  | 'u_sharpen'
  | 'u_vignette'

const UNIFORM_NAMES: UniformName[] = [
  'u_texture',
  'u_resolution',
  'u_aspectRatio',
  'u_crop',
  'u_rotate',
  'u_flip',
  'u_scale',
  'u_exposure',
  'u_contrast',
  'u_saturation',
  'u_vibrance',
  'u_temperature',
  'u_tint',
  'u_highlights',
  'u_shadows',
  'u_whites',
  'u_blacks',
  'u_clarity',
  'u_dehaze',
  'u_sharpen',
  'u_vignette',
]

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly uniforms = new Map<UniformName, WebGLUniformLocation>()
  private texture: WebGLTexture | null = null
  private sourceSize = { width: 1, height: 1 }

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })
    if (!gl) throw new Error('当前设备不支持 WebGL2')

    this.canvas = canvas
    this.gl = gl
    this.program = this.buildProgram()
    this.initGeometry()
    gl.useProgram(this.program)
    for (const name of UNIFORM_NAMES) {
      const location = gl.getUniformLocation(this.program, name)
      if (location) this.uniforms.set(name, location)
    }
    gl.uniform1i(this.uniform('u_texture'), 0)
  }

  loadImage(bitmap: ImageBitmap): void {
    const gl = this.gl
    this.sourceSize = { width: bitmap.width, height: bitmap.height }
    if (!this.texture) this.texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1
    const nextWidth = Math.max(1, Math.round(width * dpr))
    const nextHeight = Math.max(1, Math.round(height * dpr))
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth
      this.canvas.height = nextHeight
    }
    this.gl.viewport(0, 0, nextWidth, nextHeight)
  }

  render(pipeline: EditPipeline): void {
    if (!this.texture) return
    const gl = this.gl
    gl.useProgram(this.program)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    this.updateUniforms(pipeline)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy(): void {
    if (this.texture) this.gl.deleteTexture(this.texture)
    this.gl.deleteProgram(this.program)
  }

  getDisplayRect(): { x: number; y: number; width: number; height: number } {
    const canvasWidth = Math.max(1, this.canvas.clientWidth)
    const canvasHeight = Math.max(1, this.canvas.clientHeight)
    const imageAspect = Math.max(1, this.sourceSize.width) / Math.max(1, this.sourceSize.height)
    const canvasAspect = canvasWidth / canvasHeight
    if (canvasAspect > imageAspect) {
      const width = canvasHeight * imageAspect
      return { x: (canvasWidth - width) / 2, y: 0, width, height: canvasHeight }
    }
    const height = canvasWidth / imageAspect
    return { x: 0, y: (canvasHeight - height) / 2, width: canvasWidth, height }
  }

  private updateUniforms(pipeline: EditPipeline): void {
    const gl = this.gl
    const crop = pipeline.transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    gl.uniform2f(this.uniform('u_resolution'), this.sourceSize.width, this.sourceSize.height)
    const canvasAspect = Math.max(1, this.canvas.width) / Math.max(1, this.canvas.height)
    const imageAspect = Math.max(1, this.sourceSize.width) / Math.max(1, this.sourceSize.height)
    gl.uniform2f(this.uniform('u_aspectRatio'), imageAspect, canvasAspect)
    gl.uniform4f(this.uniform('u_crop'), crop.x, crop.y, crop.w, crop.h)
    gl.uniform1f(this.uniform('u_rotate'), pipeline.transform.rotate)
    gl.uniform2f(this.uniform('u_flip'), pipeline.transform.flipH ? 1 : 0, pipeline.transform.flipV ? 1 : 0)
    gl.uniform1f(this.uniform('u_scale'), pipeline.transform.scale)
    gl.uniform1f(this.uniform('u_exposure'), pipeline.color.exposure)
    gl.uniform1f(this.uniform('u_contrast'), pipeline.color.contrast / 100)
    gl.uniform1f(this.uniform('u_saturation'), pipeline.color.saturation / 100)
    gl.uniform1f(this.uniform('u_vibrance'), pipeline.color.vibrance / 100)
    gl.uniform1f(this.uniform('u_temperature'), pipeline.color.temperature / 100)
    gl.uniform1f(this.uniform('u_tint'), pipeline.color.tint / 100)
    gl.uniform1f(this.uniform('u_highlights'), pipeline.color.highlights / 100)
    gl.uniform1f(this.uniform('u_shadows'), pipeline.color.shadows / 100)
    gl.uniform1f(this.uniform('u_whites'), pipeline.color.whites / 100)
    gl.uniform1f(this.uniform('u_blacks'), pipeline.color.blacks / 100)
    gl.uniform1f(this.uniform('u_clarity'), pipeline.color.clarity / 100)
    gl.uniform1f(this.uniform('u_dehaze'), pipeline.color.dehaze / 100)
    gl.uniform1f(this.uniform('u_sharpen'), pipeline.effects.sharpen / 100)
    gl.uniform1f(this.uniform('u_vignette'), pipeline.effects.vignette / 100)
  }

  private initGeometry(): void {
    const gl = this.gl
    const vertices = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1,
    ])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const stride = 4 * Float32Array.BYTES_PER_ELEMENT
    const position = gl.getAttribLocation(this.program, 'a_position')
    const texCoord = gl.getAttribLocation(this.program, 'a_texCoord')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(texCoord)
    gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT)
  }

  private buildProgram(): WebGLProgram {
    const gl = this.gl
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource)
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建 WebGL program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program link failed')
    }
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return program
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) throw new Error('无法创建 WebGL shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'WebGL shader compile failed')
    }
    return shader
  }

  private uniform(name: UniformName): WebGLUniformLocation {
    const location = this.uniforms.get(name)
    if (!location) throw new Error(`WebGL uniform not found: ${name}`)
    return location
  }
}
