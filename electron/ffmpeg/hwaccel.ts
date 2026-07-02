import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)

// ─── 硬件加速配置 ────────────────────────────────

export interface HwAccelConfig {
  /** 加速类型标识 */
  type: 'videotoolbox' | 'cuda' | 'qsv' | 'amf' | 'dxva2' | null
  /** 放在 -i 之前的解码参数（hwaccel 标志） */
  preInputArgs: string[]
  /** 硬件编码器名（h264 变体） */
  encoderNameH264: string
  /** 硬件编码器名（hevc 变体），null 表示不支持 */
  encoderNameH265: string | null
  /** 编码器额外参数（如 NVENC 的 preset） */
  encoderArgs: string[]
  /** 水印 overlay 滤镜名 */
  overlayFilter: string
}

// ─── 各平台默认值 ────────────────────────────────

function noAccel(): HwAccelConfig {
  return {
    type: null,
    preInputArgs: [],
    encoderNameH264: 'libx264',
    encoderNameH265: 'libx265',
    encoderArgs: [],
    overlayFilter: 'overlay',
  }
}

function macVideoToolbox(): HwAccelConfig {
  return {
    type: 'videotoolbox',
    // 仅使用 -hwaccel videotoolbox，不加 -hwaccel_output_format
    // 某些 ffmpeg 构建（如 tessus/evermeet.cx）不识别 videotoolbox 输出格式
    // 解码后自动回传 CPU 内存，CPU overlay 滤镜可正常工作
    preInputArgs: ['-hwaccel', 'videotoolbox'],
    encoderNameH264: 'h264_videotoolbox',
    encoderNameH265: 'hevc_videotoolbox',
    // -allow_sw 1 允许 VideoToolbox 在硬件不支持时软件回退
    // 例如 10-bit HEVC（yuv420p10le）在某些 Mac 上无法硬件编码
    // -realtime 1 关闭帧重排，编码速度提升 2-3x（代价是略大文件体积）
    encoderArgs: ['-allow_sw', '1', '-realtime', '1'],
    overlayFilter: 'overlay',
  }
}

/**
 * 快速探测 hevc_videotoolbox 是否实际可用
 *
 * 某些旧 Mac（macOS < 10.13 或旧款 Intel 硬件）不支持 HEVC 硬件编码，
 * 即使 ffmpeg 编译了 hevc_videotoolbox 编码器，
 * 底层 VideoToolbox 框架仍可能返回 kVTParameterErr (-12905)。
 *
 * @param ffmpegPath - ffmpeg 二进制路径
 * @returns true 如果 hevc_videotoolbox 可编码
 */
async function probeHevcVideoToolbox(ffmpegPath: string): Promise<boolean> {
  try {
    await execAsync(ffmpegPath, [
      '-hide_banner',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=1920x1080:d=0.5',
      '-c:v', 'hevc_videotoolbox',
      '-allow_sw', '1',
      '-pix_fmt', 'yuv420p',
      '-f', 'null', '-',
    ], { timeout: 10000 })
    return true
  } catch {
    return false
  }
}

function nvidiaCuda(): HwAccelConfig {
  return {
    type: 'cuda',
    // 不使用 -hwaccel_output_format cuda：解码帧回退到 CPU 内存，
    // 避免 overlay_cuda 在 10-bit/odd-size 视频上格式转换失败
    preInputArgs: ['-hwaccel', 'cuda'],
    encoderNameH264: 'h264_nvenc',
    encoderNameH265: 'hevc_nvenc',
    encoderArgs: ['-preset', 'p5', '-rc', 'vbr'],
    // 使用 CPU overlay，稳定性远高于 overlay_cuda
    overlayFilter: 'overlay',
  }
}

function intelQsv(): HwAccelConfig {
  return {
    type: 'qsv',
    // 不使用 -hwaccel_output_format qsv：解码帧回退到 CPU 内存，
    // 避免 overlay_qsv 在特定格式视频上转换失败
    preInputArgs: ['-hwaccel', 'qsv'],
    encoderNameH264: 'h264_qsv',
    encoderNameH265: 'hevc_qsv',
    encoderArgs: ['-preset', '7'],
    // 使用 CPU overlay，稳定性远高于 overlay_qsv
    overlayFilter: 'overlay',
  }
}

function amdAmf(): HwAccelConfig {
  return {
    type: 'amf',
    preInputArgs: ['-hwaccel', 'dxva2'],
    encoderNameH264: 'h264_amf',
    encoderNameH265: null,
    encoderArgs: ['-quality', 'quality', '-usage', 'ultralowlatency'],
    overlayFilter: 'overlay',
  }
}

function dxva2Only(): HwAccelConfig {
  return {
    type: 'dxva2',
    preInputArgs: ['-hwaccel', 'dxva2'],
    encoderNameH264: 'libx264',
    encoderNameH265: 'libx265',
    encoderArgs: [],
    overlayFilter: 'overlay',
  }
}

// ─── Windows 逐级探测 ────────────────────────────

/**
 * 验证硬件设备是否实际可用
 * ffmpeg 二进制可能编译了某个编码器，但当前机器不一定有对应硬件
 * 例如 Gyan.dev 的 Windows 构建包含所有编码器，但用户可能没有 NVIDIA 显卡
 */
async function probeHwDevice(ffmpegPath: string, deviceType: string): Promise<boolean> {
  try {
    await execAsync(ffmpegPath, [
      '-hide_banner',
      '-init_hw_device', deviceType,
      '-f', 'lavfi', '-i', 'color=c=black:s=2x2:d=0.1',
      '-f', 'null', '-',
    ], { timeout: 8000 })
    return true
  } catch {
    return false
  }
}

async function detectWindowsHwAccel(ffmpegPath: string): Promise<HwAccelConfig> {
  try {
    const { stdout } = await execAsync(ffmpegPath, ['-encoders'], { timeout: 5000 })

    // NVIDIA CUDA — 最佳性能（需要验证 CUDA 设备真的存在）
    if (stdout.includes('h264_nvenc') && await probeHwDevice(ffmpegPath, 'cuda')) {
      return nvidiaCuda()
    }

    // Intel QuickSync（需要验证 QSV 设备）
    if (stdout.includes('h264_qsv') && await probeHwDevice(ffmpegPath, 'qsv')) {
      return intelQsv()
    }

    // AMD AMF（需要验证 D3D11 设备）
    if (stdout.includes('h264_amf') && await probeHwDevice(ffmpegPath, 'd3d11va')) {
      return amdAmf()
    }

    // DXVA2 仅解码加速（任何 GPU 都支持，回退方案）
    return dxva2Only()
  } catch {
    return noAccel()
  }
}

// ─── 公开探测接口 ────────────────────────────────

let cachedConfig: HwAccelConfig | null = null

/**
 * 探测系统可用硬件加速能力
 *
 * - 首次调用会运行 `ffmpeg -encoders`（约 200ms），结果会缓存
 * - 建议在 app 初始化时或首次导出前调用
 * - 后续调用返回缓存结果
 *
 * @param ffmpegPath - ffmpeg 二进制路径（传入时才探测 Windows，否则返回 noAccel）
 */
export async function detectHardwareAccel(ffmpegPath?: string): Promise<HwAccelConfig> {
  if (cachedConfig) return cachedConfig

  const platform = process.platform

  if (platform === 'darwin') {
    cachedConfig = macVideoToolbox()
    // 验证 hevc_videotoolbox 是否真实可用
    // 旧 Mac（macOS < 10.13 或旧硬件）不支持 HEVC 硬件编码
    if (ffmpegPath && cachedConfig.encoderNameH265) {
      const hevcAvailable = await probeHevcVideoToolbox(ffmpegPath)
      if (!hevcAvailable) {
        console.warn('[hwaccel] hevc_videotoolbox not available, falling back to h264_videotoolbox for HEVC sources')
        // 使用 h264_videotoolbox 而非 libx265 软件编码（速度提升 10x+）
        // 代价是输出从 HEVC 变为 H.264，但旧硬件上这是最快的可用方案
        cachedConfig.encoderNameH265 = 'h264_videotoolbox'
      }
    }
    return cachedConfig
  }

  if (platform === 'win32') {
    if (!ffmpegPath) {
      cachedConfig = noAccel()
      return cachedConfig
    }
    cachedConfig = await detectWindowsHwAccel(ffmpegPath)
    return cachedConfig
  }

  cachedConfig = noAccel()
  return cachedConfig
}

/** 重置缓存（用于测试或 ffmpeg 路径变更） */
export function resetHwAccelCache(): void {
  cachedConfig = null
}
