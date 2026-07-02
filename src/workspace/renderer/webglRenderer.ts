import type { EditPipeline } from '../shared/editPipeline'
import { containRect, displayAspectForCrop, frameSize } from '../transform/cropGeometry'
import { fragmentSource, vertexSource } from './shaders/program'

const CROP_MODE_PREVIEW_SCALE = 0.88
const MAX_CURVE_POINTS = 12

const UNIFORM_NAMES = [
  // Texture / Transform
  'u_image',
  'u_aspectRatio',
  'u_crop',
  'u_rotate',
  'u_flip',
  'u_scale',
  'u_cropAspect',
  'u_frameSize',
  'u_fillScale',
  // Exposure & Brightness
  'u_exposure',
  'u_brightness',
  // White Balance
  'u_temperature',
  'u_tint',
  // Tone Equalizer
  'u_shadows',
  'u_highlights',
  'u_whites',
  'u_blacks',
  // Color Balance
  'u_contrast',
  'u_vibrance',
  'u_saturation',
  // Color Grading
  'u_gradeShadowsHue',
  'u_gradeShadowsAmount',
  'u_gradeMidHue',
  'u_gradeMidAmount',
  'u_gradeHighlightsHue',
  'u_gradeHighlightsAmount',
  // Curves
  'u_curveRgbPointCount',
  'u_curveRgbPoints',
  'u_curveLuminancePointCount',
  'u_curveLuminancePoints',
  'u_curveRedPointCount',
  'u_curveRedPoints',
  'u_curveGreenPointCount',
  'u_curveGreenPoints',
  'u_curveBluePointCount',
  'u_curveBluePoints',
  // Levels
  'u_levelsBlack',
  'u_levelsWhite',
  'u_levelsGray',
  // HSL (single-band)
  'u_hue',
  'u_hslHue',
  'u_hslSat',
  'u_hslLum',
  // Detail
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
    gl.useProgram(this.program)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    // 视频源：每帧上传当前视频帧到纹理
    if (this.videoSrc) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.videoSrc)
    }
    this.updateUniforms(pipeline, options)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy(): void {
    this.videoSrc = null
    if (this.texture) this.gl.deleteTexture(this.texture)
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

    // --- Color uniforms (derived from ffmpeg filter source) ---
    const color = pipeline.color

    // Exposure (eq=gamma power law)
    gl.uniform1f(this.uniform('u_exposure'), color.exposure)
    // Brightness (eq=brightness — additive offset)
    gl.uniform1f(this.uniform('u_brightness'), color.brightness)

    // White Balance (colortemperature / hue)
    gl.uniform1f(this.uniform('u_temperature'), color.temperature / 100)
    gl.uniform1f(this.uniform('u_tint'), color.tint / 100)

    // Tone Equalizer (colorbalance shadows/highlights/whites/blacks)
    gl.uniform1f(this.uniform('u_shadows'), color.shadows / 100)
    gl.uniform1f(this.uniform('u_highlights'), color.highlights / 100)
    gl.uniform1f(this.uniform('u_whites'), color.whites / 100)
    gl.uniform1f(this.uniform('u_blacks'), color.blacks / 100)

    // Color Balance (eq=contrast / eq=saturation / vibrance / grading)
    gl.uniform1f(this.uniform('u_contrast'), color.contrast / 100)
    gl.uniform1f(this.uniform('u_vibrance'), color.vibrance / 100)
    gl.uniform1f(this.uniform('u_saturation'), color.saturation / 100)

    // Color Grading
    gl.uniform1f(this.uniform('u_gradeShadowsHue'), color.gradeShadowsHue)
    gl.uniform1f(this.uniform('u_gradeShadowsAmount'), color.gradeShadowsAmount / 100)
    gl.uniform1f(this.uniform('u_gradeMidHue'), color.gradeMidHue)
    gl.uniform1f(this.uniform('u_gradeMidAmount'), color.gradeMidAmount / 100)
    gl.uniform1f(this.uniform('u_gradeHighlightsHue'), color.gradeHighlightsHue)
    gl.uniform1f(this.uniform('u_gradeHighlightsAmount'), color.gradeHighlightsAmount / 100)

    // Curves — per-channel point arrays
    this.setCurvePoints('Rgb', color.curve.points.rgb)
    this.setCurvePoints('Luminance', color.curve.points.luminance)
    this.setCurvePoints('Red', color.curve.points.red)
    this.setCurvePoints('Green', color.curve.points.green)
    this.setCurvePoints('Blue', color.curve.points.blue)
    // Levels (black / gray / white with gamma)
    gl.uniform1f(this.uniform('u_levelsBlack'), color.levelsBlack)
    gl.uniform1f(this.uniform('u_levelsWhite'), color.levelsWhite)
    gl.uniform1f(this.uniform('u_levelsGray'), color.levelsGray)

    // HSL single-band
    gl.uniform1f(this.uniform('u_hue'), color.hue)
    gl.uniform1f(this.uniform('u_hslHue'), color.hslHue)
    gl.uniform1f(this.uniform('u_hslSat'), color.hslSat / 100)
    gl.uniform1f(this.uniform('u_hslLum'), color.hslLum / 100)

    // Detail
    gl.uniform2f(this.uniform('u_texel'), 1 / Math.max(1, this.sourceSize.width), 1 / Math.max(1, this.sourceSize.height))
    gl.uniform1f(this.uniform('u_clarity'), color.clarity / 100)
    gl.uniform1f(this.uniform('u_texture'), color.texture / 100)
    gl.uniform1f(this.uniform('u_sharpen'), color.sharpen / 100)
    gl.uniform1f(this.uniform('u_denoise'), color.denoise / 100)
  }

  private setCurvePoints(name: string, points: Array<{ x: number; y: number }>): void {
    const gl = this.gl
    const safe = points.slice(0, MAX_CURVE_POINTS)
    gl.uniform1i(this.uniform(`u_curve${name}PointCount`), safe.length)
    const data = new Float32Array(MAX_CURVE_POINTS * 2)
    safe.forEach((point, index) => {
      data[index * 2] = point.x
      data[index * 2 + 1] = point.y
    })
    gl.uniform2fv(this.uniform(`u_curve${name}Points`), data)
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
