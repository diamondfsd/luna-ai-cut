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
    // 使用 videotoolbox（不带 _vld）以便解码帧回传到 CPU 内存
    // 这样后续的 CPU overlay 滤镜可以正常工作
    // 如遇到 10-bit HEVC 源，_vld 输出格式会与 CPU 滤镜不兼容
    preInputArgs: ['-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox'],
    encoderNameH264: 'h264_videotoolbox',
    encoderNameH265: 'hevc_videotoolbox',
    encoderArgs: [],
    overlayFilter: 'overlay',
  }
}

function nvidiaCuda(): HwAccelConfig {
  return {
    type: 'cuda',
    preInputArgs: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
    encoderNameH264: 'h264_nvenc',
    encoderNameH265: 'hevc_nvenc',
    encoderArgs: ['-preset', 'p7', '-rc', 'vbr'],
    overlayFilter: 'overlay_cuda',
  }
}

function intelQsv(): HwAccelConfig {
  return {
    type: 'qsv',
    preInputArgs: ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'],
    encoderNameH264: 'h264_qsv',
    encoderNameH265: 'hevc_qsv',
    encoderArgs: ['-preset', '7'],
    overlayFilter: 'overlay_qsv',
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

async function detectWindowsHwAccel(ffmpegPath: string): Promise<HwAccelConfig> {
  try {
    const { stdout } = await execAsync(ffmpegPath, ['-encoders'], { timeout: 5000 })

    // NVIDIA CUDA — 最佳性能
    if (stdout.includes('h264_nvenc')) {
      return nvidiaCuda()
    }

    // Intel QuickSync
    if (stdout.includes('h264_qsv')) {
      return intelQsv()
    }

    // AMD AMF
    if (stdout.includes('h264_amf')) {
      return amdAmf()
    }

    // DXVA2 仅解码加速（任何 GPU 都支持）
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
    // macOS: VideoToolbox 几乎总是可用
    cachedConfig = macVideoToolbox()
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
