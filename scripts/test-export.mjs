#!/usr/bin/env node
/**
 * 直接测试 runExport（不经过 Worker）
 * 用法: node scripts/test-export.mjs <图片路径>
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')
const _require = createRequire(import.meta.url)
process.env.APP_ROOT = root

// FFmpeg 路径
let ffmpeg, ffprobe
try {
  ffmpeg = _require.resolve('ffmpeg-static')
  ffmpeg = join(ffmpeg, '..', 'ffmpeg')
  const ffprobeStatic = _require.resolve('ffprobe-static/package.json')
  ffprobe = join(ffprobeStatic, '..', 'bin', process.platform, process.arch, 'ffprobe')
} catch (e) {
  ffmpeg = 'ffmpeg'; ffprobe = 'ffprobe'
}

const inputPath = process.argv[2]
if (!inputPath) { console.error('Usage: node scripts/test-export.mjs <path>'); process.exit(1) }
if (!existsSync(inputPath)) { console.error('File not found:', inputPath); process.exit(1) }

console.log('FFmpeg:', ffmpeg)
console.log('Input:', inputPath)
console.log('APP_ROOT:', root)

const outDir = join(root, 'test-output')
mkdirSync(outDir, { recursive: true })

// 直接调 runExport
async function main() {
  // 模拟 runExport 的核心逻辑
  const { spawn } = await import('node:child_process')

  // 1. 用 ffprobe 获取尺寸
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(execFile)

  console.log('\n1. Probing...')
  const { stdout } = await execAsync(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_streams', inputPath], { timeout: 10000 })
  const info = JSON.parse(stdout)
  const vs = info.streams?.find(s => s.codec_type === 'video')
  if (!vs) { console.error('No video stream'); process.exit(1) }
  const w = vs.width, h = vs.height
  console.log(`   Size: ${w}x${h}`)

  // 2. 解码图片
  console.log('\n2. Decoding...')
  const rgba = await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-i', inputPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-vframes', '1', 'pipe:1', '-loglevel', 'error'])
    const chunks = []
    proc.stdout.on('data', c => chunks.push(c))
    proc.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}`)))
    proc.on('error', reject)
  })
  console.log(`   RGBA: ${rgba.length} bytes (expected ${w*h*4})`)

  // 3. Native Core renderFrame
  console.log('\n3. Loading Native Core...')
  let lrc
  try {
    lrc = _require(join(root, 'luna-render-core', 'luna-render-core.node'))
    console.log('   exports:', Object.keys(lrc))
    lrc.initCompositor()
    console.log('   init OK')

    const texId = lrc.loadTexture(rgba, w, h)
    console.log(`   texture id: ${texId}`)

    const result = lrc.renderFrame(w, h, [
      { textureId: texId, dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1, zIndex: 0 },
    ])
    console.log(`   rendered: ${result.length} bytes`)

    // 4. 编码输出
    console.log('\n4. Encoding...')
    const outPath = join(outDir, 'test_output.png')
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', outPath, '-y', '-loglevel', 'error'])
      proc.stdin.write(result)
      proc.stdin.end()
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)))
      proc.on('error', reject)
    })
    console.log(`   Output: ${outPath}`)
    console.log(`   Exists: ${existsSync(outPath)}`)

    lrc.releaseTexture(texId)
    lrc.destroyCompositor()
    console.log('\n✅ SUCCESS')
  } catch (err) {
    console.error('\n❌ FAILED:', err.message)
    process.exit(1)
  }
}

main()
