import { File, FilePlus2, Folder, FolderPlus, Smartphone, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

import type { LocalMediaShareEntry, LocalMediaShareStatus } from '../shared/types'
import { Alert, Button, Dialog, IconButton, LoadingIndicator, Tooltip, toast } from '../ui'
import './SendToPhoneDialog.css'

const EMPTY_STATUS: LocalMediaShareStatus = {
  running: false,
  address: null,
  port: null,
  url: null,
  qrDataUrl: null,
  localCount: 0,
  exportCount: 0,
  customCount: 0,
  sharedFileCount: 0,
  startedAt: null,
}

type SharePhase = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export function SendToPhoneDialog() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LocalMediaShareStatus>(EMPTY_STATUS)
  const [phase, setPhase] = useState<SharePhase>('idle')
  const [error, setError] = useState('')
  const [sharedEntries, setSharedEntries] = useState<LocalMediaShareEntry[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const operationRef = useRef(0)
  const startingRef = useRef(false)

  useEffect(() => {
    void window.luna.localMediaShare.getStatus().then((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.running) setPhase('running')
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    void window.luna.localMediaShare.getEntries().then(setSharedEntries).catch(() => undefined)
  }, [])

  async function refreshSharedEntries(): Promise<void> {
    setSharedEntries(await window.luna.localMediaShare.getEntries())
  }

  const startSharing = useCallback(async (forceRestart = false) => {
    if (startingRef.current) return
    startingRef.current = true
    const operation = ++operationRef.current
    setPhase('starting')
    setError('')
    try {
      const current = await window.luna.localMediaShare.getStatus()
      const nextStatus = current.running && !forceRestart ? current : await window.luna.localMediaShare.start()
      if (operation !== operationRef.current) return
      if (!nextStatus.running || !nextStatus.qrDataUrl) throw new Error('二维码生成失败，请重试')
      setStatus(nextStatus)
      setPhase('running')
    } catch (reason) {
      if (operation !== operationRef.current) return
      setStatus(EMPTY_STATUS)
      setError(reason instanceof Error ? reason.message : '无法开启发送，请检查当前网络')
      setPhase('error')
    } finally {
      startingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (phase !== 'running') return
    const timer = window.setInterval(() => {
      void window.luna.localMediaShare.getStatus().then((nextStatus) => {
        setStatus(nextStatus)
        if (!nextStatus.running) {
          setError('当前网络已发生变化，请重新开启发送')
          setPhase('error')
        }
      }).catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [phase])

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) void startSharing()
  }

  async function stopSharing(): Promise<void> {
    const operation = ++operationRef.current
    setPhase('stopping')
    try {
      await window.luna.localMediaShare.stop()
      if (operation !== operationRef.current) return
      setStatus(EMPTY_STATUS)
      setOpen(false)
      setPhase('idle')
    } catch {
      if (operation !== operationRef.current) return
      setPhase('running')
      toast.error('无法停止发送，请重试')
    }
  }

  async function chooseShareDirectories(): Promise<void> {
    try {
      await window.luna.localMediaShare.chooseDirectories()
      await refreshSharedEntries()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '共享目录更新失败')
    }
  }

  async function removeShareDirectory(directory: string): Promise<void> {
    try {
      await window.luna.localMediaShare.removeDirectory(directory)
      await refreshSharedEntries()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '共享目录更新失败')
    }
  }

  async function chooseShareFiles(): Promise<void> {
    try {
      const nextStatus = await window.luna.localMediaShare.chooseFiles()
      if (!nextStatus) return
      setStatus(nextStatus)
      await refreshSharedEntries()
      toast.success(`已记住 ${nextStatus.sharedFileCount} 个共享文件`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '共享文件更新失败')
    }
  }

  async function addDroppedFiles(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    setDraggingFiles(false)
    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => Boolean(filePath))
    if (filePaths.length === 0) {
      toast.error('请将文件拖到此处')
      return
    }
    try {
      const nextStatus = await window.luna.localMediaShare.addFiles(filePaths)
      setStatus(nextStatus)
      await refreshSharedEntries()
      toast.success(`已共享 ${filePaths.length} 个文件`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '共享文件失败')
    }
  }

  function handleFilesDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDraggingFiles(true)
  }

  function handleFilesDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingFiles(true)
  }

  function handleFilesDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false)
  }

  async function removeShareFile(filePath: string): Promise<void> {
    try {
      const nextStatus = await window.luna.localMediaShare.removeFile(filePath)
      setStatus(nextStatus)
      await refreshSharedEntries()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '共享文件更新失败')
    }
  }

  const totalCount = status.localCount + status.exportCount + status.customCount + status.sharedFileCount
  const running = phase === 'running' && status.running && Boolean(status.qrDataUrl)

  return (
    <>
      <Tooltip content="发送到手机">
        <IconButton
          variant="ghost"
          size="mini"
          className="send-to-phone-trigger"
          data-running={status.running ? 'true' : undefined}
          icon={<Smartphone size={16} />}
          aria-label="发送到手机"
          aria-pressed={status.running}
          onClick={() => handleOpenChange(true)}
        />
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title="发送到手机"
        description="手机与电脑连接同一局域网后，扫描二维码即可浏览和下载资源。"
        className="send-to-phone-dialog"
        footer={running ? (
          <Button
            variant="danger"
            size="compact"
            icon={<Square size={13} />}
            onClick={() => void stopSharing()}
          >
            停止发送
          </Button>
        ) : phase === 'error' ? (
          <Button variant="primary" size="compact" onClick={() => void startSharing()}>重新开启</Button>
        ) : null}
      >
        <div className="send-to-phone-body" aria-live="polite">
          {running ? (
            <div className="send-to-phone-layout">
              <div className="send-to-phone-qr-panel">
                <img className="send-to-phone-qr" src={status.qrDataUrl!} alt="发送到手机二维码" />
                <strong>使用手机扫描二维码</strong>
                <span>{totalCount} 个资源</span>
              </div>
              <div className="send-to-phone-share-panel">
                <div className="send-to-phone-share-heading">
                  <strong>共享内容</strong>
                  <span>拖动文件到列表中也可以共享</span>
                </div>
                <div
                  className="send-to-phone-directories"
                  data-dragging={draggingFiles ? 'true' : undefined}
                  onDragEnter={handleFilesDragEnter}
                  onDragOver={handleFilesDragOver}
                  onDragLeave={handleFilesDragLeave}
                  onDrop={(event) => void addDroppedFiles(event)}
                >
                  {sharedEntries.length > 0 ? sharedEntries.map((entry) => (
                    <div className="send-to-phone-directory" key={`${entry.kind}:${entry.path}`}>
                      {entry.kind === 'directory' ? <Folder size={13} aria-hidden="true" /> : <File size={13} aria-hidden="true" />}
                      <span title={entry.path}>{entry.name}</span>
                      <Tooltip content={`移除${entry.kind === 'directory' ? '共享文件夹' : '共享文件'}`}>
                        <IconButton
                          variant="ghost"
                          size="mini"
                          icon={<Trash2 size={14} />}
                          aria-label={`移除${entry.kind === 'directory' ? '共享文件夹' : '共享文件'} ${entry.name}`}
                          onClick={() => void (entry.kind === 'directory' ? removeShareDirectory(entry.path) : removeShareFile(entry.path))}
                        />
                      </Tooltip>
                    </div>
                  )) : <em className="send-to-phone-directory-empty">暂未添加共享文件或文件夹</em>}
                </div>
                <div className="send-to-phone-share-actions">
                  <Button variant="secondary" size="mini" icon={<FolderPlus size={13} />} onClick={() => void chooseShareDirectories()}>
                    共享文件夹
                  </Button>
                  <Button variant="secondary" size="mini" icon={<FilePlus2 size={13} />} onClick={() => void chooseShareFiles()}>
                    共享文件
                  </Button>
                </div>
              </div>
            </div>
          ) : phase === 'error' ? (
            <Alert variant="error" message={error} />
          ) : (
            <LoadingIndicator label={phase === 'stopping' ? '正在停止发送' : '正在准备二维码'} />
          )}
        </div>
      </Dialog>
    </>
  )
}
