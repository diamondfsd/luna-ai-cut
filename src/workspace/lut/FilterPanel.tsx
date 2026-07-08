import { CircleAlert, RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ButtonGroup } from '../../ui'
import { type LutFileInfo } from './builtinLuts'
import { FilterItem } from './FilterItem'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui'
import { LutImportDialog } from './LutImportDialog'
import { lutManager } from './LutManager'
import { ParamSlider } from '../components/ParamSlider'
import './FilterPanel.css'

interface FilterPanelProps {
  activeLutId: string | null
  onChange: (lutId: string | null) => void
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

  // 当前激活的滤镜信息
  const activeLutInfo = useMemo(
    () => allLuts.find((l) => l.filePath === activeLutId || l.id === activeLutId) ?? null,
    [allLuts, activeLutId],
  )

  // 解析 lutDir
  async function resolveLutDir(): Promise<string> {
    try {
      const s = await (window as any).luna?.getSettings?.()
      if (s?.lutDir) return s.lutDir
      if (s?.downloadDir) return `${s.downloadDir}/luts`
    } catch { /* ignore */ }
    return ''
  }

  // 刷新 LUT 列表
  const refreshLuts = useCallback(async (lutDir?: string) => {
    const dir = lutDir ?? await resolveLutDir()
    const luts = await lutManager.discoverLuts(dir)
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
  }, [])

  // 发现 LUT
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const lutDir = await resolveLutDir()
      const luts = await lutManager.discoverLuts(lutDir)
      if (cancelled) return
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
    })()
    return () => { cancelled = true }
  }, [])

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
    onChange(id)
  }, [activeLutId, onChange])

  // 导入成功回调
  const handleImportSuccess = useCallback(async (lutPath: string) => {
    await refreshLuts()
    // 激活新导入的 LUT
    onChange(lutPath)
  }, [refreshLuts, onChange])

  return (
    <aside className="filter-sidebar">
      <div className="sidebar-inner">
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
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
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
