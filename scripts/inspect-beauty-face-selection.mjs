import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const supportRoot = path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'luna-ai-cut', 'models')
const inputPath = process.argv[2]
const outputRoot = path.resolve(process.argv[3] ?? path.join(repositoryRoot, 'test-results', 'beauty-face-selection'))
if (!inputPath) throw new Error('用法: node scripts/inspect-beauty-face-selection.mjs <图片路径> [输出目录]')

const ffmpegPath = require('ffmpeg-static')
const workerPath = path.join(repositoryRoot, 'luna-render-core', 'specialized-segmentation-worker')
const detectorPath = path.join(supportRoot, 'ultraface-rfb-320', 'model.onnx')
const parserPath = process.env.LUNA_FACE_PARSER_MODEL_PATH
  ? path.resolve(process.env.LUNA_FACE_PARSER_MODEL_PATH)
  : path.join(supportRoot, 'face-parsing-resnet18', 'model.onnx')
const parserModelId = process.env.LUNA_FACE_PARSER_MODEL_ID ?? path.basename(parserPath)
const inputSize = 640
const parseSize = 512
const colors = [
  [0, 0, 0], [204, 0, 0], [76, 153, 0], [204, 204, 0], [51, 51, 255],
  [204, 0, 204], [0, 255, 255], [255, 204, 204], [102, 51, 0], [255, 0, 0],
  [102, 204, 0], [255, 255, 0], [0, 0, 153], [0, 0, 204], [255, 51, 153],
  [0, 204, 204], [0, 51, 0], [255, 153, 51], [0, 204, 0],
]

function workerArgs(backend, modelPath, sourcePath, destinationPath, width, height, padX, padY, outputSize) {
  return [backend, modelPath, sourcePath, destinationPath, String(width), String(height), String(padX), String(padY), String(outputSize)]
}

function imageLayout(rgb) {
  let minX = inputSize
  let minY = inputSize
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < inputSize; y += 1) {
    for (let x = 0; x < inputSize; x += 1) {
      const offset = (y * inputSize + x) * 3
      if (rgb[offset] === 0x72 && rgb[offset + 1] === 0x72 && rgb[offset + 2] === 0x72) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('无法确定图片有效区域')
  return { scaledWidth: maxX - minX + 1, scaledHeight: maxY - minY + 1, padX: minX, padY: minY }
}

function cropFace(rgb, face, layout) {
  const centerX = layout.padX + (face.x + face.width / 2) * layout.scaledWidth
  const centerY = layout.padY + (face.y + face.height / 2) * layout.scaledHeight
  const side = Math.max(face.width * layout.scaledWidth, face.height * layout.scaledHeight) * 1.65
  const cropX = centerX - side / 2
  const cropY = centerY - side * 0.44
  const output = Buffer.alloc(parseSize * parseSize * 3)
  for (let y = 0; y < parseSize; y += 1) {
    const sourceY = Math.max(0, Math.min(inputSize - 1, Math.round(cropY + (y + 0.5) / parseSize * side)))
    for (let x = 0; x < parseSize; x += 1) {
      const sourceX = Math.max(0, Math.min(inputSize - 1, Math.round(cropX + (x + 0.5) / parseSize * side)))
      const sourceOffset = (sourceY * inputSize + sourceX) * 3
      const targetOffset = (y * parseSize + x) * 3
      rgb.copy(output, targetOffset, sourceOffset, sourceOffset + 3)
    }
  }
  return { rgb: output, x: cropX, y: cropY, side }
}

function ppm(rgb) {
  return Buffer.concat([Buffer.from(`P6\n${parseSize} ${parseSize}\n255\n`), rgb])
}

function pgm(bytes) {
  return Buffer.concat([Buffer.from(`P5\n${parseSize} ${parseSize}\n255\n`), bytes])
}

await mkdir(outputRoot, { recursive: true })
const decodedPath = path.join(outputRoot, 'source-640.rgb')
await execFileAsync(ffmpegPath, [
  '-v', 'error', '-y', '-i', inputPath, '-frames:v', '1',
  '-vf', `scale=${inputSize}:${inputSize}:force_original_aspect_ratio=decrease:flags=bilinear,pad=${inputSize}:${inputSize}:(ow-iw)/2:(oh-ih)/2:color=0x727272`,
  '-pix_fmt', 'rgb24', '-f', 'rawvideo', decodedPath,
])
const rgb = await readFile(decodedPath)
const layout = imageLayout(rgb)
const boxesPath = path.join(outputRoot, 'face-boxes.bin')
await execFileAsync(workerPath, workerArgs(
  'ultraface-boxes', detectorPath, decodedPath, boxesPath,
  layout.scaledWidth, layout.scaledHeight, layout.padX, layout.padY, 64,
))
const boxes = await readFile(boxesPath)
const faces = Array.from({ length: 16 }, (_, index) => ({
  x: boxes.readFloatLE(index * 16),
  y: boxes.readFloatLE(index * 16 + 4),
  width: boxes.readFloatLE(index * 16 + 8),
  height: boxes.readFloatLE(index * 16 + 12),
})).filter((face) => face.x >= 0 && face.y >= 0 && face.width > 0 && face.height > 0)
faces.sort((left, right) => right.width * right.height - left.width * left.height)
if (faces.length === 0) throw new Error('没有检测到人脸')

const crop = cropFace(rgb, faces[0], layout)
const cropRgbPath = path.join(outputRoot, 'face-crop.rgb')
await writeFile(cropRgbPath, crop.rgb)
await writeFile(path.join(outputRoot, 'face-crop.ppm'), ppm(crop.rgb))
const labelsPath = path.join(outputRoot, 'face-labels.bin')
await execFileAsync(workerPath, workerArgs(
  'face-parsing', parserPath, cropRgbPath, labelsPath,
  parseSize, parseSize, 0, 0, parseSize,
))
const labels = await readFile(labelsPath)
const labelRgb = Buffer.alloc(parseSize * parseSize * 3)
const classes = []
for (let classId = 0; classId < 19; classId += 1) {
  const mask = Buffer.alloc(parseSize * parseSize)
  let count = 0
  let minX = parseSize
  let minY = parseSize
  let maxX = -1
  let maxY = -1
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] !== classId) continue
    mask[index] = 255
    count += 1
    const x = index % parseSize
    const y = Math.floor(index / parseSize)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const color = colors[classId]
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] !== classId) continue
    labelRgb[index * 3] = color[0]
    labelRgb[index * 3 + 1] = color[1]
    labelRgb[index * 3 + 2] = color[2]
  }
  await writeFile(path.join(outputRoot, `class-${String(classId).padStart(2, '0')}.pgm`), pgm(mask))
  classes.push({ classId, count, bounds: count > 0 ? { minX, minY, maxX, maxY } : null })
}
await writeFile(path.join(outputRoot, 'face-labels.ppm'), ppm(labelRgb))
await writeFile(path.join(outputRoot, 'metadata.json'), `${JSON.stringify({ inputPath, parserModelId, parserPath, layout, faces, crop: { x: crop.x, y: crop.y, side: crop.side }, classes }, null, 2)}\n`)
console.log(outputRoot)
