import { clampNumber } from './editParameterRanges'

export interface BeautyFaceGeometry {
  centerX: number
  centerY: number
  width: number
  height: number
  leftEyeX: number
  leftEyeY: number
  leftEyeRadiusX: number
  leftEyeRadiusY: number
  rightEyeX: number
  rightEyeY: number
  rightEyeRadiusX: number
  rightEyeRadiusY: number
  mouthX: number
  mouthY: number
  mouthRadiusX: number
  mouthRadiusY: number
  /** 顺时针排列的 24 个脸部外轮廓点，保存为 x/y 交错数组。 */
  contour: number[]
}

export interface BeautySettings {
  smoothing: number
  whitening: number
  slimFace: number
  bigEyes: number
  /** MediaPipe 分析出的紧凑人脸几何；坐标相对于原图。 */
  faces: BeautyFaceGeometry[]
  /** 无人脸也要记录已分析状态，避免反复运行检测。 */
  analyzed: boolean
}

export const DEFAULT_BEAUTY_SETTINGS: BeautySettings = {
  smoothing: 0,
  whitening: 0,
  slimFace: 0,
  bigEyes: 0,
  faces: [],
  analyzed: false,
}

export function normalizeBeautySettings(input: Partial<BeautySettings> | undefined): BeautySettings {
  const value = { ...DEFAULT_BEAUTY_SETTINGS, ...(input ?? {}) }
  const unit = (number: unknown): number => clampNumber(Number(number), { min: 0, max: 1 })
  const faces = Array.isArray(value.faces)
    ? value.faces.slice(0, 3).map((face) => ({
        centerX: unit(face.centerX), centerY: unit(face.centerY),
        width: unit(face.width), height: unit(face.height),
        leftEyeX: unit(face.leftEyeX), leftEyeY: unit(face.leftEyeY),
        leftEyeRadiusX: unit(face.leftEyeRadiusX), leftEyeRadiusY: unit(face.leftEyeRadiusY),
        rightEyeX: unit(face.rightEyeX), rightEyeY: unit(face.rightEyeY),
        rightEyeRadiusX: unit(face.rightEyeRadiusX), rightEyeRadiusY: unit(face.rightEyeRadiusY),
        mouthX: unit(face.mouthX), mouthY: unit(face.mouthY),
        mouthRadiusX: unit(face.mouthRadiusX), mouthRadiusY: unit(face.mouthRadiusY),
        contour: Array.isArray(face.contour)
          ? face.contour.slice(0, 48).map(unit)
          : [],
      }))
    : []
  return {
    smoothing: clampNumber(Number(value.smoothing), { min: 0, max: 100 }),
    whitening: clampNumber(Number(value.whitening), { min: 0, max: 100 }),
    slimFace: clampNumber(Number(value.slimFace), { min: 0, max: 100 }),
    bigEyes: clampNumber(Number(value.bigEyes), { min: 0, max: 100 }),
    faces,
    analyzed: Boolean(value.analyzed),
  }
}
