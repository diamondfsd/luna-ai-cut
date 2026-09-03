export type FileOperationKind = 'download' | 'export' | 'copy'

interface ErrorLike {
  code?: unknown
  errno?: unknown
  syscall?: unknown
  path?: unknown
  dest?: unknown
  message?: unknown
  stack?: unknown
  cause?: unknown
}

function asErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === 'object' ? value as ErrorLike : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  const message = asErrorLike(error)?.message
  return typeof message === 'string' && message ? message : String(error)
}

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current)) {
    seen.add(current)
    const item = asErrorLike(current)
    if (!item) break
    chain.push(item)
    current = item.cause
  }
  return chain
}

function firstErrorField(chain: ErrorLike[], field: keyof ErrorLike): string | undefined {
  for (const error of chain) {
    const value = stringValue(error[field])
    if (value) return value
  }
  return undefined
}

/** 将 Node、原生模块和 FFmpeg 的错误整理成可检索的日志字段。 */
export function fileOperationErrorDetails(error: unknown, fallbackPath?: string): Record<string, unknown> {
  const chain = errorChain(error)
  const outerMessage = errorMessage(error)
  const originalMessage = chain.length > 1 ? errorMessage(chain[chain.length - 1]) : outerMessage
  const details: Record<string, unknown> = {
    message: outerMessage,
    originalMessage,
    code: firstErrorField(chain, 'code'),
    errno: firstErrorField(chain, 'errno'),
    syscall: firstErrorField(chain, 'syscall'),
    path: firstErrorField(chain, 'path') ?? fallbackPath,
    dest: firstErrorField(chain, 'dest'),
    stack: error instanceof Error ? error.stack : undefined,
  }
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== ''))
}

function errorText(error: unknown): string {
  const directMessage = typeof error === 'string' ? error : ''
  return [directMessage, ...errorChain(error).map((item) => typeof item.message === 'string' ? item.message : '')]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase()
}

function errorCode(error: unknown): string {
  return (firstErrorField(errorChain(error), 'code') ?? '').toUpperCase()
}

function operationName(kind: FileOperationKind): string {
  if (kind === 'download') return '下载'
  if (kind === 'copy') return '复制'
  return '导出'
}

/** 将常见的 Windows/Node 文件错误转换成用户能直接处理的提示。 */
export function friendlyFileOperationError(error: unknown, kind: FileOperationKind): string {
  const code = errorCode(error)
  const text = errorText(error)
  const operation = operationName(kind)

  if (code === 'ENOSPC' || /no space left|not enough space|there is not enough space|disk is full|磁盘空间不足|空间不足/.test(text)) {
    return kind === 'download' ? '下载目录空间不足，请清理空间后重试' : `${operation}位置空间不足，请清理硬盘空间后重试`
  }
  if (code === 'EFBIG' || /file too large|file size limit|file size exceeds|size exceeds|maximum file size|exceeds? (?:the )?(?:maximum )?(?:file )?size|exceeds? the .*limit|too large for (?:the )?(?:destination )?file system|cannot be saved.*(?:size|large)|文件过大|单个文件.*4\s*gb/.test(text)) {
    return `${operation}文件超过目标硬盘格式的单文件大小限制，请将硬盘改为 NTFS 或 exFAT 格式后重试`
  }
  if (['EACCES', 'EPERM', 'EROFS'].includes(code) || /access is denied|access denied|permission denied|write protected|read.?only|写保护|拒绝访问|没有权限/.test(text)) {
    return kind === 'download' ? '下载目录不可写，请重新选择一个可用目录' : `${operation}位置不可写，请检查硬盘写保护和文件夹权限后重试`
  }
  if (['ENOENT', 'ENODEV', 'ENXIO', 'EIO'].includes(code) || /path not found|cannot find (?:the )?(?:path|file)|the system cannot find|device is not ready|device not ready|i\/o (?:device )?error|磁盘未连接|设备未就绪|路径不存在/.test(text)) {
    return kind === 'download' ? '下载目录不可用，请确认移动硬盘已连接后重试' : `${operation}位置不可用，请确认移动硬盘已连接且盘符未变化后重试`
  }
  if (code === 'EPIPE' || /broken pipe|输出管道.*断开|写入管道.*断开/.test(text)) {
    return `${operation}过程中目标硬盘停止响应，请检查硬盘连接和剩余空间后重试`
  }
  if (['EBUSY', 'ETXTBSY'].includes(code) || /sharing violation|resource busy|resource is busy|being used by another process|file is in use|文件被占用/.test(text)) {
    return `目标文件正在被其他程序占用，请关闭相关程序后重试`
  }
  if (code === 'ENAMETOOLONG' || /path too long|filename too long|路径过长|文件名过长/.test(text)) {
    return `目标路径或文件名过长，请换一个较短的文件夹名称后重试`
  }

  return errorMessage(error) || `${operation}失败，请检查目标硬盘后重试`
}

/** 将友好提示与原始错误关联，供上层日志继续提取错误码和系统调用。 */
export function userFacingFileOperationError(error: unknown, kind: FileOperationKind): Error {
  const message = friendlyFileOperationError(error, kind)
  if (error instanceof Error && error.message === message) return error
  const wrapped = new Error(message)
  Object.assign(wrapped, { cause: error })
  return wrapped
}
