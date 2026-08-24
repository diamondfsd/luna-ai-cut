import { Check, CircleAlert, Pencil, RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Accordion, Button, IconButton, Popover, PopoverContent, PopoverTrigger, Switch, Tooltip, toast } from '../../ui'
import { type LutFileInfo } from './builtinLuts'
import { FilterItem } from './FilterItem'
import { LutImportDialog } from './LutImportDialog'
import { lutManager } from './LutManager'
import { ParamSlider } from '../components/ParamSlider'
import { findLunaUltraRestoreLut, isLunaUltraRestoreLut, isLunaUltraTechnicalLut } from './lunaUltraRestoreLut'
import './FilterPanel.css'

interface FilterPanelProps {
  restoreLutId: string | null
  onRestoreChange: (lutId: string | null) => void
  activeLutId: string | null
  onChange: (lutId: string | null, intensity?: number) => void
  intensity?: number
  onIntensityChange?: (intensity: number) => void
  /** 当前素材路径（传给 FilterItem 自己加载缩略图） */
  mediaPath?: string | null
  /** 搜索关键字，按 LUT 名称过滤 */
  searchKey?: string
}

export function FilterPanel({ restoreLutId, onRestoreChange, activeLutId, onChange, intensity = 30, onIntensityChange, mediaPath, searchKey }: FilterPanelProps) {
  const [allLuts, setAllLuts] = useState<LutFileInfo[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [deletingLutPath, setDeletingLutPath] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [lutsLoading, setLutsLoading] = useState(true)
  const [lutsError, setLutsError] = useState(false)
  const loadRequestRef = useRef(0)

  // 当前激活的滤镜信息
  const activeLutInfo = useMemo(
    () => allLuts.find((l) => l.filePath === activeLutId || l.id === activeLutId) ?? null,
    [allLuts, activeLutId],
  )
  const activeLutCategory = activeLutInfo?.category
  const restoreLut = useMemo(() => findLunaUltraRestoreLut(allLuts), [allLuts])
  const restoreActive = isLunaUltraRestoreLut(restoreLutId)

  // 解析 lutDir
  async function resolveLutDir(): Promise<string> {
    try {
      const s = await window.luna.getSettings()
      if (s?.lutDir) return s.lutDir
      if (s?.baseDir) return `${s.baseDir}/luts`
    } catch { /* ignore */ }
    return ''
  }

  // 刷新 LUT 列表
  const refreshLuts = useCallback(async (lutDir?: string) => {
    const requestId = ++loadRequestRef.current
    setLutsLoading(true)
    setLutsError(false)
    try {
      const dir = lutDir ?? await resolveLutDir()
      const luts = await lutManager.discoverLuts(dir)
      if (loadRequestRef.current !== requestId) return
      setAllLuts(luts)
      const cats: string[] = []
      const seen = new Set<string>()
      for (const lut of luts.filter((item) => !isLunaUltraTechnicalLut(item.filePath))) {
        if (!seen.has(lut.category)) {
          seen.add(lut.category)
          cats.push(lut.category)
        }
      }
      setCategories(cats)
      setOpenCategory((current) => current && cats.includes(current) ? current : cats[0] ?? null)
      setEditingCategory((current) => current && cats.includes(current) ? current : null)
    } catch {
      if (loadRequestRef.current !== requestId) return
      setAllLuts([])
      setCategories([])
      setLutsError(true)
    } finally {
      if (loadRequestRef.current === requestId) setLutsLoading(false)
    }
  }, [])

  // 发现 LUT
  useEffect(() => {
    void refreshLuts()
    return () => { loadRequestRef.current += 1 }
  }, [refreshLuts])

  const visibleGroups = useMemo(() => {
    let result = allLuts.filter((lut) => !isLunaUltraTechnicalLut(lut.filePath))
    if (searchKey) {
      const kw = searchKey.toLowerCase()
      result = result.filter((l) => l.name.toLowerCase().includes(kw))
    }
    return categories
      .map((category) => ({ category, items: result.filter((lut) => lut.category === category) }))
      .filter((group) => group.items.length > 0)
  }, [allLuts, categories, searchKey])

  useEffect(() => {
    if (!activeLutCategory) return
    setOpenCategory(activeLutCategory)
  }, [activeLutCategory])

  useEffect(() => {
    if (!searchKey?.trim()) return
    setOpenCategory((current) => (
      current && visibleGroups.some((group) => group.category === current)
        ? current
        : visibleGroups[0]?.category ?? null
    ))
  }, [searchKey, visibleGroups])

  const handleSelect = useCallback((id: string | null) => {
    if (id === activeLutId) {
      onChange(null)
      return
    }
    onChange(id)
  }, [activeLutId, onChange])

  const handleRestoreChange = useCallback((checked: boolean) => {
    onRestoreChange(checked && restoreLut ? restoreLut.filePath : null)
  }, [onRestoreChange, restoreLut])

  // 导入成功回调
  const handleImportSuccess = useCallback(async (lutPath: string) => {
    await refreshLuts()
    // 激活新导入的 LUT
    onChange(lutPath)
  }, [refreshLuts, onChange])

  // 删除 LUT（仅用户导入的 LUT 可删除）
  const handleDeleteLut = useCallback(async (lut: LutFileInfo) => {
    const lrc = (window as unknown as { lunaRenderCore?: { deleteCubeFile?: (path: string, builtin: boolean) => Promise<void> } }).lunaRenderCore
    if (!lrc?.deleteCubeFile || lut.isBuiltin || deletingLutPath) return
    setDeletingLutPath(lut.filePath)
    try {
      await lrc.deleteCubeFile(lut.filePath, Boolean(lut.isBuiltin))
      lutManager.clearCache()
      await refreshLuts()
      // 如果删除的是当前激活的 LUT，取消选中
      if (activeLutId === lut.filePath || activeLutId === lut.id) {
        onChange(null)
      }
      toast.success('滤镜已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法删除这个滤镜')
    } finally {
      setDeletingLutPath(null)
    }
  }, [refreshLuts, activeLutId, deletingLutPath, onChange])

  const toggleCategoryEditing = useCallback((category: string) => {
    setOpenCategory(category)
    setEditingCategory((current) => current === category ? null : category)
  }, [])

  return (
    <aside className="filter-sidebar">
      <div className="sidebar-inner">
        <section className="lut-restore-row">
          <span>
            <strong>LUT 还原</strong>
            <small>{lutsLoading ? '正在准备...' : lutsError ? '暂时不可用' : 'Rec.709 还原'}</small>
          </span>
          {lutsError ? (
            <Button variant="ghost" size="mini" onClick={() => void refreshLuts()}>重试</Button>
          ) : (
            <Switch
              checked={restoreActive}
              disabled={lutsLoading || !restoreLut}
              ariaLabel="LUT 还原"
              onCheckedChange={handleRestoreChange}
            />
          )}
        </section>

        {/* 当前滤镜卡片 */}
        <section className="filter-current-card">
          {activeLutInfo ? (
            <FilterItem
              filePath={activeLutInfo.filePath}
              name={activeLutInfo.name}
              mediaPath={mediaPath ?? null}
              intensity={intensity}
              hideName
            />
          ) : (
            <div className="filter-current-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span>选择一个滤镜</span>
            </div>
          )}
          {activeLutInfo ? (
            <div className="current-info">
              <div className="current-top">
                <span className="current-name">{activeLutInfo.name}</span>
                <div className="current-actions">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="filter-info-btn" title="LUT 详情">
                        <CircleAlert size={13} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="lut-info-popover" align="end">
                      <div className="lut-info-body">
                        <div className="lut-info-row">
                          <span className="lut-info-label">名称</span>
                          <span className="lut-info-value">{activeLutInfo.name}</span>
                        </div>
                        <div className="lut-info-row">
                          <span className="lut-info-label">分类</span>
                          <span className="lut-info-value">{activeLutInfo.category}</span>
                        </div>
                        {activeLutInfo.description && (
                          <div className="lut-info-row">
                            <span className="lut-info-label">描述</span>
                            <span className="lut-info-value">{activeLutInfo.description}</span>
                          </div>
                        )}
                        <div className="lut-info-row">
                          <span className="lut-info-label">路径</span>
                          <span className="lut-info-value lut-info-path">{activeLutInfo.filePath}</span>
                        </div>
                        {!activeLutInfo.isBuiltin && (
                          <>
                            <div className="lut-info-divider" />
                            <button
                              className="lut-info-delete-btn"
                              onClick={() => handleDeleteLut(activeLutInfo)}
                            >
                              删除此 LUT
                            </button>
                          </>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button className="filter-reset" onClick={() => { onChange(null); }} title="重置滤镜">
                    <RotateCcw size={11} />
                  </button>
                </div>
              </div>
              {onIntensityChange && (
                <ParamSlider
                  label="强度"
                  value={intensity}
                  min={0}
                  max={100}
                  step={1}
                  onChange={onIntensityChange}
                  formatValue={(v) => String(v)}
                />
              )}
            </div>
          ) : null}
        </section>

        <div className="filter-groups-toolbar">
          <span>滤镜分类</span>
          <Button
            variant="ghost"
            size="mini"
            className="filter-import-btn"
            onClick={() => setImportDialogOpen(true)}
            title="添加 LUT"
          >
            添加 LUT
            <Upload size={14} />
          </Button>
        </div>

        <main className="filter-grid-wrap">
          {visibleGroups.length > 0 ? visibleGroups.map(({ category, items }) => {
            const editing = editingCategory === category
            const editable = items.some((lut) => !lut.isBuiltin)
            return (
              <Accordion
                key={category}
                className="lut-category-accordion"
                title={<><span>{category}</span><span className="lut-category-count">{items.length}</span></>}
                actions={editable ? (
                  <Tooltip content={editing ? '完成编辑' : '编辑自定义滤镜'}>
                    <IconButton
                      variant="ghost"
                      size="mini"
                      className={`lut-category-edit${editing ? ' active' : ''}`}
                      icon={editing ? <Check size={14} /> : <Pencil size={13} />}
                      aria-label={editing ? `完成编辑${category}` : `编辑${category}`}
                      onClick={() => toggleCategoryEditing(category)}
                    />
                  </Tooltip>
                ) : undefined}
                open={openCategory === category}
                onOpenChange={(open) => {
                  setOpenCategory(open ? category : null)
                  if (!open && editing) setEditingCategory(null)
                }}
              >
                <div className={`filter-grid${editing ? ' editing' : ''}`}>
                  {items.map((lut: LutFileInfo) => (
                    <FilterItem
                      key={lut.filePath}
                      filePath={lut.filePath}
                      name={lut.name}
                      active={activeLutId === lut.filePath}
                      onClick={editing ? undefined : () => handleSelect(lut.filePath)}
                      editing={editing && !lut.isBuiltin}
                      deleting={deletingLutPath === lut.filePath}
                      onDelete={!lut.isBuiltin ? () => void handleDeleteLut(lut) : undefined}
                      mediaPath={mediaPath ?? null}
                      intensity={intensity}
                    />
                  ))}
                </div>
              </Accordion>
            )
          }) : (
            <div className="filter-empty">{searchKey ? '没有匹配的滤镜' : '暂无可用滤镜'}</div>
          )}
        </main>
      </div>

      <LutImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </aside>
  )
}
