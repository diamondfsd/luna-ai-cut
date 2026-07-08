import { RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ButtonGroup, toast } from '../../ui'
import { type LutFileInfo } from './builtinLuts'
import { FilterItem } from './FilterItem'
import { lutManager } from './LutManager'
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

export function FilterPanel({ activeLutId, onChange, intensity = 100, onIntensityChange, mediaPath, searchKey }: FilterPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [allLuts, setAllLuts] = useState<LutFileInfo[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('全部')

  // 当前激活的滤镜信息
  const activeLutInfo = useMemo(
    () => allLuts.find((l) => l.filePath === activeLutId || l.id === activeLutId) ?? null,
    [allLuts, activeLutId],
  )

  // 发现 LUT
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let lutDir: string | undefined
      try { const s = await (window as any).luna?.getSettings?.(); lutDir = s?.lutDir } catch { /* ignore */ }

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

  const handleImport = useCallback(async () => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.cube')) {
      toast.error('请选择 .cube 格式的 LUT 文件')
      return
    }
    try {
      const name = file.name.replace(/\.cube$/i, '')
      // 将文件复制到 LUT 目录
      const filePath = (file as any).path
      if (filePath) {
        const luna = (window as any).luna
        if (luna?.copyFile) await luna.copyFile(filePath)
      }
      let lutDir: string | undefined
      try { const s = await (window as any).luna?.getSettings?.(); lutDir = s?.lutDir } catch { /* ignore */ }
      const luts = await lutManager.discoverLuts(lutDir)
      setAllLuts(luts)
      // 找到刚导入的 LUT 并激活
      const imported = luts.find((l) => l.name === name)
      if (imported) onChange(imported.filePath)
      toast.success(`已导入滤镜: ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onChange])

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
          <div className="current-info">
            <div className="current-top">
              <div className="eyebrow">当前滤镜</div>
              {activeLutId && (
                <button className="filter-reset" onClick={() => { onChange(null); onIntensityChange?.(100) }} title="重置滤镜">
                  <RotateCcw size={11} />
                </button>
              )}
            </div>

            {/* 强度滑块 */}
            {activeLutId && (
              <div className="slider-row">
                <div className="slider-head">
                  <span>强度</span>
                  <span className="slider-value">{intensity}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={intensity}
                  onChange={(e) => onIntensityChange?.(Number(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg, #3478ff 0%, #3478ff ${intensity}%, rgba(255,255,255,0.12) ${intensity}%, rgba(255,255,255,0.12) 100%)`,
                  }}
                />
                <div className="slider-labels"><span>0</span><span>100</span></div>
              </div>
            )}
          </div>
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
          <button className="filter-import-btn" onClick={handleImport} title="导入 .cube">
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".cube"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </aside>
  )
}
