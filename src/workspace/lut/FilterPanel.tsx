import { CircleAlert, RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, ButtonGroup, Popover, PopoverContent, PopoverTrigger, Switch } from '../../ui'
import { type LutFileInfo } from './builtinLuts'
import { FilterItem } from './FilterItem'
import { LutImportDialog } from './LutImportDialog'
import { lutManager } from './LutManager'
import { ParamSlider } from '../components/ParamSlider'
import { CREATIVE_LUT_DEFAULT_INTENSITY, findLunaUltraRestoreLut, isLunaUltraRestoreLut, LUNA_ULTRA_RESTORE_INTENSITY } from './lunaUltraRestoreLut'
import './FilterPanel.css'

interface FilterPanelProps {
  activeLutId: string | null
  onChange: (lutId: string | null, intensity?: number) => void
  intensity?: number
  onIntensityChange?: (intensity: number) => void
  /** 当前素材路径（传给 FilterItem 自己加载缩略图） */
  mediaPath?: string | null
  /** 搜索关键字，按 LUT 名称过滤 */
  searchKey?: string
}

export function FilterPanel({ activeLutId, onChange, intensity = 30, onIntensityChange, mediaPath, searchKey }: FilterPanelProps) {
  const [allLuts, setAllLuts] = useState<LutFileInfo[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('全部')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [lutsLoading, setLutsLoading] = useState(true)
  const [lutsError, setLutsError] = useState(false)
  const loadRequestRef = useRef(0)

  // 当前激活的滤镜信息
  const activeLutInfo = useMemo(
    () => allLuts.find((l) => l.filePath === activeLutId || l.id === activeLutId) ?? null,
    [allLuts, activeLutId],
  )
  const restoreLut = useMemo(() => findLunaUltraRestoreLut(allLuts), [allLuts])
  const restoreActive = isLunaUltraRestoreLut(activeLutId)

  // 解析 lutDir
  async function resolveLutDir(): Promise<string> {
    try {
      const s = await window.luna.getSettings()
      if (s?.lutDir) return s.lutDir
      if (s?.downloadDir) return `${s.downloadDir}/luts`
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
      const cats: string[] = ['全部']
      const seen = new Set<string>()
      for (const lut of luts) {
        if (!seen.has(lut.category)) {
          seen.add(lut.category)
          cats.push(lut.category)
        }
      }
      setCategories(cats)
    } catch {
      if (loadRequestRef.current !== requestId) return
      setAllLuts([])
      setCategories(['全部'])
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

  // 按 tab + searchKey 过滤
  const filteredLuts = useMemo(() => {
    let result = activeTab === '全部' ? allLuts : allLuts.filter((l) => l.category === activeTab)
    if (searchKey) {
      const kw = searchKey.toLowerCase()
      result = result.filter((l) => l.name.toLowerCase().includes(kw))
    }
    return result
  }, [allLuts, activeTab, searchKey])

  const handleSelect = useCallback((id: string | null) => {
    if (id === activeLutId) {
      onChange(null)
      return
    }
    onChange(id, restoreActive ? CREATIVE_LUT_DEFAULT_INTENSITY : undefined)
  }, [activeLutId, onChange, restoreActive])

  const handleRestoreChange = useCallback((checked: boolean) => {
    if (checked && restoreLut) onChange(restoreLut.filePath, LUNA_ULTRA_RESTORE_INTENSITY)
    else if (!checked) onChange(null, CREATIVE_LUT_DEFAULT_INTENSITY)
  }, [onChange, restoreLut])

  // 导入成功回调
  const handleImportSuccess = useCallback(async (lutPath: string) => {
    await refreshLuts()
    // 激活新导入的 LUT
    onChange(lutPath)
  }, [refreshLuts, onChange])

  // 删除 LUT（仅用户导入的 LUT 可删除）
  const handleDeleteLut = useCallback(async (lut: LutFileInfo) => {
    const lrc = (window as unknown as { lunaRenderCore?: { deleteCubeFile?: (path: string, builtin: boolean) => Promise<void> } }).lunaRenderCore
    if (!lrc?.deleteCubeFile || lut.isBuiltin) return
    try {
      await lrc.deleteCubeFile(lut.filePath, Boolean(lut.isBuiltin))
      lutManager.clearCache()
      await refreshLuts()
      // 如果删除的是当前激活的 LUT，取消选中
      if (activeLutId === lut.filePath || activeLutId === lut.id) {
        onChange(null)
      }
    } catch (err) {
      console.error('[FilterPanel] 删除 LUT 失败:', err)
    }
  }, [refreshLuts, activeLutId, onChange])

  return (
    <aside className="filter-sidebar">
      <div className="sidebar-inner">
        <section className="lut-restore-row">
          <span>
            <strong>LUT 还原</strong>
            <small>{lutsLoading ? '正在准备...' : lutsError ? '暂时不可用' : 'Luna Ultra · Rec.709'}</small>
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
                <span className="current-name">{restoreActive ? 'LUT 还原' : activeLutInfo.name}</span>
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
              {onIntensityChange && !restoreActive && (
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

        {/* 分类标签 */}
        <div className="filter-tabs-row">
          <div className="filter-tabs-scroll">
            <ButtonGroup
              options={categories.map((cat) => ({ value: cat, label: cat }))}
              value={activeTab}
              onChange={(value) => setActiveTab(value)}
              className="filter-category-group"
            />
          </div>
          <button className="filter-import-btn" onClick={() => setImportDialogOpen(true)} title="导入 .cube">
            <Upload size={15} />
          </button>
        </div>

        {/* 滤镜网格 */}
        <main className="filter-grid-wrap">
          <div className="filter-grid">
            {filteredLuts.map((lut: LutFileInfo) => (
              <FilterItem
                key={lut.filePath}
                filePath={lut.filePath}
                name={lut.name}
                active={activeLutId === lut.filePath}
                onClick={() => handleSelect(lut.filePath)}
                mediaPath={mediaPath ?? null}
                intensity={intensity}
              />
            ))}
          </div>
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
