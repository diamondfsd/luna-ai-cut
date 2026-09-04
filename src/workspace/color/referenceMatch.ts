import type { ReferenceMatchMethod } from '../../shared/types/referenceMatch'

export interface ReferenceMatchImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

export interface ReferenceMatchOptions {
  gridSize?: number
  maxSamples?: number
  strength?: number
  method?: ReferenceMatchMethod
  nColors?: number
  nSlices?: number
}

export interface ReferenceMatchStats {
  sourceSamples: number
  referenceSamples: number
  gridSize: number
  method: ReferenceMatchMethod
}

export interface ReferenceMatchLutResult {
  cube: string
  stats: ReferenceMatchStats
}

interface LabColor {
  l: number
  a: number
  b: number
}

type ColorVector = [number, number, number]
type Matrix3 = [ColorVector, ColorVector, ColorVector]

interface ChannelStats {
  mean: number
  standardDeviation: number
}

const DEFAULT_GRID_SIZE = 33
const DEFAULT_MAX_SAMPLES = 8_192
const DEFAULT_N_COLORS = 8
const DEFAULT_N_SLICES = 20
const EPSILON = 1e-6

function clamp(value: number, min = 0, max = 1): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

function xyzToLabComponent(value: number): number {
  const delta = 6 / 29
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29
}

function labToXyzComponent(value: number): number {
  const delta = 6 / 29
  return value > delta ? value ** 3 : 3 * delta ** 2 * (value - 4 / 29)
}

function rgbToLab(r: number, g: number, b: number): LabColor {
  const red = srgbToLinear(clamp(r))
  const green = srgbToLinear(clamp(g))
  const blue = srgbToLinear(clamp(b))
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047
  const y = (red * 0.2126729 + green * 0.7151522 + blue * 0.072175) / 1
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883
  const fx = xyzToLabComponent(x)
  const fy = xyzToLabComponent(y)
  const fz = xyzToLabComponent(z)
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

function labToRgb({ l, a, b }: LabColor): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const x = labToXyzComponent(fx) * 0.95047
  const y = labToXyzComponent(fy)
  const z = labToXyzComponent(fz) * 1.08883
  const red = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
  const green = x * -0.969266 + y * 1.8760108 + z * 0.041556
  const blue = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
  return [
    clamp(linearToSrgb(red)),
    clamp(linearToSrgb(green)),
    clamp(linearToSrgb(blue)),
  ]
}

function sampleLabs(image: ReferenceMatchImage, maxSamples: number): LabColor[] {
  const pixelCount = Math.min(image.width * image.height, Math.floor(image.data.length / 4))
  if (!Number.isFinite(pixelCount) || pixelCount <= 0) return []
  const stride = Math.max(1, Math.ceil(Math.sqrt(pixelCount / Math.max(1, maxSamples))))
  const result: LabColor[] = []
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const index = (y * image.width + x) * 4
      if (index + 3 >= image.data.length || image.data[index + 3] < 2) continue
      result.push(rgbToLab(
        image.data[index] / 255,
        image.data[index + 1] / 255,
        image.data[index + 2] / 255,
      ))
    }
  }
  return result
}

function statsFor(labs: LabColor[], key: keyof LabColor): ChannelStats {
  if (labs.length === 0) return { mean: 0, standardDeviation: 1 }
  const mean = labs.reduce((sum, color) => sum + color[key], 0) / labs.length
  const variance = labs.reduce((sum, color) => sum + (color[key] - mean) ** 2, 0) / labs.length
  return { mean, standardDeviation: Math.sqrt(variance) }
}

function labToVector(color: LabColor): ColorVector {
  return [clamp(color.l / 100), clamp((color.a + 128) / 255), clamp((color.b + 128) / 255)]
}

function vectorToLab([l, a, b]: ColorVector): LabColor {
  return { l: l * 100, a: a * 255 - 128, b: b * 255 - 128 }
}

function addVectors(left: ColorVector, right: ColorVector): ColorVector {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtractVectors(left: ColorVector, right: ColorVector): ColorVector {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function scaleVector(vector: ColorVector, factor: number): ColorVector {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

function dotVector(left: ColorVector, right: ColorVector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function distanceSquared(left: ColorVector, right: ColorVector): number {
  return dotVector(subtractVectors(left, right), subtractVectors(left, right))
}

function meanVector(values: ColorVector[]): ColorVector {
  if (values.length === 0) return [0, 0, 0]
  const total = values.reduce((sum, value) => addVectors(sum, value), [0, 0, 0] as ColorVector)
  return scaleVector(total, 1 / values.length)
}

function covariance(values: ColorVector[], mean: ColorVector): Matrix3 {
  const result: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  if (values.length === 0) return result
  for (const value of values) {
    const centered = subtractVectors(value, mean)
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        result[row][column] += centered[row] * centered[column]
      }
    }
  }
  const divisor = Math.max(1, values.length)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) result[row][column] /= divisor
  }
  return result
}

function identityMatrix(): Matrix3 {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
}

function transposeMatrix(matrix: Matrix3): Matrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ]
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  const result: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) result[row][column] += left[row][index] * right[index][column]
    }
  }
  return result
}

function multiplyMatrixVector(matrix: Matrix3, vector: ColorVector): ColorVector {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ]
}

interface SymmetricEigenResult {
  values: ColorVector
  vectors: Matrix3
}

function symmetricEigen(matrix: Matrix3): SymmetricEigenResult {
  const values: Matrix3 = matrix.map((row) => [...row]) as Matrix3
  const vectors = identityMatrix()
  for (let iteration = 0; iteration < 32; iteration += 1) {
    let p = 0
    let q = 1
    let largest = Math.abs(values[0][1])
    for (let row = 0; row < 3; row += 1) {
      for (let column = row + 1; column < 3; column += 1) {
        if (Math.abs(values[row][column]) > largest) {
          largest = Math.abs(values[row][column])
          p = row
          q = column
        }
      }
    }
    if (largest < 1e-10) break
    const angle = 0.5 * Math.atan2(2 * values[p][q], values[q][q] - values[p][p])
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    for (let row = 0; row < 3; row += 1) {
      const valueP = values[row][p]
      const valueQ = values[row][q]
      values[row][p] = cosine * valueP - sine * valueQ
      values[row][q] = sine * valueP + cosine * valueQ
    }
    for (let column = 0; column < 3; column += 1) {
      const valueP = values[p][column]
      const valueQ = values[q][column]
      values[p][column] = cosine * valueP - sine * valueQ
      values[q][column] = sine * valueP + cosine * valueQ
    }
    for (let row = 0; row < 3; row += 1) {
      const valueP = vectors[row][p]
      const valueQ = vectors[row][q]
      vectors[row][p] = cosine * valueP - sine * valueQ
      vectors[row][q] = sine * valueP + cosine * valueQ
    }
  }
  return { values: [values[0][0], values[1][1], values[2][2]], vectors }
}

function mapSymmetricMatrix(matrix: Matrix3, mapper: (value: number) => number): Matrix3 {
  const { values, vectors } = symmetricEigen(matrix)
  const diagonal: Matrix3 = [[mapper(values[0]), 0, 0], [0, mapper(values[1]), 0], [0, 0, mapper(values[2])]]
  return multiplyMatrices(multiplyMatrices(vectors, diagonal), transposeMatrix(vectors))
}

function regularizeCovariance(matrix: Matrix3): Matrix3 {
  const result = matrix.map((row) => [...row]) as Matrix3
  for (let index = 0; index < 3; index += 1) result[index][index] += 1e-5
  return result
}

function buildKantorovichTransform(source: ColorVector[], reference: ColorVector[]): (value: ColorVector) => ColorVector {
  const sourceMean = meanVector(source)
  const referenceMean = meanVector(reference)
  const sourceCovariance = regularizeCovariance(covariance(source, sourceMean))
  const referenceCovariance = regularizeCovariance(covariance(reference, referenceMean))
  const sourceSqrt = mapSymmetricMatrix(sourceCovariance, (value) => Math.sqrt(Math.max(value, EPSILON)))
  const sourceInverseSqrt = mapSymmetricMatrix(sourceCovariance, (value) => 1 / Math.sqrt(Math.max(value, EPSILON)))
  const middle = multiplyMatrices(multiplyMatrices(sourceSqrt, referenceCovariance), sourceSqrt)
  const transport = multiplyMatrices(
    multiplyMatrices(sourceInverseSqrt, mapSymmetricMatrix(middle, (value) => Math.sqrt(Math.max(value, EPSILON)))),
    sourceInverseSqrt,
  )
  return (value: ColorVector): ColorVector => clampVector(addVectors(referenceMean, multiplyMatrixVector(transport, subtractVectors(value, sourceMean))))
}

function clampVector(value: ColorVector): ColorVector {
  return [clamp(value[0]), clamp(value[1]), clamp(value[2])]
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function selectSamples(values: ColorVector[], maxSamples: number): ColorVector[] {
  if (values.length <= maxSamples) return values
  const random = seededRandom(42)
  const selected: ColorVector[] = []
  const step = values.length / maxSamples
  for (let index = 0; index < maxSamples; index += 1) {
    const sourceIndex = Math.min(values.length - 1, Math.floor(index * step + random()))
    selected.push(values[sourceIndex])
  }
  return selected
}

function initialCenters(values: ColorVector[], count: number): ColorVector[] {
  return Array.from({ length: count }, (_, index) => values[Math.floor(index * (values.length - 1) / Math.max(1, count - 1))] ?? [0, 0, 0])
}

function kMeans(values: ColorVector[], requestedCount: number): ColorVector[] {
  const count = Math.max(2, Math.min(requestedCount, values.length))
  let centers = initialCenters(values, count).map((value) => [...value] as ColorVector)
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const sums = Array.from({ length: count }, () => [0, 0, 0] as ColorVector)
    const counts = new Uint32Array(count)
    for (const value of values) {
      let nearest = 0
      let nearestDistance = distanceSquared(value, centers[0])
      for (let index = 1; index < count; index += 1) {
        const distance = distanceSquared(value, centers[index])
        if (distance < nearestDistance) {
          nearest = index
          nearestDistance = distance
        }
      }
      sums[nearest] = addVectors(sums[nearest], value)
      counts[nearest] += 1
    }
    let maximumShift = 0
    centers = centers.map((center, index) => {
      const next = counts[index] > 0 ? scaleVector(sums[index], 1 / counts[index]) : center
      maximumShift = Math.max(maximumShift, distanceSquared(center, next))
      return next
    })
    if (maximumShift < 1e-8) break
  }
  return centers
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function buildForgyTransform(source: ColorVector[], reference: ColorVector[], nColors: number): (value: ColorVector) => ColorVector {
  const sourceCenters = kMeans(selectSamples(source, 4096), nColors)
  const referenceCenters = kMeans(selectSamples(reference, 4096), nColors)
  const deltas = sourceCenters.map((sourceCenter) => {
    let nearest = referenceCenters[0]
    let nearestDistance = distanceSquared(sourceCenter, nearest)
    for (const candidate of referenceCenters.slice(1)) {
      const distance = distanceSquared(sourceCenter, candidate)
      if (distance < nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    return subtractVectors(nearest, sourceCenter)
  })
  const pairDistances: number[] = []
  for (let left = 0; left < sourceCenters.length; left += 1) {
    for (let right = left + 1; right < sourceCenters.length; right += 1) {
      pairDistances.push(Math.sqrt(distanceSquared(sourceCenters[left], sourceCenters[right])))
    }
  }
  const sigma = Math.max(EPSILON, median(pairDistances) * 0.75)
  return (value: ColorVector): ColorVector => {
    const weights = sourceCenters.map((center) => Math.exp(-0.5 * (Math.sqrt(distanceSquared(value, center)) / sigma) ** 2))
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
    const correction = deltas.reduce((sum, delta, index) => addVectors(sum, scaleVector(delta, weights[index] / total)), [0, 0, 0] as ColorVector)
    return clampVector(addVectors(value, correction))
  }
}

function lowerBound(values: number[], value: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const middle = (left + right) >> 1
    if (values[middle] < value) left = middle + 1
    else right = middle
  }
  return left
}

function upperBound(values: number[], value: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const middle = (left + right) >> 1
    if (values[middle] <= value) left = middle + 1
    else right = middle
  }
  return left
}

function transportProjection(value: number, sourceSorted: number[], referenceSorted: number[]): number {
  if (sourceSorted.length === 0 || referenceSorted.length === 0) return value
  if (sourceSorted.length === 1) return referenceSorted[0]
  const sourceRank = (index: number): number => index / Math.max(1, sourceSorted.length - 1)
  const mappedAt = (index: number): number => quantileValue(referenceSorted, sourceRank(index))

  if (value <= sourceSorted[0]) {
    const next = sourceSorted.findIndex((item) => item > sourceSorted[0])
    if (next < 0) return mappedAt(0)
    const slope = (mappedAt(next) - mappedAt(0)) / (sourceSorted[next] - sourceSorted[0])
    return mappedAt(0) + (value - sourceSorted[0]) * slope
  }
  if (value >= sourceSorted[sourceSorted.length - 1]) {
    let previous = sourceSorted.length - 2
    while (previous >= 0 && sourceSorted[previous] === sourceSorted[sourceSorted.length - 1]) previous -= 1
    if (previous < 0) return mappedAt(sourceSorted.length - 1)
    const last = sourceSorted.length - 1
    const slope = (mappedAt(last) - mappedAt(previous)) / (sourceSorted[last] - sourceSorted[previous])
    return mappedAt(last) + (value - sourceSorted[last]) * slope
  }

  const upper = upperBound(sourceSorted, value)
  const lower = lowerBound(sourceSorted, value)
  if (upper > lower) return quantileValue(referenceSorted, (lower + upper - 1) / (2 * (sourceSorted.length - 1)))
  const left = Math.max(0, upper - 1)
  const right = Math.min(sourceSorted.length - 1, upper)
  const span = sourceSorted[right] - sourceSorted[left]
  if (span <= EPSILON) return mappedAt(left)
  const weight = (value - sourceSorted[left]) / span
  return mappedAt(left) * (1 - weight) + mappedAt(right) * weight
}

function quantileValue(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0
  const position = clamp(quantile) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function buildDirections(count: number): ColorVector[] {
  const random = seededRandom(42)
  const directions: ColorVector[] = []
  for (let index = 0; index < count; index += 1) {
    const first = Math.max(EPSILON, random())
    const second = Math.max(EPSILON, random())
    const third = Math.max(EPSILON, random())
    const direction: ColorVector = [
      Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second),
      Math.sqrt(-2 * Math.log(first)) * Math.sin(2 * Math.PI * second),
      Math.sqrt(-2 * Math.log(third)) * Math.cos(2 * Math.PI * first),
    ]
    const length = Math.sqrt(dotVector(direction, direction)) || 1
    directions.push(scaleVector(direction, 1 / length))
  }
  return directions
}

function buildWassersteinTransform(source: ColorVector[], reference: ColorVector[], nSlices: number): (value: ColorVector) => ColorVector {
  const referenceSample = selectSamples(reference, 4096)
  let transportedSource = selectSamples(source, 4096).map((value) => [...value] as ColorVector)
  const directions = buildDirections(nSlices)
  const mappings: Array<{ direction: ColorVector; referenceSorted: number[]; sourceSorted: number[] }> = []
  for (const direction of directions) {
    const referenceSorted = referenceSample.map((value) => dotVector(value, direction)).sort((left, right) => left - right)
    const sourceSorted = transportedSource.map((value) => dotVector(value, direction)).sort((left, right) => left - right)
    mappings.push({ direction, referenceSorted, sourceSorted })
    transportedSource = transportedSource.map((value) => {
      const projection = dotVector(value, direction)
      const displacement = transportProjection(projection, sourceSorted, referenceSorted) - projection
      return clampVector(addVectors(value, scaleVector(direction, displacement * 0.5)))
    })
  }

  return (value: ColorVector): ColorVector => {
    let result = [...value] as ColorVector
    for (const { direction, referenceSorted, sourceSorted } of mappings) {
      const projection = dotVector(result, direction)
      const displacement = transportProjection(projection, sourceSorted, referenceSorted) - projection
      result = clampVector(addVectors(result, scaleVector(direction, displacement * 0.5)))
    }
    return result
  }
}

function buildReinhardTransform(source: LabColor[], reference: LabColor[]): (value: ColorVector) => ColorVector {
  const sourceStats = (['l', 'a', 'b'] as const).map((key) => statsFor(source, key))
  const referenceStats = (['l', 'a', 'b'] as const).map((key) => statsFor(reference, key))
  return (value: ColorVector): ColorVector => {
    const input = vectorToLab(value)
    const channels: LabColor = { l: input.l, a: input.a, b: input.b }
    const mapped = (['l', 'a', 'b'] as const).map((key, index) => {
      const targetStd = sourceStats[index].standardDeviation > EPSILON
        ? (channels[key] - sourceStats[index].mean) * (referenceStats[index].standardDeviation / sourceStats[index].standardDeviation) + referenceStats[index].mean
        : channels[key] - sourceStats[index].mean + referenceStats[index].mean
      return targetStd
    })
    return clampVector(labToVector({ l: mapped[0], a: mapped[1], b: mapped[2] }))
  }
}

function formatCubeValue(value: number): string {
  return clamp(value).toFixed(6)
}

function checkedGridSize(value: number | undefined): number {
  const gridSize = value ?? DEFAULT_GRID_SIZE
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 65) throw new Error('LUT 网格尺寸无效')
  return gridSize
}

export function generateReferenceMatchLut(
  source: ReferenceMatchImage,
  reference: ReferenceMatchImage,
  options: ReferenceMatchOptions = {},
): ReferenceMatchLutResult {
  const gridSize = checkedGridSize(options.gridSize)
  const maxSamples = Number.isFinite(options.maxSamples) && (options.maxSamples ?? 0) > 0
    ? Math.floor(options.maxSamples!)
    : DEFAULT_MAX_SAMPLES
  const requestedStrength = options.strength ?? 1
  const strength = Number.isFinite(requestedStrength) ? clamp(requestedStrength) : 1
  const method = options.method ?? 'reinhard'
  const sourceLabs = sampleLabs(source, maxSamples)
  const referenceLabs = sampleLabs(reference, maxSamples)
  if (sourceLabs.length === 0 || referenceLabs.length === 0) throw new Error('参考图或目标素材没有可用画面')

  const sourceVectors = sourceLabs.map(labToVector)
  const referenceVectors = referenceLabs.map(labToVector)
  const baseTransform = method === 'kantorovich'
    ? buildKantorovichTransform(sourceVectors, referenceVectors)
    : method === 'forgy'
      ? buildForgyTransform(sourceVectors, referenceVectors, Math.max(4, Math.min(options.nColors ?? DEFAULT_N_COLORS, 16)))
      : method === 'wasserstein'
        ? buildWassersteinTransform(sourceVectors, referenceVectors, Math.max(4, Math.min(options.nSlices ?? DEFAULT_N_SLICES, 60)))
        : buildReinhardTransform(sourceLabs, referenceLabs)
  const transform = (r: number, g: number, b: number): [number, number, number] => {
    const input = labToVector(rgbToLab(r, g, b))
    const mapped = baseTransform(input)
    const blended = addVectors(input, scaleVector(subtractVectors(mapped, input), strength))
    return labToRgb(vectorToLab(blended))
  }

  const lines = [
    'TITLE "Luna AI Reference Match"',
    `LUT_3D_SIZE ${gridSize}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ]
  for (let blue = 0; blue < gridSize; blue += 1) {
    for (let green = 0; green < gridSize; green += 1) {
      for (let red = 0; red < gridSize; red += 1) {
        const denominator = gridSize - 1
        const [outR, outG, outB] = transform(red / denominator, green / denominator, blue / denominator)
        lines.push(`${formatCubeValue(outR)} ${formatCubeValue(outG)} ${formatCubeValue(outB)}`)
      }
    }
  }

  return {
    cube: `${lines.join('\n')}\n`,
    stats: {
      sourceSamples: sourceLabs.length,
      referenceSamples: referenceLabs.length,
      gridSize,
      method,
    },
  }
}

export function imageBitmapToReferenceMatchImage(bitmap: ImageBitmap, maxSide = 640): ReferenceMatchImage {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法准备参考图画面')
  context.drawImage(bitmap, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  return { width, height, data: imageData.data }
}
