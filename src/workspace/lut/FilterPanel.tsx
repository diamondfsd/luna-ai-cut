import { ImagePlus, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '../../ui'
import { BUILTIN_LUTS } from './builtinLuts'
import { lutManager } from './LutManager'
import './FilterPanel.css'

interface FilterPanelProps {
  activeLutId: string | null
  onChange: (lutId: string | null) => void
}

export function FilterPanel({ activeLutId, onChange }: FilterPanelProps) {
  const [loadingLuts, setLoadingLuts] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [customLuts, setCustomLuts] = useState<Array<{ id: string; name: string }>>([])

  // 获取自定义 LUT
  useEffect(() => {
    const available = lutManager.getAvailableLuts()
    setCustomLuts(available.filter((l) => l.source === 'custom'))
  }, [activeLutId])

  const handleSelect = useCallback(async (id: string | null) => {
    if (id === activeLutId) {
      onChange(null)
      return
    }
    onChange(id)
    if (id === null) return

    // 异步加载到 GPU（不阻塞 UI）
    setLoadingLuts((prev) => new Set(prev).add(id))
    try {
      await lutManager.ensureLoaded(id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '滤镜加载失败')
    } finally {
      setLoadingLuts((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
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
      const buffer = await file.arrayBuffer()
      const cubeData = new Uint8Array(buffer)
      const name = file.name.replace(/\.cube$/i, '')
      const id = await lutManager.importCustomLut(name, cubeData)
      onChange(id)
      setCustomLuts((prev) => [...prev, { id, name }])
      toast.success(`已导入滤镜: ${name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    }
    // 重置 input 以便再次选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onChange])

  return (
    <div className="filter-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept=".cube"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 无滤镜 */}
      <button
        className={`filter-item ${activeLutId === null ? 'filter-item--active' : ''}`}
        onClick={() => handleSelect(null)}
      >
        <div className="filter-item-thumb">
          <X size={20} />
        </div>
        <span className="filter-item-name">无滤镜</span>
      </button>

      {/* 内置滤镜 */}
      {BUILTIN_LUTS.map((lut) => (
        <button
          key={lut.id}
          className={`filter-item ${activeLutId === lut.id ? 'filter-item--active' : ''} ${loadingLuts.has(lut.id) ? 'filter-item--loading' : ''}`}
          onClick={() => handleSelect(lut.id)}
        >
          <div className="filter-item-thumb">
            <span className="filter-item-thumb-label">{lut.name.slice(0, 2)}</span>
          </div>
          <span className="filter-item-name">{lut.name}</span>
        </button>
      ))}

      {/* 自定义 LUT */}
      {customLuts.map((lut) => (
        <button
          key={lut.id}
          className={`filter-item ${activeLutId === lut.id ? 'filter-item--active' : ''}`}
          onClick={() => handleSelect(lut.id)}
        >
          <div className="filter-item-thumb filter-item-thumb--custom">
            <ImagePlus size={16} />
          </div>
          <span className="filter-item-name">{lut.name}</span>
        </button>
      ))}

      {/* 导入按钮 */}
      <button className="filter-item filter-item--import" onClick={handleImport}>
        <div className="filter-item-thumb filter-item-thumb--import">
          <Upload size={18} />
        </div>
        <span className="filter-item-name">导入.cube</span>
      </button>
    </div>
  )
}
