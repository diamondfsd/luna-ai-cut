import { FolderOpen, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { MediaGallery } from '../components/MediaGallery'
import { MediaLibraryCtx, useMediaLibraryController } from '../pages/useMediaLibraryController'
import type { AiSelectionPreset, AiSelectionPurpose, AiSelectionSource, AiSelectionTarget } from '../shared/types'
import { Button, ButtonGroup, Dialog, Input, Select } from '../ui'
import '../styles/library.css'
import '../workspace/components/WorkspaceImportDialog.css'

interface AiSelectionCreateDialogProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (source: AiSelectionSource, name?: string, options?: { preset: AiSelectionPreset; purpose: AiSelectionPurpose; target: AiSelectionTarget }) => Promise<void>
}

function groupTitle(group: string): string {
  if (group.includes('未知')) return group
  const date = new Date(`${group}T00:00:00`)
  const dateText = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return `${dateText} ${weekday}`
}

function pathName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

function generatedTaskName(count: number): string {
  const date = new Date()
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${count}个素材选片`
}

export function AiSelectionCreateDialog({ open, busy, onOpenChange, onCreate }: AiSelectionCreateDialogProps) {
  const controller = useMediaLibraryController('local')
  const [taskName, setTaskName] = useState('')
  const [taskNameEdited, setTaskNameEdited] = useState(false)
  const [directory, setDirectory] = useState('')
  const [preset, setPreset] = useState<AiSelectionPreset>('balanced')
  const [purpose, setPurpose] = useState<AiSelectionPurpose>('general')
  const [targetMode, setTargetMode] = useState<AiSelectionTarget['mode']>('preset')
  const [targetValue, setTargetValue] = useState('')

  useEffect(() => {
    if (!open) return
    setTaskName('')
    setTaskNameEdited(false)
    setDirectory('')
    setPreset('balanced')
    setPurpose('general')
    setTargetMode('preset')
    setTargetValue('')
    controller.setViewMode('download')
    controller.setSelected(new Set())
    void controller.loadDownloadedLibrary()
    // Only refresh the isolated library controller when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (controller.selectedFiles.length === 0) return
    setDirectory('')
  }, [controller.selectedFiles.length])

  const selectedLocalPaths = useMemo(() => controller.selectedFiles.flatMap((file) => {
    const filePath = file.localPath ?? file.downloadFilePath ?? file.cacheFilePath
    return filePath && (file.kind === 'image' || file.kind === 'video') ? [filePath] : []
  }), [controller.selectedFiles])

  const source = useMemo<AiSelectionSource | null>(() => {
    if (directory) return { kind: 'directory', label: pathName(directory), directory }
    if (selectedLocalPaths.length > 0) return { kind: 'files', label: `本地资源 ${selectedLocalPaths.length} 个素材`, paths: selectedLocalPaths }
    return null
  }, [directory, selectedLocalPaths])

  const selectionLabel = directory
    ? `已选择文件夹：${pathName(directory)}`
    : `已选择 ${selectedLocalPaths.length} 个`

  useEffect(() => {
    if (taskNameEdited) return
    const count = selectedLocalPaths.length
    if (count > 0) setTaskName(generatedTaskName(count))
    else if (!directory) setTaskName('')
  }, [directory, selectedLocalPaths.length, taskNameEdited])

  async function chooseDirectory(): Promise<void> {
    const value = await window.luna.aiSelection.chooseDirectory()
    if (!value) return
    controller.setSelected(new Set())
    setDirectory(value)
    if (!taskNameEdited) setTaskName(`${pathName(value)} 素材选片`)
  }

  async function create(): Promise<void> {
    if (!source || busy) return
    const numericTarget = Number(targetValue)
    const target: AiSelectionTarget = targetMode === 'preset'
      ? { mode: 'preset', value: null }
      : { mode: targetMode, value: targetMode === 'ratio' ? numericTarget / 100 : numericTarget }
    try {
      await onCreate(source, taskName, { preset, purpose, target })
      onOpenChange(false)
    } catch {
      // The task hook keeps the dialog open and reports the error.
    }
  }

  return <MediaLibraryCtx.Provider value={controller}>
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建选片任务"
      tone="dark"
      className="workspace-import-dialog ai-selection-create-dialog"
      footer={<>
        <span className="workspace-import-count">{selectionLabel}</span>
        <Button variant="secondary" size="compact" icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void chooseDirectory()}>选择文件夹</Button>
        <Button variant="secondary" size="compact" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="primary" size="compact" icon={<Plus size={14} />} disabled={!source || busy} onClick={() => void create()}>{busy ? '创建中' : '创建任务'}</Button>
      </>}
    >
      <div className="ai-selection-create-body">
        <div className="ai-selection-create-settings-panel">
          <label className="ai-selection-create-name"><span>任务名称</span><Input variant="pill" fullWidth value={taskName} onChange={(event) => { setTaskNameEdited(true); setTaskName(event.target.value) }} placeholder="选择素材后自动生成" /></label>
          <label><span>选片用途</span><Select variant="compact" fullWidth value={purpose} options={[{ value: 'general', label: '快速精选' }, { value: 'people', label: '人物照片' }, { value: 'travel', label: '旅行记录' }, { value: 'editing', label: '剪辑素材' }]} onValueChange={(value) => setPurpose(value as AiSelectionPurpose)} /></label>
          <label><span>建议数量</span><Select variant="compact" fullWidth value={preset} options={[{ value: 'quick', label: '少' }, { value: 'balanced', label: '适中' }, { value: 'deep', label: '多' }]} onValueChange={(value) => setPreset(value as AiSelectionPreset)} /></label>
          <label className="ai-selection-create-target"><span>选片目标</span><ButtonGroup value={targetMode} onChange={(value) => setTargetMode(value as AiSelectionTarget['mode'])} options={[{ value: 'preset', label: '自动' }, { value: 'count', label: '数量' }, { value: 'ratio', label: '比例' }]} />{targetMode !== 'preset' && <Input variant="compact" value={targetValue} onChange={(event) => setTargetValue(event.target.value.replace(/\D/g, ''))} placeholder={targetMode === 'count' ? '张/段' : '%'} />}</label>
        </div>
        <div className="workspace-import-body"><MediaGallery mode="local" groupTitle={groupTitle} /></div>
      </div>
    </Dialog>
  </MediaLibraryCtx.Provider>
}
