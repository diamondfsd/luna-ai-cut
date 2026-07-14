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
  /** 量化后的 MediaPipe x/y 网格，供高级局部美颜使用。 */
  landmarkMesh: string
  landmarkCount: number
}

export interface BeautySkinSettings {
  smoothing: number
  whitening: number
  complexion: number
  warmth: number
  rosy: number
  texture: number
  nasolabialFolds: number
}

export interface BeautyReshapeSettings {
  slimFace: number
  faceShave: number
  faceNarrow: number
  chin: number
  forehead: number
}

export interface BeautyEyeSettings {
  bigEyes: number
  distance: number
  corner: number
  furrows: number
  bags: number
  bright: number
}

export interface BeautyNoseSettings {
  thin: number
  alae: number
  length: number
}

export interface BeautyMouthSettings {
  size: number
  teeth: number
}

export interface BeautyMakeupSettings {
  lipstick: number
  lipstickColor: string
  blush: number
  blushColor: string
}

export interface BeautySettings {
  skin: BeautySkinSettings
  reshape: BeautyReshapeSettings
  eyes: BeautyEyeSettings
  nose: BeautyNoseSettings
  mouth: BeautyMouthSettings
  makeup: BeautyMakeupSettings
  faces: BeautyFaceGeometry[]
  /** 128x128 灰度皮肤分割蒙版，以 base64 保存。 */
  skinMask: string
  skinMaskWidth: number
  skinMaskHeight: number
  analysisVersion: number
  analyzed: boolean
}

export const DEFAULT_BEAUTY_SETTINGS: BeautySettings = {
  skin: { smoothing: 0, whitening: 0, complexion: 0, warmth: 0, rosy: 0, texture: 0, nasolabialFolds: 0 },
  reshape: { slimFace: 0, faceShave: 0, faceNarrow: 0, chin: 0, forehead: 0 },
  eyes: { bigEyes: 0, distance: 0, corner: 0, furrows: 0, bags: 0, bright: 0 },
  nose: { thin: 0, alae: 0, length: 0 },
  mouth: { size: 0, teeth: 0 },
  makeup: { lipstick: 0, lipstickColor: '#b94b5f', blush: 0, blushColor: '#d8797d' },
  faces: [],
  skinMask: '',
  skinMaskWidth: 0,
  skinMaskHeight: 0,
  analysisVersion: 0,
  analyzed: false,
}

export type BeautyParameterPreset = Pick<BeautySettings, 'skin' | 'reshape' | 'eyes' | 'nose' | 'mouth' | 'makeup'>

/** 偏向自然人像精修：优先均匀肤色与淡化瑕疵，五官调整保持克制。 */
export const NATURAL_BEAUTY_PRESET: BeautyParameterPreset = {
  skin: { smoothing: 86, whitening: 18, complexion: 100, warmth: 2, rosy: 8, texture: 10, nasolabialFolds: 65 },
  reshape: { slimFace: 45, faceShave: 58, faceNarrow: 32, chin: 12, forehead: 0 },
  eyes: { bigEyes: 8, distance: 0, corner: 3, furrows: 0, bags: 72, bright: 18 },
  nose: { thin: 12, alae: 6, length: 0 },
  mouth: { size: 0, teeth: 18 },
  makeup: { lipstick: 14, lipstickColor: '#b94b5f', blush: 10, blushColor: '#d8797d' },
}

type LegacyBeautySettings = Partial<BeautySettings> & {
  smoothing?: number
  whitening?: number
  slimFace?: number
  bigEyes?: number
}

export function normalizeBeautySettings(input: LegacyBeautySettings | undefined): BeautySettings {
  const value = input ?? {}
  const percent = (number: unknown): number => clampNumber(Number(number), { min: 0, max: 100 })
  const signed = (number: unknown): number => clampNumber(Number(number), { min: -100, max: 100 })
  const unit = (number: unknown): number => clampNumber(Number(number), { min: 0, max: 1 })
  const skin = value.skin ?? DEFAULT_BEAUTY_SETTINGS.skin
  const reshape = value.reshape ?? DEFAULT_BEAUTY_SETTINGS.reshape
  const eyes = value.eyes ?? DEFAULT_BEAUTY_SETTINGS.eyes
  const nose = value.nose ?? DEFAULT_BEAUTY_SETTINGS.nose
  const mouth = value.mouth ?? DEFAULT_BEAUTY_SETTINGS.mouth
  const makeup = value.makeup ?? DEFAULT_BEAUTY_SETTINGS.makeup
  const faces = Array.isArray(value.faces)
    ? value.faces.slice(0, 3).map((face) => ({
        centerX: unit(face.centerX), centerY: unit(face.centerY), width: unit(face.width), height: unit(face.height),
        leftEyeX: unit(face.leftEyeX), leftEyeY: unit(face.leftEyeY), leftEyeRadiusX: unit(face.leftEyeRadiusX), leftEyeRadiusY: unit(face.leftEyeRadiusY),
        rightEyeX: unit(face.rightEyeX), rightEyeY: unit(face.rightEyeY), rightEyeRadiusX: unit(face.rightEyeRadiusX), rightEyeRadiusY: unit(face.rightEyeRadiusY),
        mouthX: unit(face.mouthX), mouthY: unit(face.mouthY), mouthRadiusX: unit(face.mouthRadiusX), mouthRadiusY: unit(face.mouthRadiusY),
        contour: Array.isArray(face.contour) ? face.contour.slice(0, 48).map(unit) : [],
        landmarkMesh: typeof face.landmarkMesh === 'string' ? face.landmarkMesh : '',
        landmarkCount: Math.round(clampNumber(Number(face.landmarkCount), { min: 0, max: 478 })),
      }))
    : []
  return {
    skin: {
      smoothing: percent(skin.smoothing ?? value.smoothing), whitening: percent(skin.whitening ?? value.whitening),
      complexion: percent(skin.complexion), warmth: signed(skin.warmth), rosy: percent(skin.rosy),
      texture: percent(skin.texture), nasolabialFolds: percent(skin.nasolabialFolds),
    },
    reshape: {
      slimFace: percent(reshape.slimFace ?? value.slimFace), faceShave: percent(reshape.faceShave),
      faceNarrow: percent(reshape.faceNarrow), chin: signed(reshape.chin), forehead: signed(reshape.forehead),
    },
    eyes: {
      bigEyes: percent(eyes.bigEyes ?? value.bigEyes), distance: signed(eyes.distance), corner: signed(eyes.corner),
      furrows: percent(eyes.furrows), bags: percent(eyes.bags), bright: percent(eyes.bright),
    },
    nose: { thin: percent(nose.thin), alae: percent(nose.alae), length: signed(nose.length) },
    mouth: { size: signed(mouth.size), teeth: percent(mouth.teeth) },
    makeup: {
      lipstick: percent(makeup.lipstick), lipstickColor: typeof makeup.lipstickColor === 'string' ? makeup.lipstickColor : DEFAULT_BEAUTY_SETTINGS.makeup.lipstickColor,
      blush: percent(makeup.blush), blushColor: typeof makeup.blushColor === 'string' ? makeup.blushColor : DEFAULT_BEAUTY_SETTINGS.makeup.blushColor,
    },
    faces,
    skinMask: typeof value.skinMask === 'string' ? value.skinMask : '',
    skinMaskWidth: Math.round(clampNumber(Number(value.skinMaskWidth), { min: 0, max: 512 })),
    skinMaskHeight: Math.round(clampNumber(Number(value.skinMaskHeight), { min: 0, max: 512 })),
    analysisVersion: Math.round(clampNumber(Number(value.analysisVersion), { min: 0, max: 100 })),
    analyzed: Boolean(value.analyzed),
  }
}

export function isBeautyModified(beauty: BeautySettings): boolean {
  return [
    ...Object.values(beauty.skin),
    ...Object.values(beauty.reshape),
    ...Object.values(beauty.eyes),
    ...Object.values(beauty.nose),
    ...Object.values(beauty.mouth),
    beauty.makeup.lipstick,
    beauty.makeup.blush,
  ].some((value) => typeof value === 'number' && value !== 0)
}
