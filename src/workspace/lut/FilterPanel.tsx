import { RotateCcw, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, ButtonGroup, Dialog, Input, toast } from '../../ui'
import { type LutFileInfo } from './builtinLuts'
import { FilterItem } from './FilterItem'
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [allLuts, setAllLuts] = useState<LutFileInfo[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string>('全部')

  // 导入弹窗
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importCategory, setImportCategory] = useState('')
  // 当前激活的滤镜信息
  const activeLutInfo = useMemo(
    () => allLuts.find((l) => l.filePath === activeLutId || l.id === activeLutId) ?? null,
    [allLuts, activeLutId],
  )

  // 解析 lutDir，未配置时使用本地资源目录下的 luts
  async function resolveLutDir(): Promise<string> {
    try {
      const s = await (window as any).luna?.getSettings?.()
      if (s?.lutDir) return s.lutDir
      // 没有配置 lutDir 时，使用本地资源目录 + /luts
      const resourcesDir = s?.localResourcesDir || s?.downloadDir || ''
      if (resourcesDir) return `${resourcesDir}/luts`
    } catch { /* ignore */ }
    return ''
  }

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

  // 点击导入 → 打开弹窗输入分组名
  const handleImport = useCallback(() => {
    setImportCategory('')
    setImportDialogOpen(true)
  }, [])

  // 弹窗确认 → 打开文件选择器
  const handleImportDialogConfirm = useCallback(() => {
    const cat = importCategory.trim()
    if (!cat) {
      toast.error('请输入分组名称')
      return
    }
    setImportDialogOpen(false)
    fileInputRef.current?.click()
  }, [importCategory])

  // 选中文件后导入
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
      const cat = importCategory.trim()
      if (!cat) throw new Error('缺少分组名称')
      const lutDir = await resolveLutDir()
      if (!lutDir) throw new Error('未配置 LUT 目录，请先在设置中添加')

      // 通过 Rust 引擎导入到 LUT 目录
      const lrc = (window as unknown as { lunaRenderCore?: any }).lunaRenderCore
      await lrc.importCubeFile(filePath, cat, lutDir)

      // 重新扫描 LUT 列表
      const luts = await lutManager.discoverLuts(lutDir)
      setAllLuts(luts)
      // 更新分类列表，包含新导入的分组
      const allCats: string[] = ['全部']
      const seenCat = new Set<string>()
      for (const lut of luts) {
        if (!seenCat.has(lut.category)) {
          seenCat.add(lut.category)
          allCats.push(lut.category)
        }
      }
      setCategories(allCats)
      // 切换到新导入的分组
      if (allCats.includes(cat)) setActiveTab(cat)
      // 找到刚导入的 LUT 并激活
      const name = file.name.replace(/\.cube$/i, '')
      const imported = luts.find((l) => l.name === name && l.category === cat)
      if (imported) onChange(imported.filePath)
      toast.success(`已导入滤镜: ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [importCategory, onChange])

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
                <button className="filter-reset" onClick={() => { onChange(null); onIntensityChange?.(100) }} title="重置滤镜">
                  <RotateCcw size={11} />
                </button>
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

      {/* 导入弹窗：输入分组名称 */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="导入滤镜"
        description="请输入分组名称，滤镜将导入到该分组下。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void handleImportDialogConfirm()}>选择文件</Button>
          </>
        }
      >
        <Input
          variant="pill"
          placeholder="例如：我的滤镜"
          value={importCategory}
          onChange={(e) => setImportCategory(e.target.value)}
          autoFocus
          fullWidth
          onKeyDown={(e) => { if (e.key === 'Enter') handleImportDialogConfirm() }}
        />
      </Dialog>
    </aside>
  )
}
