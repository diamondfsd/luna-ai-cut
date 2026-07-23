import { useCallback, useEffect, useRef, useState } from 'react'
import { BookmarkCheck, ChevronDown, Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react'

import { Button, Dialog, Input, Popover, PopoverContent, PopoverTrigger, Tooltip } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import {
  loadUserPresets,
  saveUserPreset,
  deleteUserPreset,
  deserializePresetColor,
  type ColorPreset,
} from './colorPresets'
import '../../styles/workspace-color-preset.css'

interface ColorPresetPanelProps {
  value: EditPipeline['color']
  onApply: (color: EditPipeline['color']) => void
}

export function ColorPresetPanel({ value, onApply }: ColorPresetPanelProps) {
  const [userPresets, setUserPresets] = useState<ColorPreset[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // ── 当前选中的预设 ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedPreset = selectedId ? userPresets.find((p) => p.id === selectedId) ?? null : null

  const refresh = useCallback(async () => {
    try {
      setUserPresets(await loadUserPresets())
    } catch {
      setUserPresets([])
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (dropdownOpen) {
      setSearch('')
      refresh()
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [dropdownOpen, refresh])

  // ── 过滤 ──
  const query = search.trim().toLowerCase()
  const filtered = query
    ? userPresets.filter((p) => p.name.toLowerCase().includes(query))
    : userPresets

  // ── 选择预设 → 应用 ──
  const handleSelect = (preset: ColorPreset) => {
    const color = deserializePresetColor(preset)
    setSelectedId(preset.id)
    onApply(color)
    setDropdownOpen(false)
  }

  // ── 覆盖保存（选中预设时） ──
  const handleOverwrite = async () => {
    if (!selectedPreset) return
    try {
      await saveUserPreset(selectedPreset.name, value)
      await refresh()
    } catch { /* 静默 */ }
  }

  // ── 新建预设 ──
  const handleNew = async () => {
    const name = newPresetName.trim()
    if (!name) return
    try {
      const saved = await saveUserPreset(name, value)
      setSelectedId(saved.id)
      setNewPresetName('')
      setNewDialogOpen(false)
      await refresh()
    } catch { /* 静默 */ }
  }

  // ── 重置选中 ──
  const handleReset = () => {
    setSelectedId(null)
  }

  // ── 删除 ──
  const handleDelete = async (id: string) => {
    try {
      await deleteUserPreset(id)
      setSelectedId((prev) => (prev === id ? null : prev))
      await refresh()
    } catch { /* 静默 */ }
  }

  return (
    <div className="workspace-color-presets">
      <div className="workspace-color-preset-row">
        {/* 下拉选择 */}
        <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <PopoverTrigger asChild>
            <button className="workspace-color-preset-trigger" type="button" aria-label="选择调色预设">
              <BookmarkCheck size={14} className="workspace-color-preset-trigger-icon" />
              <span className="workspace-color-preset-trigger-text">
                {selectedPreset?.name ?? '选择预设...'}
              </span>
              <ChevronDown size={14} className="workspace-color-preset-trigger-chevron" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="workspace-color-preset-dropdown">
            {/* 搜索 */}
            <div className="workspace-color-preset-search">
              <Search size={14} />
              <input
                ref={searchRef}
                type="text"
                placeholder="搜索预设..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setDropdownOpen(false) }}
              />
            </div>

            {/* 预设列表 */}
            <div className="workspace-color-preset-scroll">
              {filtered.length === 0 ? (
                <div className="workspace-color-preset-empty">
                  {query ? '未找到匹配的预设' : '暂无预设'}
                </div>
              ) : (
                filtered.map((preset) => (
                  <div key={preset.id} className="workspace-color-preset-option-row">
                    <button
                      className={`workspace-color-preset-option${selectedId === preset.id ? ' active' : ''}`}
                      onClick={() => handleSelect(preset)}
                      type="button"
                    >
                      <BookmarkCheck size={14} className="workspace-color-preset-opt-icon" />
                      <span className="workspace-color-preset-opt-name">{preset.name}</span>
                    </button>
                    <button
                      className="workspace-color-preset-opt-del"
                      onClick={(e) => { e.stopPropagation(); handleDelete(preset.id) }}
                      title={`删除"${preset.name}"`}
                      aria-label={`删除预设"${preset.name}"`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* 覆盖保存 */}
        <Tooltip content={selectedPreset ? `覆盖"${selectedPreset.name}"` : '请先选择一个预设'}>
          <button
            className={`workspace-color-preset-action-btn${!selectedPreset ? ' disabled' : ''}`}
            onClick={handleOverwrite}
            disabled={!selectedPreset}
            aria-label="覆盖保存预设"
            type="button"
          >
            <Save size={14} />
          </button>
        </Tooltip>

        {/* 新增 */}
        <Tooltip content="新建预设">
          <button
            className="workspace-color-preset-action-btn"
            onClick={() => setNewDialogOpen(true)}
            aria-label="新建预设"
            type="button"
          >
            <Plus size={14} />
          </button>
        </Tooltip>

        {/* 重置选中 */}
        <Tooltip content="取消选中预设">
          <button
            className={`workspace-color-preset-action-btn${!selectedPreset ? ' disabled' : ''}`}
            onClick={handleReset}
            disabled={!selectedPreset}
            aria-label="取消选中预设"
            type="button"
          >
            <RotateCcw size={14} />
          </button>
        </Tooltip>
      </div>

      {/* 新建预设弹窗 */}
      <Dialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        title="新建调色预设"
        description="为当前调色设置命名，创建新预设。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleNew}>创建</Button>
          </>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <Input
            variant="compact"
            fullWidth
            placeholder="预设名称"
            value={newPresetName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPresetName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') handleNew() }}
            autoFocus
          />
        </div>
      </Dialog>
    </div>
  )
}
