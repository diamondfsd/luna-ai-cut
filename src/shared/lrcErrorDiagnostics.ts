export interface RenderInitFailure {
  summary: string
  detail: string
  retryLabel: string
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function trimIpcPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method ['"]lrc:init['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function describeRenderInitFailure(error: unknown): RenderInitFailure {
  const detail = trimIpcPrefix(errorText(error))
  const normalized = detail.toLowerCase()

  if (detail.includes('LRC_COMPATIBILITY_BLOCKED')) {
    return {
      summary: '上次预览组件未能正常启动，请重新检测。',
      detail,
      retryLabel: '重新检测',
    }
  }

  if (detail.includes('LRC_NATIVE_LOAD_FAILED')) {
    if (!detail.includes('[present]')) {
      return {
        summary: '预览组件文件不完整，请重新安装应用。',
        detail,
        retryLabel: '重新检测',
      }
    }
    if (/not a valid win32 application|不是有效的 win32 应用程序|code(?:=|:)193/.test(normalized)) {
      return {
        summary: '预览组件与当前 Windows 版本或系统类型不匹配，请重新安装正确版本。',
        detail,
        retryLabel: '重新检测',
      }
    }
    if (/procedure could not be found|找不到指定的程序|entry point/.test(normalized)) {
      return {
        summary: '预览组件版本不一致，请完整重新安装应用。',
        detail,
        retryLabel: '重新检测',
      }
    }
    if (/specified module could not be found|找不到指定的模块|code(?:=|:)126/.test(normalized)) {
      return {
        summary: 'Windows 缺少预览所需的运行组件。请安装或修复 Microsoft Visual C++ 2015-2022（x64）后重试。',
        detail,
        retryLabel: '安装后重新检测',
      }
    }
    return {
      summary: 'Windows 无法启动预览组件，请保留下面的诊断详情并联系开发者。',
      detail,
      retryLabel: '重新检测',
    }
  }

  if (/gpu|graphics|adapter|vulkan|direct3d|d3d|显卡|图形/.test(normalized)) {
    return {
      summary: '当前显卡驱动无法打开预览，请更新显卡驱动并重启电脑后再试。',
      detail,
      retryLabel: '更新驱动后重新检测',
    }
  }

  return {
    summary: '预览组件启动失败，请保留下面的诊断详情并联系开发者。',
    detail,
    retryLabel: '重新检测',
  }
}
