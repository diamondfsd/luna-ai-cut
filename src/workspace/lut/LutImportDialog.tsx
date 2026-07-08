import { useCallback, useRef, useState } from 'react'

import { Button, Dialog, Input, toast } from '../../ui'
import { lutManager } from './LutManager'

interface LutImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 导入成功后回调，传入导入的 LUT 路径 */
  onSuccess?: (lutPath: string) => void
}

/**
 * LUT 导入弹窗
 *
 * 1. 输入分组名称
 * 2. 选择 .cube 文件
 * 3. 复制到 {lutDir}/{分组名}/
 * 4. 刷新 LUT 列表
 */
export function LutImportDialog({ open, onOpenChange, onSuccess }: LutImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [category, setCategory] = useState('')
  const pendingCategoryRef = useRef('')

  /** 解析 lutDir，未配置时使用本地资源目录下的 luts */
  async function resolveLutDir(): Promise<string> {
    try {
      const s = await (window as any).luna?.getSettings?.()
      if (s?.lutDir) return s.lutDir
      if (s?.downloadDir) return `${s.downloadDir}/luts`
    } catch { /* ignore */ }
    return ''
  }

  /** 确认分组名 → 打开文件选择器 */
  const handleConfirm = useCallback(() => {
    const cat = category.trim()
    if (!cat) {
      toast.error('请输入分组名称')
      return
    }
    pendingCategoryRef.current = cat
    onOpenChange(false)
    // 用 setTimeout 确保 dialog 关闭后再打开文件选择器
    setTimeout(() => fileInputRef.current?.click(), 100)
  }, [category, onOpenChange])

  /** 选中文件后导入 */
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.cube')) {
      toast.error('请选择 .cube 格式的 LUT 文件')
      return
    }
    try {
      const filePath = (file as any).path
      if (!filePath) throw new Error('无法获取文件路径')
      const cat = pendingCategoryRef.current
      if (!cat) throw new Error('缺少分组名称')
      const lutDir = await resolveLutDir()
      if (!lutDir) throw new Error('未配置 LUT 目录，请先在设置中添加')

      // 通过 Rust 引擎导入到 LUT 目录
      const lrc = (window as unknown as { lunaRenderCore?: any }).lunaRenderCore
      await lrc.importCubeFile(filePath, cat, lutDir)

      // 重新扫描 LUT 列表
      const luts = await lutManager.discoverLuts(lutDir)
      const name = file.name.replace(/\.cube$/i, '')
      const imported = luts.find((l) => l.name === name && l.category === cat)
      if (imported) {
        onSuccess?.(imported.filePath)
      }
      toast.success(`已导入滤镜: ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onSuccess])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setCategory('')
  }, [onOpenChange])

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title="导入滤镜"
        description="请输入分组名称，滤镜将导入到该分组下。"
        footer={
          <>
            <Button variant="secondary" onClick={() => handleOpenChange(false)}>取消</Button>
            <Button variant="primary" onClick={handleConfirm}>选择文件</Button>
          </>
        }
      >
        <Input
          variant="pill"
          placeholder="例如：我的滤镜"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          autoFocus
          fullWidth
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
        />
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".cube"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  )
}
