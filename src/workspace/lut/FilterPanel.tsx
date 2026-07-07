import { ImagePlus, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { filePathToPreviewUrl } from '../../lib/fileUtils'
import { toast } from '../../ui'
import { BUILTIN_LUTS, applyTransformToImageData } from './builtinLuts'
import { lutManager } from './LutManager'
import './FilterPanel.css'

interface FilterPanelProps {
  activeLutId: string | null
  onChange: (lutId: string | null) => void
  /** 当前素材路径（用于生成缩略图预览） */
  mediaPath?: string | null
}

const THUMB_SIZE = 64

/** 生成所有内置滤镜的缩略图 data URL */
function generateThumbnails(
  source: ImageData,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const lut of BUILTIN_LUTS) {
    map[lut.id] = applyTransformToImageData(source, lut.transformFn)
  }
  return map
}

export function FilterPanel({ activeLutId, onChange, mediaPath }: FilterPanelProps) {
  const [loadingLuts, setLoadingLuts] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [customLuts, setCustomLuts] = useState<Array<{ id: string; name: string }>>([])

  // ── 缩略图状态 ──
  const [sourceLoading, setSourceLoading] = useState(false)
  const [thumbnails, setThumbnails] = useState<Record<string, string> | null>(null)
  const [originalThumb, setOriginalThumb] = useState<string | null>(null)

  // 加载素材 → 生成缩略图
  useEffect(() => {
    setSourceLoading(true)
    setThumbnails(null)
    setOriginalThumb(null)

    if (!mediaPath) {
      setSourceLoading(false)
      return
    }

    const imgUrl = filePathToPreviewUrl(mediaPath)
    if (!imgUrl) {
      setSourceLoading(false)
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    let cancelled = false

    img.onload = () => {
      if (cancelled) return

      // 绘制到缩略图 canvas（居中裁剪保持宽高比）
      const srcRatio = img.width / img.height
      const srcW = srcRatio >= 1 ? img.height : img.width
      const srcH = srcRatio >= 1 ? img.height : img.width
      const sx = (img.width - srcW) / 2
      const sy = (img.height - srcH) / 2

      const canvas = document.createElement('canvas')
      canvas.width = THUMB_SIZE
      canvas.height = THUMB_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) { setSourceLoading(false); return }

      ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, THUMB_SIZE, THUMB_SIZE)
      const sourceData = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE)

      // 保存原图缩略图
      setOriginalThumb(canvas.toDataURL('image/jpeg', 0.85))

      // 生成各滤镜缩略图
      const thumbs = generateThumbnails(sourceData)
      if (!cancelled) {
        setThumbnails(thumbs)
        setSourceLoading(false)
      }
    }

    img.onerror = () => {
      if (!cancelled) setSourceLoading(false)
    }

    img.src = imgUrl
    return () => { cancelled = true }
  }, [mediaPath])

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
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onChange])

  // ── 缩略图渲染 ──

  const renderThumb = useCallback((content: React.ReactNode, isLoader?: boolean) => (
    isLoader
      ? <div className="filter-item-thumb filter-item-thumb--loading"><Loader2 size={18} className="spin" /></div>
      : <div className="filter-item-thumb">{content}</div>
  ), [])

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
        {sourceLoading
          ? renderThumb(<Loader2 size={18} className="spin" />, true)
          : renderThumb(originalThumb
            ? <img src={originalThumb} alt="" className="filter-item-thumb-img" />
            : <X size={20} />
          )
        }
        <span className="filter-item-name">原图</span>
      </button>

      {/* 内置滤镜 */}
      {BUILTIN_LUTS.map((lut) => (
        <button
          key={lut.id}
          className={`filter-item ${activeLutId === lut.id ? 'filter-item--active' : ''} ${loadingLuts.has(lut.id) ? 'filter-item--loading' : ''}`}
          onClick={() => handleSelect(lut.id)}
        >
          {renderThumb(
            thumbnails?.[lut.id]
              ? <img src={thumbnails[lut.id]} alt="" className="filter-item-thumb-img" />
              : <span className="filter-item-thumb-label">{lut.name.slice(0, 1)}</span>,
          )}
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
