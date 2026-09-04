import { Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, IconButton, Select, toast } from '../../ui'
import type { ReferenceMatchMethod } from '../../shared/types/referenceMatch'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { workspaceImageCache, type ImageCacheEntry } from '../shared/imageCache'
import { ParamSlider } from '../components/ParamSlider'
import { lutManager } from '../lut/LutManager'
import { generateReferenceMatchLut, imageBitmapToReferenceMatchImage } from './referenceMatch'
import './ReferenceMatchPanel.css'

function sameAsset(left: { id: string; path: string } | null, right: { id: string; path: string } | null): boolean {
  return Boolean(left && right && (left.id === right.id || left.path === right.path))
}

export function ReferenceMatchPanel() {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const target = media.activeMedia
  const reference = media.referenceAsset
  const [thumbnails, setThumbnails] = useState<Record<string, ImageCacheEntry>>({})
  const [strength, setStrength] = useState(100)
  const [method, setMethod] = useState<ReferenceMatchMethod>('reinhard')
  const [generating, setGenerating] = useState(false)
  const generationRef = useRef(0)
  const referenceAvailable = Boolean(reference && media.media.some((asset) => asset.id === reference.id && asset.path === reference.path))
  const targetIsReference = sameAsset(target, reference)

  useEffect(() => {
    if (reference && !referenceAvailable) media.setReferenceAsset(null)
  }, [media, reference, referenceAvailable])

  useEffect(() => {
    let cancelled = false
    const assets = [...new Map(
      [target, reference]
        .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
        .map((asset) => [asset.path, asset] as const),
    ).values()]
    if (assets.length === 0) {
      setThumbnails({})
      return () => { cancelled = true }
    }
    Promise.all(assets.map(async (asset) => [asset.id, await workspaceImageCache.generate(asset.path)] as const))
      .then((entries) => {
        if (cancelled) return
        setThumbnails(Object.fromEntries(entries))
      })
      .catch(() => {
        if (!cancelled) setThumbnails({})
      })
    return () => { cancelled = true }
  }, [reference, target])

  const setCurrentAsReference = (): void => {
    if (!target || target.kind !== 'image') {
      toast.error('请先选择一张照片作为参考图')
      return
    }
    media.setReferenceAsset({ ...target })
    toast.success('已将当前照片设为参考图')
  }

  const generate = async (): Promise<void> => {
    if (!target || !reference || !referenceAvailable || targetIsReference || generating) {
      if (targetIsReference) toast.error('请切换到需要追色的目标素材')
      return
    }
    const generationId = ++generationRef.current
    setGenerating(true)
    try {
      const [targetEntry, referenceEntry] = await Promise.all([
        workspaceImageCache.generate(target.path),
        workspaceImageCache.generate(reference.path),
      ])
      const result = generateReferenceMatchLut(
        imageBitmapToReferenceMatchImage(targetEntry.previewBitmap),
        imageBitmapToReferenceMatchImage(referenceEntry.previewBitmap),
        { method, strength: strength / 100 },
      )
      const saved = await window.luna.workspace.saveReferenceMatchLut({
        cube: result.cube,
        name: `参考图追色 · ${reference.name} · ${methodLabel(method)}`,
        description: `使用${methodLabel(method)}，根据「${reference.name}」为「${target.name}」生成的追色效果`,
        method,
        referenceAssetId: reference.id,
        referenceName: reference.name,
        targetAssetId: target.id,
        targetName: target.name,
      })
      if (generationRef.current !== generationId) return
      lutManager.clearCache()
      edit.updateWorkspacePanel({ lutFilter: { activeId: saved.path, intensity: 100 } })
      toast.success('已生成追色效果，并应用到当前素材')
    } catch (error) {
      if (generationRef.current !== generationId) return
      toast.error(error instanceof Error ? error.message : '追色失败，请稍后重试')
    } finally {
      if (generationRef.current === generationId) setGenerating(false)
    }
  }

  const targetThumbnail = target ? thumbnails[target.id]?.thumbnailUrl : null
  const referenceThumbnail = reference ? thumbnails[reference.id]?.thumbnailUrl : null
  const canGenerate = Boolean(target && reference && referenceAvailable && !targetIsReference && !generating)

  return (
    <div className="workspace-reference-match-panel">
      <div className="workspace-reference-match-intro">
        <Sparkles size={16} aria-hidden="true" />
        <div>
          <strong>参考图追色</strong>
          <span>先将当前照片设为参考图，再切换到目标素材。</span>
        </div>
      </div>

      <div className="workspace-reference-match-preview-row">
        <div className="workspace-reference-match-preview">
          <span>{target?.kind === 'video' ? '当前视频' : '当前照片'}</span>
          {targetThumbnail ? <img src={targetThumbnail} alt="当前素材预览" /> : <div className="workspace-reference-match-empty-thumb"><ImageIcon size={20} /></div>}
          <strong title={target?.name}>{target?.name ?? '未选择素材'}</strong>
        </div>
        <div className="workspace-reference-match-arrow" aria-hidden="true">→</div>
        <div className="workspace-reference-match-preview">
          <span>参考图</span>
          {referenceThumbnail ? <img src={referenceThumbnail} alt="参考图预览" /> : <div className="workspace-reference-match-empty-thumb"><ImageIcon size={20} /></div>}
          <strong title={reference?.name}>{reference?.name ?? '尚未设置'}</strong>
        </div>
      </div>

      <div className="workspace-reference-match-reference-actions">
        <Button
          variant="secondary"
          size="compact"
          icon={<ImageIcon size={15} />}
          disabled={target?.kind !== 'image'}
          onClick={setCurrentAsReference}
        >
          {reference ? '更新为当前照片' : '将当前照片设为参考图'}
        </Button>
        {reference && (
          <IconButton
            variant="ghost"
            size="compact"
            icon={<X size={15} />}
            aria-label="清除参考图"
            title="清除参考图"
            onClick={() => media.setReferenceAsset(null)}
          />
        )}
      </div>

      {targetIsReference ? (
        <div className="workspace-reference-match-status">当前素材就是参考图，请切换到需要追色的目标素材。</div>
      ) : !reference ? (
        <div className="workspace-reference-match-status">尚未设置参考图。</div>
      ) : null}

      <ParamSlider
        label="追色强度"
        value={strength}
        min={0}
        max={100}
        step={1}
        onChange={setStrength}
        formatValue={(value) => `${Math.round(value)}%`}
      />

      <div className="workspace-reference-match-method">
        <label htmlFor="workspace-reference-match-method">追色算法</label>
        <Select
          value={method}
          onValueChange={(value) => setMethod(value as ReferenceMatchMethod)}
          options={REFERENCE_MATCH_METHODS.map(({ value, label }) => ({ value, label }))}
          variant="compact"
          fullWidth
          placeholder="选择追色算法"
        />
        <small>{methodDescription(method)}</small>
      </div>

      <Button
        variant="primary"
        size="compact"
        icon={generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
        disabled={!canGenerate}
        onClick={() => void generate()}
      >
        {generating ? '正在生成' : '生成并应用追色'}
      </Button>
      <small className="workspace-reference-match-note">视频会使用缓存中的代表画面生成效果，生成后可在 Lut 中继续调整强度。</small>
    </div>
  )
}

const REFERENCE_MATCH_METHODS: Array<{ value: ReferenceMatchMethod; label: string }> = [
  { value: 'reinhard', label: 'Reinhard · 统计匹配' },
  { value: 'kantorovich', label: 'Kantorovich · 线性传输' },
  { value: 'forgy', label: 'Forgy · 调色板匹配' },
  { value: 'wasserstein', label: 'Wasserstein · 非线性传输' },
]

function methodLabel(method: ReferenceMatchMethod): string {
  return REFERENCE_MATCH_METHODS.find((item) => item.value === method)?.label ?? 'Reinhard · 统计匹配'
}

function methodDescription(method: ReferenceMatchMethod): string {
  switch (method) {
    case 'kantorovich':
      return '按整体色彩相关性进行线性调整，适合统一光线和色调。'
    case 'forgy':
      return '提取双方主色并柔和匹配，适合风景、产品和明显色块。'
    case 'wasserstein':
      return '多轮匹配复杂颜色分布，效果更强但生成时间更长。'
    default:
      return '按明暗和色彩统计进行稳妥匹配，适合作为默认选择。'
  }
}
