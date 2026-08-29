#!/usr/bin/env node
/**
 * 测试 Windows GPU 导出路径
 *
 * 用法: node scripts/test-gpu-export.mjs <视频路径> [--compatible] [--software]
 *
 * 测试内容:
 * 1. 加载 luna-render-core native addon
 * 2. 初始化 compositor（会打印 GPU adapter 和 backend 信息）
 * 3. 用源视频创建 composition
 * 4. 调用 exportCompositionVideoAsync（hardware=true）
 * 5. 检查输出文件是否有音频轨
 *
 * 日志输出到 test-output/luna-rc-test.log
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = join(__dirname, '..')
const _require = createRequire(import.meta.url)
process.env.APP_ROOT = root
const dxcPath = join(root, 'luna-render-core', process.platform === 'win32' ? 'dxcompiler.dll' : 'libdxcompiler.dylib')
if (existsSync(dxcPath)) process.env.LUNA_DXC_PATH = dxcPath

// ── FFmpeg/FFprobe 路径 ──
let ffmpeg, ffprobe
try {
  ffmpeg = _require.resolve('ffmpeg-static')
  ffmpeg = join(ffmpeg, '..', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const ffprobeStatic = _require.resolve('ffprobe-static/package.json')
  ffprobe = join(ffprobeStatic, '..', 'bin', process.platform, process.arch,
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
} catch {
  ffmpeg = 'ffmpeg'; ffprobe = 'ffprobe'
}

// ── 参数 ──
const inputPath = process.argv.find((value, index) => index > 1 && !value.startsWith('--'))
const softwareMode = process.argv.includes('--software')
const compatibleMode = process.argv.includes('--compatible')
if (!inputPath) {
  console.error('Usage: node scripts/test-gpu-export.mjs <video-path>')
  process.exit(1)
}
if (!existsSync(inputPath)) {
  console.error('File not found:', inputPath)
  process.exit(1)
}

// Keep the three test modes deterministic even when a developer has stale
// Windows export overrides in the parent shell.
if (process.platform === 'win32' && !softwareMode) {
  if (compatibleMode) {
    process.env.LUNA_WINDOWS_GPU_EXPORT_ENCODER = 'ffmpeg'
  } else {
    delete process.env.LUNA_WINDOWS_GPU_EXPORT_ENCODER
  }
  delete process.env.LUNA_WINDOWS_GPU_EXPORT_INPUT
} else {
  delete process.env.LUNA_WINDOWS_GPU_EXPORT_ENCODER
  delete process.env.LUNA_WINDOWS_GPU_EXPORT_INPUT
}

const outDir = join(root, 'test-output')
mkdirSync(outDir, { recursive: true })
const logPath = join(outDir, 'luna-rc-test.log')
const outputPath = join(outDir, 'test-gpu-export.mp4')

// 清理旧的日志和输出
try { rmSync(logPath) } catch {}
try { rmSync(outputPath) } catch {}
// 清理临时文件
for (const f of ['.test-gpu-export.mp4.', '.test-gpu-export.mp4.ffmpeg-fallback-partial.mp4',
  '.test-gpu-export.mp4.audio-mux-partial.mp4', '.test-gpu-export.mp4.win-gpu-partial.mp4']) {
  try { rmSync(join(outDir, f)) } catch {}
}

async function main() {
  console.log('══════════════════════════════════════════════')
  console.log('  GPU Export Test')
  console.log('══════════════════════════════════════════════')
  console.log('FFmpeg: ', ffmpeg)
  console.log('FFprobe:', ffprobe)
  console.log('Input:  ', inputPath)
  console.log('Output: ', outputPath)
  console.log('Log:    ', logPath)
  console.log('Platform:', process.platform, process.arch)

  // ── 1. Probe 源文件 ──
  console.log('\n── Step 1: Probe source ──')
  const { stdout: probeOut } = await execAsync(ffprobe, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath,
  ], { timeout: 10000 })
  const probe = JSON.parse(probeOut)
  const vs = probe.streams?.find(s => s.codec_type === 'video')
  const hasAudio = probe.streams?.some(s => s.codec_type === 'audio')
  if (!vs) { console.error('❌ No video stream'); process.exit(1) }
  console.log(`  Video: ${vs.width}x${vs.height} ${vs.codec_name} ${vs.duration}s`)
  const inputWidth = Number(vs.width)
  const inputHeight = Number(vs.height)
  const isUhd4K = Math.min(inputWidth, inputHeight) >= 2160
    && Math.max(inputWidth, inputHeight) >= 3840
  if (!isUhd4K) {
    console.error(`  4K gate failed: input must be at least 3840x2160, got ${inputWidth}x${inputHeight}`)
    process.exit(1)
  }
  console.log('  4K gate: UHD source accepted')
  console.log(`  Audio: ${hasAudio ? '✅ ' + probe.streams.find(s => s.codec_type === 'audio').codec_name : '❌ none'}`)

  // ── 2. Load Native Core ──
  console.log('\n── Step 2: Load luna-render-core ──')
  const nativePath = join(root, 'luna-render-core', 'luna-render-core.node')
  if (!existsSync(nativePath)) {
    console.error('❌ luna-render-core.node not found at', nativePath)
    console.error('   Run: cd luna-render-core && cargo build --release')
    process.exit(1)
  }
  const lrc = _require(nativePath)
  console.log('  Native exports:', Object.keys(lrc).join(', '))

  // 初始化 compositor（带独立日志文件）
  lrc.initCompositor(logPath)
  console.log('  Compositor initialized (log →', logPath + ')')

  // ── 3. Build composition ──
  console.log('\n── Step 3: Build composition ──')
  const duration = Math.min(parseFloat(vs.duration) || 5, 10) // 最多 10 秒
  const fps = 30
  const composition = {
    version: 1,
    canvas: { width: vs.width, height: vs.height, fps, duration },
    layers: [{
      id: 'layer-0',
      source: {
        path: inputPath,
        source_type: 'video',
        time: { offset: 0, start: 0, duration },
      },
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'cover',
      opacity: 1,
      z_index: 0,
    }],
  }
  console.log(`  Canvas: ${vs.width}x${vs.height} @ ${fps}fps, ${duration}s`)
  console.log(`  Layers: 1 (video)`)

  // ── 4. Export ──
  console.log(`\n── Step 4: Export (hardware=${!softwareMode}) ──`)
  const startTime = Date.now()
  let exportSuccess = true
  let exportError = null
  let winGpuSuccess = false
  const verificationIssues = []

  // 轮询进度
  const taskId = 'test-gpu-export'
  const progressInterval = setInterval(() => {
    const progress = lrc.getExportTaskProgress(taskId)
    if (progress) {
      const [current, total] = progress
      const c = Number(current), t = Number(total)
      const pct = t > 0 ? Math.round(c / t * 100) : 0
      process.stdout.write(`\r  Progress: ${c}/${t} frames (${pct}%)`)
    }
  }, 500)

  try {
    await lrc.exportCompositionVideoAsync({
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      outputPath,
      composition,
      fps,
      duration,
      hardware: !softwareMode,  // GPU or FFmpeg software baseline
      taskId,
      qualityPreset: 'high',
    })
    clearInterval(progressInterval)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n  ✅ Export completed in ${elapsed}s`)
  } catch (err) {
    clearInterval(progressInterval)
    exportSuccess = false
    exportError = err.message
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n  ❌ Export failed after ${elapsed}s: ${err.message}`)
  }

  // ── 5. 检查输出 ──
  console.log('\n── Step 5: Verify output ──')
  if (!existsSync(outputPath)) {
    console.log('  ❌ Output file does not exist!')
  } else {
    const stat = statSync(outputPath)
    console.log(`  File size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`)

    // 检查输出文件的流信息
    try {
      const { stdout: outProbe } = await execAsync(ffprobe, [
        '-v', 'quiet', '-print_format', 'json', '-show_streams', outputPath,
      ], { timeout: 10000 })
      const outInfo = JSON.parse(outProbe)
      const outVideo = outInfo.streams?.filter(s => s.codec_type === 'video')
      const outAudio = outInfo.streams?.filter(s => s.codec_type === 'audio')
      const outputVideo = outVideo?.[0]
      console.log(`  Video streams: ${outVideo?.length ?? 0} ${outVideo?.map(s => s.codec_name).join(',') ?? ''}`)
      console.log(`  Audio streams: ${outAudio?.length ?? 0} ${outAudio?.map(s => s.codec_name).join(',') ?? '❌ NO AUDIO'}`)
      if (!outputVideo) {
        verificationIssues.push('output has no video stream')
      } else if (Number(outputVideo.width) !== inputWidth || Number(outputVideo.height) !== inputHeight) {
        verificationIssues.push(`output dimensions changed from ${inputWidth}x${inputHeight} to ${outputVideo.width}x${outputVideo.height}`)
      } else {
        const reportedFrames = Number(outputVideo.nb_frames)
        const expectedFrames = Math.max(1, Math.round(duration * fps))
        if (Number.isFinite(reportedFrames) && reportedFrames > 0 && reportedFrames !== expectedFrames) {
          verificationIssues.push(`output frame count changed from ${expectedFrames} to ${reportedFrames}`)
        }
      }
      if (!outAudio?.length) {
        console.log('  ⚠️  Output has NO audio!')
      } else {
        console.log('  ✅ Output has audio')
      }

      // Decode every frame into a tiny RGB diagnostic thumbnail. The export
      // itself remains zero-copy; this independent verifier catches black or
      // missing frames anywhere in the 4K output, not just at frame zero.
      const readFrames = async (path) => {
        const { stdout } = await execAsync(ffmpeg, [
          '-v', 'error', '-i', path, '-map', '0:v:0', '-an',
          '-vf', 'scale=64:64', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
        ], { timeout: 30000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })
        const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
        const frameBytes = 64 * 64 * 3
        return Array.from({ length: Math.floor(bytes.length / frameBytes) }, (_, index) => (
          bytes.subarray(index * frameBytes, (index + 1) * frameBytes)
        ))
      }
      const [inputFrames, outputFrames] = await Promise.all([
        readFrames(inputPath),
        readFrames(outputPath),
      ])
      const expectedFrames = Math.max(1, Math.round(duration * fps))
      if (inputFrames.length !== expectedFrames) {
        verificationIssues.push(`input diagnostic frame count is ${inputFrames.length}, expected ${expectedFrames}`)
      }
      if (outputFrames.length !== expectedFrames) {
        verificationIssues.push(`output diagnostic frame count is ${outputFrames.length}, expected ${expectedFrames}`)
      }
      const frameCount = Math.min(inputFrames.length, outputFrames.length)
      const sampleIndices = [...new Set([
        0,
        Math.floor(Math.max(0, frameCount - 1) / 2),
        Math.max(0, frameCount - 1),
      ])]
      const mean = (bytes) => bytes.length
        ? [...bytes].reduce((sum, value) => sum + value, 0) / bytes.length
        : 0
      const frameStats = (bytes) => {
        const pixels = Math.floor(bytes.length / 3)
        const colors = new Map()
        const sums = [0, 0, 0]
        for (let index = 0; index < pixels; index += 1) {
          const offset = index * 3
          const color = [bytes[offset], bytes[offset + 1], bytes[offset + 2]]
          color.forEach((value, channel) => { sums[channel] += value })
          const key = color.join(',')
          colors.set(key, (colors.get(key) ?? 0) + 1)
        }
        let dominant = 0
        for (const count of colors.values()) dominant = Math.max(dominant, count)
        return {
          pixels,
          mean: sums.map((sum) => sum / Math.max(1, pixels)),
          uniqueColors: colors.size,
          dominantRatio: dominant / Math.max(1, pixels),
        }
      }
      const inputMeans = inputFrames.map(mean)
      const outputMeans = outputFrames.map(mean)
      const inputStats = inputFrames.map(frameStats)
      const outputStats = outputFrames.map(frameStats)
      const sampledInputMeans = sampleIndices.map(index => inputMeans[index] ?? 0)
      const sampledOutputMeans = sampleIndices.map(index => outputMeans[index] ?? 0)
      console.log(`  All-frame RGB diagnostics: input=${inputFrames.length} output=${outputFrames.length}`)
      console.log(`  Sampled RGB means: frames=${sampleIndices.join(',')} input=${sampledInputMeans.map(value => value.toFixed(2)).join(',')} output=${sampledOutputMeans.map(value => value.toFixed(2)).join(',')}`)
      if (inputStats[0] && outputStats[0]) {
        console.log(`  First-frame colors: input=${inputStats[0].uniqueColors} (dominant ${(inputStats[0].dominantRatio * 100).toFixed(1)}%) output=${outputStats[0].uniqueColors} (dominant ${(outputStats[0].dominantRatio * 100).toFixed(1)}%)`)
      }
      for (let index = 0; index < frameCount; index += 1) {
        if (!outputFrames[index].length) {
          verificationIssues.push(`output frame ${index} could not be decoded`)
        } else if (inputMeans[index] > 2 && outputMeans[index] <= 1) {
          verificationIssues.push(`output frame ${index} is effectively black`)
        } else if (inputStats[index].dominantRatio < 0.98 && outputStats[index].dominantRatio >= 0.98) {
          verificationIssues.push(`output frame ${index} is effectively a solid color`)
        }
      }
    } catch (e) {
      console.log('  ⚠️  Could not probe output:', e.message)
      verificationIssues.push(`output probe failed: ${e.message}`)
    }
  }

  // ── 6. 分析日志 ──
  console.log('\n── Step 6: Log analysis ──')
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, 'utf-8')
    const lines = log.split('\n')

    // 提取关键日志
    const gpuAdapter = lines.find(l => l.includes('GPU adapter:') || l.includes('GPU adapter selected:'))
    const winGpuStart = lines.filter(l => l.includes('[Export:WinGPU] automatic attempt'))
    const winGpuCompatible = lines.filter(l => l.includes('[Export:WinGPU] compatible path start'))
    const winGpuCpuReadback = lines.filter(l => l.includes('transport=cpu-readback'))
    const winGpuCapabilities = lines.filter(l => l.includes('[Export:WinGPU] capabilities'))
    const winGpuDecoder = lines.filter(l => l.includes('[Export:WinGPU] decoder=media-foundation'))
    const winGpuPipeline = lines.filter(l => l.includes('[Export:WinGPU] pipeline='))
    const winGpuCompleted = lines.filter(l => /\[Export:WinGPU\] completed\s*$/.test(l))
    const winGpuCompatibleCompleted = lines.filter(l => l.includes('[Export:WinGPU] completed via compatible hardware path'))
    const winGpuFallback = lines.filter(l => l.includes('[Export:WinGPU] unavailable'))
    const ffmpegFallback = lines.filter(l => l.includes('[Export:FFmpeg]'))
    const audioMux = lines.filter(l => l.includes('[Export:Audio]'))
    const encoderDetect = lines.filter(l => l.includes('编码器检测完成'))

    if (gpuAdapter) {
      const backend = gpuAdapter.match(/backend=(\w+)/)?.[1] ?? '?'
      console.log(`  GPU Backend: ${backend}`)
      if (backend === 'Dx12') {
        console.log('  ✅ D3D12 backend active')
      } else {
        console.log(`  ⚠️  Backend is ${backend}, not Dx12 — GPU export path will fail`)
      }
    } else if (process.platform === 'win32' && !softwareMode) {
      verificationIssues.push('missing GPU adapter diagnostic')
    }
    if (encoderDetect.length) {
      console.log(`  Encoder detect: ${encoderDetect.map(l => l.split(']').slice(1).join(']').trim()).join('; ')}`)
    }
    console.log(`  WinGPU native attempt: ${winGpuStart.length}`)
    console.log(`  WinGPU compatible CPU transport: ${winGpuCompatible.length}`)
    console.log(`  CPU readback frames: ${winGpuCpuReadback.length}`)
    if (winGpuCapabilities.length) {
      const capability = winGpuCapabilities[winGpuCapabilities.length - 1]
      const d3d11on12 = capability.match(/d3d11on12=(true|false)/)?.[1] ?? '?'
      const h264 = capability.match(/h264=(true|false)/)?.[1] ?? '?'
      const hevc = capability.match(/hevc=(true|false)/)?.[1] ?? '?'
      console.log(`  WinGPU capabilities: D3D11On12=${d3d11on12} H.264=${h264} HEVC=${hevc}`)
    }
    if (winGpuDecoder.length) {
      const decoder = winGpuDecoder[winGpuDecoder.length - 1]
      const output = decoder.match(/output=([^ ]+)/)?.[1] ?? '?'
      const size = decoder.match(/size=([^ ]+)/)?.[1] ?? '?'
      const sharing = decoder.match(/sharing=([^ ]+)/)?.[1] ?? '?'
      console.log(`  WinGPU decoder: Media Foundation ${output} ${size} sharing=${sharing}`)
    } else if (process.platform === 'win32' && winGpuStart.length) {
      console.log('  WinGPU decoder: not reached (see fallback reason)')
    }
    if (winGpuPipeline.length) {
      const pipeline = winGpuPipeline[winGpuPipeline.length - 1]
      const stages = pipeline.match(/pipeline=([^ ]+)/)?.[1] ?? '?'
      const sync = pipeline.match(/sync=([^ ]+)/)?.[1] ?? '?'
      const readback = pipeline.match(/readback=([^ ]+)/)?.[1] ?? '?'
      console.log(`  WinGPU pipeline: ${stages} sync=${sync} readback=${readback}`)
    }
    console.log(`  WinGPU completed: ${winGpuCompleted.length}`)
    console.log(`  WinGPU compatible completed: ${winGpuCompatibleCompleted.length}`)
    console.log(`  WinGPU fallback: ${winGpuFallback.length}`)
    if (winGpuFallback.length) {
      const reason = winGpuFallback[winGpuFallback.length - 1]
        .split(/falling back to (?:compatible path|FFmpeg):/)[1]?.trim()
      console.log(`  Fallback reason: ${reason}`)
    }
    console.log(`  FFmpeg fallback logs: ${ffmpegFallback.length}`)
    const usedCpuReadback = winGpuCompatible.length > 0 || winGpuCpuReadback.length > 0
    if (process.platform === 'win32' && !softwareMode) {
      const backend = gpuAdapter?.match(/backend=(\w+)/)?.[1]
      if (compatibleMode) {
        if (winGpuCompatible.length === 0) verificationIssues.push('compatible mode did not start the compatible path')
        if (winGpuCompatibleCompleted.length === 0) verificationIssues.push('compatible mode did not complete')
        if (!usedCpuReadback) verificationIssues.push('compatible mode did not report CPU transport')
      } else {
        const pipeline = winGpuPipeline[winGpuPipeline.length - 1] ?? ''
        if (backend !== 'Dx12') verificationIssues.push(`native backend is ${backend ?? '?'}, expected Dx12`)
        if (!lines.some(l => l.includes('selecting zero-copy path by default'))) verificationIssues.push('native mode was not selected by default')
        if (winGpuStart.length === 0) verificationIssues.push('native path was not attempted')
        if (winGpuCompleted.length === 0) verificationIssues.push('native path did not complete')
        if (winGpuFallback.length > 0) verificationIssues.push('native path fell back to another export path')
        if (winGpuCompatible.length > 0) verificationIssues.push('native log contains compatible path')
        if (winGpuCpuReadback.length > 0) verificationIssues.push('native log contains CPU readback transport')
        if (!/sync=d3d12-fence\b/.test(pipeline)) verificationIssues.push('native pipeline is missing d3d12-fence synchronization')
        if (!/readback=false\b/.test(pipeline)) verificationIssues.push('native pipeline is not marked readback=false')
        if (!lines.some(l => /encoder-transform .*hardware_url=true/.test(l))) verificationIssues.push('native encoder was not verified as hardware MFT')
        if (!lines.some(l => l.includes('interop adapter-luid'))) verificationIssues.push('missing interop adapter-luid diagnostic')
        if (!lines.some(l => l.includes('[Export:WinGPU:Timing]'))) verificationIssues.push('missing WinGPU timing diagnostic')
      }
      if (ffmpegFallback.length > 0) verificationIssues.push('FFmpeg fallback path was used')
    }
    winGpuSuccess = verificationIssues.length === 0
    console.log(`  Audio mux logs: ${audioMux.length}`)
    if (audioMux.length) {
      audioMux.forEach(l => console.log(`    ${l.split('] ').slice(1).join('] ')}`))
    }
  }

  // ── 总结 ──
  console.log('\n══════════════════════════════════════════════')
  const outputExists = existsSync(outputPath)
  if (!outputExists) verificationIssues.push('output file does not exist')
  if (!exportSuccess) verificationIssues.push(`export failed: ${exportError ?? 'unknown error'}`)
  if (verificationIssues.length) {
    console.log('  Verification issues:')
    verificationIssues.forEach(issue => console.log(`    - ${issue}`))
  }
  const testPassed = exportSuccess && outputExists && (process.platform !== 'win32' || winGpuSuccess)
  if (testPassed) {
    console.log(process.platform === 'win32' && !softwareMode
      ? compatibleMode
        ? '  ✅ TEST PASSED — compatible hardware export succeeded'
        : '  ✅ TEST PASSED — native WinGPU export succeeded without CPU readback'
      : '  ✅ TEST PASSED — Export succeeded')
  } else {
    console.log(process.platform === 'win32' && exportSuccess && outputExists
      ? '  ❌ TEST FAILED — Output exists, but WinGPU fell back to FFmpeg'
      : '  ❌ TEST FAILED — Export failed or no output')
    if (exportError) console.log('  Error:', exportError)
    process.exitCode = 1
  }
  console.log('══════════════════════════════════════════════')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
