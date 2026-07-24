import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, toast } from '../../ui'
import { lutManager } from './LutManager'
import './LutImportDialog.css'

/* ═══════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════ */

interface LutImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 导入成功后回调，传入导入的 LUT 路径 */
  onSuccess?: (lutPath: string) => void
}

interface ImportFileEntry {
  id: string
  file: File
  name: string
  displayName: string
  sourcePath: string
  status: 'ready' | 'duplicate' | 'error' | 'importing' | 'imported' | 'failed'
  statusText: string
  conflictAction: 'rename' | 'skip' | 'overwrite'
}

interface ImportResult {
  success: number
  failed: number
  skipped: number
}

/* ═══════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════ */

export function LutImportDialog({ open, onOpenChange, onSuccess }: LutImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  /* ── state ── */
  const [fileEntries, setFileEntries] = useState<ImportFileEntry[]>([])
  const [folderName, setFolderName] = useState('未分类')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [existingLutKeys, setExistingLutKeys] = useState<Set<string>>(new Set())

  /* ── derived ── */

  const importableCount = useMemo(
    () =>
      fileEntries.filter(
        (f) => f.status === 'ready' || (f.status === 'duplicate' && f.conflictAction !== 'skip'),
      ).length,
    [fileEntries],
  )

  const hasImportable = importableCount > 0

  /* ── resolve LUT dir ── */

  const resolveLutDir = useCallback(async (): Promise<string> => {
    try {
      const s = await (window as any).luna?.getSettings?.()
      if (s?.lutDir) return s.lutDir
      if (s?.downloadDir) return `${s.downloadDir}/luts`
    } catch { /* ignore */ }
    return ''
  }, [])

  /* ── discover existing LUT keys ── */

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const lutDir = await resolveLutDir()
      const luts = await lutManager.discoverLuts(lutDir || null)
      if (cancelled) return
      const keySet = new Set<string>()
      for (const lut of luts) {
        keySet.add(`${lut.category}/${lut.name}`)
      }
      setExistingLutKeys(keySet)
    })()
    return () => { cancelled = true }
  }, [open, resolveLutDir])

  /* ── reset on close ── */

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setFileEntries([])
        setFolderName('未分类')
        setImporting(false)
        setImportResult(null)
        dragCounterRef.current = 0
        setIsDragOver(false)
      }, 300)
      return () => clearTimeout(t)
    }
  }, [open])

  /* ── analyze a single file ── */

  const analyzeFile = useCallback(
    (file: File): ImportFileEntry | null => {
      if (!file.name.toLowerCase().endsWith('.cube')) {
        return {
          id: crypto.randomUUID(),
          file,
          name: file.name,
          displayName: file.name.replace(/\.cube$/i, ''),
          sourcePath: (file as any).path || file.name,
          status: 'error',
          statusText: '不支持的文件格式',
          conflictAction: 'skip',
        }
      }

      const nameWithoutExt = file.name.replace(/\.cube$/i, '')
      const lookupKey = `${folderName}/${nameWithoutExt}`
      const isDuplicate = existingLutKeys.has(lookupKey)

      return {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        displayName: nameWithoutExt,
        sourcePath: (file as any).path || file.name,
        status: isDuplicate ? 'duplicate' : 'ready',
        statusText: isDuplicate ? '重复名称' : '正常',
        conflictAction: isDuplicate ? 'rename' : 'overwrite',
      }
    },
    [folderName, existingLutKeys],
  )

  /* ── add files ── */

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.cube'))
      if (files.length === 0) {
        toast.show('未找到 .cube 文件')
        return
      }

      const currentNames = new Set(fileEntries.map((e) => e.name))
      const newEntries: ImportFileEntry[] = []

      for (const file of files) {
        if (currentNames.has(file.name)) continue
        const entry = analyzeFile(file)
        if (entry) newEntries.push(entry)
      }

      if (newEntries.length === 0) {
        toast.show('文件已在列表中')
        return
      }

      setFileEntries((prev) => [...prev, ...newEntries])
    },
    [fileEntries, analyzeFile],
  )

  /* ── drag & drop ── */

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items?.length) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false) }
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounterRef.current = 0
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  /* ── file input ── */

  const handleBrowseClick = () => fileInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    addFiles(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /* ── editable display name ── */

  const handleDisplayNameChange = useCallback((fileId: string, value: string) => {
    setFileEntries((prev) =>
      prev.map((e) => (e.id === fileId ? { ...e, displayName: value } : e)),
    )
  }, [])

  /* ── remove file ── */

  const handleRemoveFile = useCallback((fileId: string) => {
    setFileEntries((prev) => prev.filter((e) => e.id !== fileId))
  }, [])

  /* ── import ── */

  const handleImport = useCallback(async () => {
    if (importing || !fileEntries.length) return

    if (!folderName.trim()) {
      toast.error('请输入文件夹名称')
      return
    }

    setImporting(true)
    setImportResult(null)

    const lutDir = await resolveLutDir()
    if (!lutDir) { toast.error('未配置 LUT 目录'); setImporting(false); return }

    const lrc = (window as unknown as { lunaRenderCore?: any }).lunaRenderCore
    if (!lrc) { toast.error('渲染引擎未就绪'); setImporting(false); return }

    const toImport = fileEntries.filter(
      (f) => f.status === 'ready' || (f.status === 'duplicate' && f.conflictAction !== 'skip'),
    )

    let successCount = 0
    let failedCount = 0
    let lastImportedPath = ''

    for (const entry of toImport) {
      setFileEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, status: 'importing', statusText: '导入中...' } : e)),
      )

      try {
        const sourcePath = (entry.file as any).path
        if (!sourcePath) throw new Error('无法获取文件路径')

        // 如果显示名与原始文件名不同，用显示名作为目标名称
        const originalBase = entry.name.replace(/\.cube$/i, '')
        let targetName: string | undefined
        if (entry.displayName !== originalBase) {
          targetName = entry.displayName
        } else if (entry.status === 'duplicate' && entry.conflictAction === 'rename') {
          targetName = `${originalBase}_${Date.now()}`
        }

        const result = await lrc.importCubeFile(sourcePath, folderName, lutDir, targetName, {
          name: entry.displayName,
        })
        lastImportedPath = result.path

        setFileEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, status: 'imported', statusText: '已导入' } : e)),
        )
        successCount++
      } catch {
        setFileEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, status: 'failed', statusText: '导入失败' } : e,
          ),
        )
        failedCount++
      }
    }

    const skippedCount = fileEntries.filter((f) => f.status === 'duplicate' && f.conflictAction === 'skip').length

    setImportResult({ success: successCount, failed: failedCount, skipped: skippedCount })
    setImporting(false)

    if (successCount > 0) {
      toast.success(`成功导入 ${successCount} 个 LUT`)
      if (lastImportedPath) {
        lutManager.clearCache()
        await lutManager.discoverLuts(lutDir)
        onSuccess?.(lastImportedPath)
      }
    }
    if (failedCount > 0) toast.error(`${failedCount} 个 LUT 导入失败`)
  }, [importing, fileEntries, folderName, resolveLutDir, onSuccess])

  /* ── render ── */

  const statusIcon = (s: ImportFileEntry['status']) => {
    const map: Record<string, string> = {
      ready: 'success', imported: 'success', duplicate: 'duplicate',
      error: 'danger', failed: 'danger', importing: 'importing',
    }
    const label: Record<string, string> = {
      ready: '✓', imported: '✓', duplicate: '!', error: '×', failed: '×', importing: '◌',
    }
    return <span className={`lut-import-status-icon ${map[s] || ''}`}>{label[s] || ''}</span>
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="批量导入 LUT"
      className="lut-import-dialog-content"
      footer={
        <div className="lut-import-footer">
          <div className="lut-import-summary">
            {importResult ? (
              <>
                导入完成：
                <span className="success">{importResult.success}</span> 个成功
                {importResult.failed > 0 && <>，<span className="danger">{importResult.failed}</span> 个失败</>}
                {importResult.skipped > 0 && <>，<span className="muted">{importResult.skipped}</span> 个跳过</>}
              </>
            ) : fileEntries.length > 0 ? (
              <>
                已选择 <span className="highlight">{fileEntries.length}</span> 个，
                <span className="success">{importableCount}</span> 个可导入
              </>
            ) : (
              <span className="muted">暂未选择文件</span>
            )}
          </div>
          <div className="lut-import-footer-actions">
            <Button variant="secondary" size="compact" onClick={() => onOpenChange(false)} disabled={importing}>
              {importResult ? '关闭' : '取消'}
            </Button>
            {hasImportable && !importResult && (
              <Button variant="primary" size="compact" onClick={handleImport} disabled={importing}>
                {importing ? '导入中...' : `导入 ${importableCount} 个`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="lut-import-body">
        {/* ═══ 选择区域 ── 拖拽或点击选择文件 ═══ */}
        <div
          className={`lut-import-drop-zone ${isDragOver ? 'drag-over' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
        >
          <div className="lut-import-folder-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </div>
          <div className="lut-import-drop-title">
            {isDragOver ? '松开以导入' : '拖拽 LUT 文件到这里'}
          </div>
          <button className="lut-import-link-btn" onClick={(e) => { e.stopPropagation(); handleBrowseClick() }}>
            或点击选择文件
          </button>
          <div className="lut-import-drop-help">支持 .cube 文件，可批量拖拽</div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".cube"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* ═══ 中间区域 ── 文件夹名称 ═══ */}
        <div className="lut-import-folder-row">
          <label className="lut-import-folder-label">文件夹名称</label>
          <div className="lut-import-folder-input-wrap">
            <input
              className="lut-import-folder-input"
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="例如：Fuji、Leica、我的滤镜"
            />
            <span className="lut-import-folder-note">
              导入后将在 LUT 目录下创建此文件夹
            </span>
          </div>
        </div>

        {/* ═══ 展示区域 ── 文件表格（可编辑名称） ═══ */}
        {fileEntries.length > 0 && (
          <div className="lut-import-table-wrap">
            <div className="lut-import-table">
              <div className="lut-import-table-header">
                <div>名称</div>
                <div>原始文件</div>
                <div>状态</div>
                <div></div>
              </div>
              <div className="lut-import-table-body">
                {fileEntries.map((entry) => (
                  <div key={entry.id} className="lut-import-table-row">
                    {/* 可编辑的名称 */}
                    <div className="lut-import-name-cell">
                      <input
                        className="lut-import-name-input"
                        type="text"
                        value={entry.displayName}
                        onChange={(e) => handleDisplayNameChange(entry.id, e.target.value)}
                        disabled={importing || entry.status === 'imported'}
                      />
                    </div>
                    {/* 原始文件名 */}
                    <div className="lut-import-origin-cell">
                      <span className="lut-import-origin-name">{entry.name}</span>
                    </div>
                    {/* 状态 */}
                    <div className="lut-import-status-cell">
                      {statusIcon(entry.status)}
                      <span className={`status-text ${entry.status === 'ready' || entry.status === 'imported' ? 'success' : entry.status === 'duplicate' ? 'duplicate' : 'danger'}`}>
                        {entry.statusText}
                      </span>
                    </div>
                    {/* 操作 */}
                    <div className="lut-import-action-cell">
                      {!importing && entry.status !== 'imported' && entry.status !== 'importing' && (
                        <button className="lut-import-remove-btn" onClick={() => handleRemoveFile(entry.id)} title="移除">
                          ×
                        </button>
                      )}
                      {entry.status === 'imported' && (
                        <span className="lut-import-check-mark">✓</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
