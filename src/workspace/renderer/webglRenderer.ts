import type { EditPipeline } from '../shared/editPipeline'
import { colorLutKey } from '../shared/colorLut'
import { containRect, displayAspectForCrop, frameSize } from '../transform/cropGeometry'
import { fragmentSource, vertexSource } from './shaders/program'

function glLog(msg: string, err?: number): void {
  try { (window as any).luna?.log('error', '[WebGL] ' + msg + (err !== undefined ? ' code=' + err : '')) } catch {}
}

const CROP_MODE_PREVIEW_SCALE = 0.88

const LUT_SIZE = 33

const UNIFORM_NAMES = [
  // Texture / Transform
  'u_image',
  'u_lut3d',
  'u_aspectRatio',
  'u_crop',
  'u_rotate',
  'u_flip',
  'u_scale',
  'u_cropAspect',
  'u_frameSize',
  'u_fillScale',
  // Detail (空间滤镜不烘焙进 LUT)
  'u_texel',
  'u_clarity',
  'u_texture',
  'u_sharpen',
  'u_denoise',
] as const

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly uniforms = new Map<string, WebGLUniformLocation>()
  private texture: WebGLTexture | null = null
  private videoSrc: HTMLVideoElement | null = null
  private sourceSize = { width: 1, height: 1 }
  private displayRect = { x: 0, y: 0, width: 1, height: 1 }
  private lutTexture: WebGLTexture | null = null
  private useLut = false
  private lutKey: string | null = null

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('当前设备不支持工作台预览')

    this.canvas = canvas
    this.gl = gl
    this.program = this.buildProgram()
    this.initGeometry()
    gl.useProgram(this.program)
    for (const name of UNIFORM_NAMES) {
      const location = gl.getUniformLocation(this.program, name)
      if (location) this.uniforms.set(name, location)
    }
    gl.uniform1i(this.uniform('u_image'), 0)
  }

  loadImage(bitmap: ImageBitmap): void {
    this.videoSrc = null
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

  /** 加载视频源 — 后续每帧 render() 时自动上传当前视频帧到纹理 */
  loadVideo(video: HTMLVideoElement): void {
    this.videoSrc = video
    this.sourceSize = { width: video.videoWidth, height: video.videoHeight }
    const gl = this.gl
    if (!this.texture) this.texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
  }

  /** 是否有视频源加载 */
  hasVideoSource(): boolean {
    return this.videoSrc !== null
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

  /**
   * 加载 3D LUT 纹理 — 替代 GLSL 颜色计算。
   * data: Float32Array，长度 N^3 * 3，按 B→G→R 平面顺序排列
   */
  loadLut(data: Float32Array, lutSize: number = LUT_SIZE, key: string | null = null): void {
    const gl = this.gl
    // 删除旧 LUT 纹理
    if (this.lutTexture) gl.deleteTexture(this.lutTexture)

    const tex = gl.createTexture()
    if (!tex) return
    this.lutTexture = tex

    if (data.length !== lutSize * lutSize * lutSize * 3) {
      gl.deleteTexture(tex)
      this.lutTexture = null
      this.useLut = false
      this.lutKey = null
      glLog('LUT data length mismatch, fallback to GLSL')
      return
    }

    // 激活纹理单元 1（0 是主图）
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, tex)

    const rgba = new Uint8Array(lutSize * lutSize * lutSize * 4)
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = Math.round(Math.max(0, Math.min(1, data[i])) * 255)
      rgba[j + 1] = Math.round(Math.max(0, Math.min(1, data[i + 1])) * 255)
      rgba[j + 2] = Math.round(Math.max(0, Math.min(1, data[i + 2])) * 255)
      rgba[j + 3] = 255
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lutSize, lutSize, lutSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    let gle = gl.getError()
    if (gle !== gl.NO_ERROR) {
      glLog('texImage3D failed, fallback to GLSL', gle)
      gl.deleteTexture(tex)
      this.lutTexture = null
      this.useLut = false
      this.lutKey = null
      return
    }

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_3D, null)

    this.useLut = true
    this.lutKey = key
    glLog('LUT loaded ok, size=' + lutSize)
  }

  /** 清除 LUT 纹理，回退到 GLSL 颜色计算 */
  clearLut(): void {
    if (this.lutTexture) {
      this.gl.deleteTexture(this.lutTexture)
      this.lutTexture = null
    }
    this.useLut = false
    this.lutKey = null
  }

  /** 当前是否使用 LUT 预览 */
  hasLut(): boolean {
    return this.useLut && this.lutTexture !== null
  }

  /** 清除当前纹理和视频源 — 切换媒体时调用，避免旧纹理 + 新参数渲染 */
  clearSource(): void {
    this.videoSrc = null
    if (this.texture) {
      this.gl.deleteTexture(this.texture)
      this.texture = null
    }
  }

  render(pipeline: EditPipeline, options: { cropMode?: boolean } = {}): void {
    if (!this.texture) return
    const gl = this.gl
    const lutValid = Boolean(this.useLut && this.lutTexture && this.lutKey === colorLutKey(pipeline.color))
    gl.useProgram(this.program)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // 纹理单元 0：主图/视频
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (this.videoSrc) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.videoSrc)
    }
    const err0 = gl.getError()
    if (err0 !== gl.NO_ERROR) glLog('texImage2D', err0)

    // 纹理单元 1：3D LUT
    if (lutValid && this.lutTexture) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    }

    this.updateUniforms(pipeline, options)
    const err1 = gl.getError()
    if (err1 !== gl.NO_ERROR) glLog('updateUniforms', err1)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const err2 = gl.getError()
    if (err2 !== gl.NO_ERROR) glLog('draw', err2)
  }

  destroy(): void {
    this.videoSrc = null
    if (this.texture) this.gl.deleteTexture(this.texture)
    if (this.lutTexture) this.gl.deleteTexture(this.lutTexture)
    this.gl.deleteProgram(this.program)
  }

  getDisplayRect(): { x: number; y: number; width: number; height: number } {
    return this.displayRect
  }

  getSourceAspect(): number {
    return Math.max(1, this.sourceSize.width) / Math.max(1, this.sourceSize.height)
  }

  /** 读取画布上指定区域的像素（用于导出/取色） */
  readPixels(x: number, y: number, width: number, height: number): Uint8Array {
    const gl = this.gl
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return pixels
  }

  /** 读取整个画布的像素，使用预分配缓冲（避免 GC） */
  readPixelsInto(pixels: Uint8Array): void {
    const gl = this.gl
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  }

  /** 读取整个画布的像素 */
  readAllPixels(): Uint8Array {
    return this.readPixels(0, 0, this.canvas.width, this.canvas.height)
  }

  samplePixel(x: number, y: number): { r: number; g: number; b: number } | null {
    if (!this.texture) return null
    const pixels = this.readPixels(Math.round(x), Math.round(this.canvas.height - y), 1, 1)
    return { r: pixels[0], g: pixels[1], b: pixels[2] }
  }

  private updateUniforms(pipeline: EditPipeline, options: { cropMode?: boolean }): void {
    const gl = this.gl

    // 主纹理在纹理单元 0，3D LUT 在纹理单元 1
    gl.uniform1i(this.uniform('u_image'), 0)
    const lutLoc = gl.getUniformLocation(this.program, 'u_lut3d')
    if (lutLoc) gl.uniform1i(lutLoc, 1)

    const fullCrop = { x: 0, y: 0, w: 1, h: 1 }
    const selectionCrop = pipeline.transform.crop ?? fullCrop
    const crop = options.cropMode ? fullCrop : selectionCrop
    const imageAspect = Math.max(1, this.sourceSize.width) / Math.max(1, this.sourceSize.height)
    const totalRotate = pipeline.transform.orientation + pipeline.transform.rotate
    const displayImageAspect = displayAspectForCrop(imageAspect, pipeline.transform.orientation, crop)
    const currentFrameSize = frameSize(imageAspect, pipeline.transform.orientation)
    const canvasClientW = Math.max(1, this.canvas.clientWidth)
    const canvasClientH = Math.max(1, this.canvas.clientHeight)
    const displayContainerScale = options.cropMode ? CROP_MODE_PREVIEW_SCALE : 1
    const displayContainerW = canvasClientW * displayContainerScale
    const displayContainerH = canvasClientH * displayContainerScale
    const displayContainerX = (canvasClientW - displayContainerW) / 2
    const displayContainerY = (canvasClientH - displayContainerH) / 2
    const displayRect = containRect(displayContainerW, displayContainerH, displayImageAspect)
    const dprX = this.canvas.width / canvasClientW
    const dprY = this.canvas.height / canvasClientH
    gl.viewport(
      Math.round(displayContainerX * dprX),
      Math.round((canvasClientH - displayContainerY - displayContainerH) * dprY),
      Math.round(displayContainerW * dprX),
      Math.round(displayContainerH * dprY),
    )
    this.displayRect = {
      x: displayContainerX + displayRect.x,
      y: displayContainerY + displayRect.y,
      width: displayRect.width,
      height: displayRect.height,
    }
    gl.uniform2f(this.uniform('u_aspectRatio'), displayImageAspect, displayContainerW / displayContainerH)
    gl.uniform4f(this.uniform('u_crop'), crop.x, crop.y, crop.w, crop.h)
    gl.uniform1f(this.uniform('u_rotate'), totalRotate)
    gl.uniform2f(this.uniform('u_flip'), pipeline.transform.flipH ? 1 : 0, pipeline.transform.flipV ? 1 : 0)
    gl.uniform1f(this.uniform('u_scale'), pipeline.transform.scale)
    gl.uniform1f(this.uniform('u_cropAspect'), imageAspect)
    gl.uniform2f(this.uniform('u_frameSize'), currentFrameSize.width, currentFrameSize.height)
    gl.uniform1f(this.uniform('u_fillScale'), 1)

    // Detail (空间滤镜不烘焙进 LUT)
    const color = pipeline.color
    gl.uniform2f(this.uniform('u_texel'), 1 / Math.max(1, this.sourceSize.width), 1 / Math.max(1, this.sourceSize.height))
    gl.uniform1f(this.uniform('u_clarity'), color.clarity / 100)
    gl.uniform1f(this.uniform('u_texture'), color.texture / 100)
    gl.uniform1f(this.uniform('u_sharpen'), color.sharpen / 100)
    gl.uniform1f(this.uniform('u_denoise'), color.denoise / 100)
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
    if (!program) throw new Error('无法初始化预览效果')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? '预览效果初始化失败')
    }
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return program
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)
    if (!shader) throw new Error('无法初始化预览效果')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? '预览效果初始化失败')
    }
    return shader
  }

  private uniform(name: string): WebGLUniformLocation {
    const location = this.uniforms.get(name)
    if (!location) throw new Error(`预览参数缺失: ${name}`)
    return location
  }
}
