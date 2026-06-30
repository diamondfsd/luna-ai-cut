import type { EditPipeline } from '../shared/editPipeline'
import { containRect, displayAspectForCrop, frameSize } from '../transform/cropGeometry'
import fragmentSource from './shaders/pipeline.glsl?raw'
import vertexSource from './shaders/vertex.glsl?raw'

const COLOR_MIX_CHANNELS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
const TONE_CURVE_CHANNELS = ['rgb', 'luminance', 'red', 'green', 'blue'] as const
const SELECTIVE_COLOR_CHANNELS = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white', 'neutral', 'black'] as const
const CROP_MODE_PREVIEW_SCALE = 0.88
const EXPOSURE_EV_SCALE = 0.4

function kelvinToRgb(kelvin: number): { r: number; g: number; b: number } {
  const temp = Math.max(10, kelvin / 100)
  const r = temp <= 66 ? 255 : 329.698727446 * Math.pow(temp - 60, -0.1332047592)
  const g = temp <= 66
    ? 99.4708025861 * Math.log(temp) - 161.1195681661
    : 288.1221695283 * Math.pow(temp - 60, -0.0755148492)
  const b = temp >= 66 ? 255 : temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307
  return {
    r: Math.max(0.05, Math.min(1, r / 255)),
    g: Math.max(0.05, Math.min(1, g / 255)),
    b: Math.max(0.05, Math.min(1, b / 255)),
  }
}

function whiteBalanceGains(kelvin: number, tint: number): { r: number; g: number; b: number } {
  const reference = kelvinToRgb(5500)
  const target = kelvinToRgb(kelvin)
  const tintShift = tint / 100
  const gains = {
    r: reference.r / target.r * (1 + Math.max(0, tintShift) * 0.08),
    g: reference.g / target.g * (1 - tintShift * 0.12),
    b: reference.b / target.b * (1 - Math.max(0, tintShift) * 0.04),
  }
  const middle = (gains.r + gains.g + gains.b) / 3
  return {
    r: gains.r / middle,
    g: gains.g / middle,
    b: gains.b / middle,
  }
}

const UNIFORM_NAMES = [
  'u_texture',
  'u_resolution',
  'u_aspectRatio',
  'u_crop',
  'u_rotate',
  'u_flip',
  'u_scale',
  'u_cropAspect',
  'u_frameSize',
  'u_fillScale',
  'u_exposure',
  'u_contrast',
  'u_brightness',
  'u_saturation',
  'u_vibrance',
  'u_whiteBalanceGains',
  'u_highlights',
  'u_shadows',
  'u_whites',
  'u_blacks',
  'u_textureAmount',
  'u_clarity',
  'u_dehaze',
  'u_curve[0]',
  'u_sharpen',
  'u_sharpenRadius',
  'u_sharpenDetail',
  'u_sharpenMasking',
  'u_noiseReduction',
  'u_colorNoiseReduction',
  'u_vignette',
  'u_grainAmount',
  'u_grainSize',
  'u_grainRoughness',
  'u_lensVignetting',
  'u_chromaticAberration',
  'u_hslHue',
  'u_hslSaturation',
  'u_hslLuminance',
  'u_colorEditor',
  'u_colorEditorExtra',
  'u_gradingShadows',
  'u_gradingMidtones',
  'u_gradingHighlights',
  'u_gradingBlending',
  'u_gradingBalance',
  'u_selectiveColor',
  'u_selectiveColorMode',
  'u_calibrationHue',
  'u_calibrationSaturation',
] as const

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly uniforms = new Map<string, WebGLUniformLocation>()
  private texture: WebGLTexture | null = null
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

  render(pipeline: EditPipeline, options: { cropMode?: boolean } = {}): void {
    if (!this.texture) return
    const gl = this.gl
    gl.useProgram(this.program)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    this.updateUniforms(pipeline, options)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  destroy(): void {
    if (this.texture) this.gl.deleteTexture(this.texture)
    this.gl.deleteProgram(this.program)
  }

  getDisplayRect(): { x: number; y: number; width: number; height: number } {
    return this.displayRect
  }

  getSourceAspect(): number {
    return Math.max(1, this.sourceSize.width) / Math.max(1, this.sourceSize.height)
  }

  samplePixel(x: number, y: number): { r: number; g: number; b: number } | null {
    if (!this.texture) return null
    const gl = this.gl
    const pixels = new Uint8Array(4)
    gl.readPixels(Math.round(x), Math.round(this.canvas.height - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return { r: pixels[0], g: pixels[1], b: pixels[2] }
  }

  private updateUniforms(pipeline: EditPipeline, options: { cropMode?: boolean }): void {
    const gl = this.gl
    const fullCrop = { x: 0, y: 0, w: 1, h: 1 }
    const selectionCrop = pipeline.transform.crop ?? fullCrop
    const crop = options.cropMode ? fullCrop : selectionCrop
    gl.uniform2f(this.uniform('u_resolution'), this.sourceSize.width, this.sourceSize.height)
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
    gl.uniform1f(this.uniform('u_exposure'), pipeline.color.exposure * EXPOSURE_EV_SCALE)
    gl.uniform1f(this.uniform('u_contrast'), pipeline.color.contrast / 100)
    gl.uniform1f(this.uniform('u_brightness'), pipeline.color.brightness / 100)
    gl.uniform1f(this.uniform('u_saturation'), pipeline.color.saturation / 100)
    gl.uniform1f(this.uniform('u_vibrance'), pipeline.color.vibrance / 100)
    const whiteBalance = this.whiteBalanceValues(pipeline)
    gl.uniform3f(this.uniform('u_whiteBalanceGains'), whiteBalance.gains.r, whiteBalance.gains.g, whiteBalance.gains.b)
    gl.uniform1f(this.uniform('u_highlights'), pipeline.color.highlights / 100)
    gl.uniform1f(this.uniform('u_shadows'), pipeline.color.shadows / 100)
    gl.uniform1f(this.uniform('u_whites'), pipeline.color.whites / 100)
    gl.uniform1f(this.uniform('u_blacks'), pipeline.color.blacks / 100)
    gl.uniform1f(this.uniform('u_textureAmount'), pipeline.color.texture / 100)
    gl.uniform1f(this.uniform('u_clarity'), pipeline.color.clarity / 100)
    gl.uniform1f(this.uniform('u_dehaze'), pipeline.color.dehaze / 100)
    gl.uniform4fv(
      this.uniform('u_curve[0]'),
      TONE_CURVE_CHANNELS.flatMap((channel) => {
        const curve = pipeline.color.curve.channels[channel]
        return [curve.shadows / 100, curve.darks / 100, curve.lights / 100, curve.highlights / 100]
      }),
    )
    gl.uniform1f(this.uniform('u_sharpen'), pipeline.effects.sharpen / 150)
    gl.uniform1f(this.uniform('u_sharpenRadius'), pipeline.effects.sharpenRadius)
    gl.uniform1f(this.uniform('u_sharpenDetail'), pipeline.effects.sharpenDetail / 100)
    gl.uniform1f(this.uniform('u_sharpenMasking'), pipeline.effects.sharpenMasking / 100)
    gl.uniform1f(this.uniform('u_noiseReduction'), pipeline.effects.noiseReduction / 100)
    gl.uniform1f(this.uniform('u_colorNoiseReduction'), pipeline.effects.colorNoiseReduction / 100)
    gl.uniform1f(this.uniform('u_vignette'), pipeline.effects.vignette / 100)
    gl.uniform1f(this.uniform('u_grainAmount'), pipeline.effects.grainAmount / 100)
    gl.uniform1f(this.uniform('u_grainSize'), pipeline.effects.grainSize / 100)
    gl.uniform1f(this.uniform('u_grainRoughness'), pipeline.effects.grainRoughness / 100)
    gl.uniform1f(this.uniform('u_lensVignetting'), pipeline.effects.lensVignetting / 100)
    gl.uniform1f(this.uniform('u_chromaticAberration'), pipeline.effects.chromaticAberration / 100)
    gl.uniform1fv(this.uniform('u_hslHue'), COLOR_MIX_CHANNELS.map((channel) => pipeline.color.hsl[channel].hue / 100))
    gl.uniform1fv(this.uniform('u_hslSaturation'), COLOR_MIX_CHANNELS.map((channel) => pipeline.color.hsl[channel].saturation / 100))
    gl.uniform1fv(this.uniform('u_hslLuminance'), COLOR_MIX_CHANNELS.map((channel) => pipeline.color.hsl[channel].luminance / 100))
    gl.uniform4f(
      this.uniform('u_colorEditor'),
      pipeline.color.colorEditor.hue / 360,
      pipeline.color.colorEditor.saturation / 100,
      pipeline.color.colorEditor.smoothing / 100,
      pipeline.color.colorEditor.luminanceSmoothing / 100,
    )
    gl.uniform4f(
      this.uniform('u_colorEditorExtra'),
      pipeline.color.colorEditor.hueOffset / 100,
      pipeline.color.colorEditor.saturationOffset / 100,
      pipeline.color.colorEditor.brightnessOffset / 100,
      pipeline.color.colorEditor.uniformity / 100,
    )
    gl.uniform3f(this.uniform('u_gradingShadows'), pipeline.color.grading.shadowsHue / 360, pipeline.color.grading.shadowsSaturation / 100, 0)
    gl.uniform3f(this.uniform('u_gradingMidtones'), pipeline.color.grading.midtonesHue / 360, pipeline.color.grading.midtonesSaturation / 100, 0)
    gl.uniform3f(this.uniform('u_gradingHighlights'), pipeline.color.grading.highlightsHue / 360, pipeline.color.grading.highlightsSaturation / 100, 0)
    gl.uniform1f(this.uniform('u_gradingBlending'), pipeline.color.grading.blending / 100)
    gl.uniform1f(this.uniform('u_gradingBalance'), pipeline.color.grading.balance / 100)
    gl.uniform4fv(
      this.uniform('u_selectiveColor'),
      SELECTIVE_COLOR_CHANNELS.flatMap((channel) => {
        const item = pipeline.color.selectiveColor[channel]
        return [item.cyan / 100, item.magenta / 100, item.yellow / 100, item.black / 100]
      }),
    )
    gl.uniform1f(this.uniform('u_selectiveColorMode'), pipeline.color.selectiveColorMode === 'absolute' ? 1 : 0)
    gl.uniform3f(
      this.uniform('u_calibrationHue'),
      pipeline.color.calibration.redHue / 100,
      pipeline.color.calibration.greenHue / 100,
      pipeline.color.calibration.blueHue / 100,
    )
    gl.uniform3f(
      this.uniform('u_calibrationSaturation'),
      pipeline.color.calibration.redSaturation / 100,
      pipeline.color.calibration.greenSaturation / 100,
      pipeline.color.calibration.blueSaturation / 100,
    )
  }

  private whiteBalanceValues(pipeline: EditPipeline): { temperature: number; tint: number; gains: { r: number; g: number; b: number } } {
    const temperature = Math.max(2000, Math.min(15000, pipeline.color.temperature || 5500))
    const tint = Math.max(-100, Math.min(100, pipeline.color.tint || 0))
    const gains = whiteBalanceGains(temperature, tint)
    return { temperature, tint, gains }
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
    if (!location) throw new Error('预览参数缺失')
    return location
  }
}
