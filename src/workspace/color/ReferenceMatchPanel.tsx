import { Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, IconButton, toast } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { workspaceImageCache, type ImageCacheEntry } from '../shared/imageCache'
import { ParamSlider } from '../components/ParamSlider'
import { lutManager } from '../lut/LutManager'
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
  const [strength, setStrength] = useState(edit.pipeline.referenceMatch?.strength ?? 100)
  const [generating, setGenerating] = useState(false)
  const generationRef = useRef(0)
  const referenceAvailable = Boolean(reference && media.media.some((asset) => asset.id === reference.id && asset.path === reference.path))
  const targetIsReference = sameAsset(target, reference)

  useEffect(() => {
    setStrength(edit.pipeline.referenceMatch?.strength ?? 100)
  }, [edit.pipeline.referenceMatch?.strength, target?.id, target?.path])

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
    const projectId = media.currentProject?.id
    if (!projectId) {
      toast.error('请先将素材加入项目后再使用 AI 追色')
      return
    }
    const generationId = ++generationRef.current
    setGenerating(true)
    try {
      const generated = await window.luna.workspace.generateReferenceMatchAiLut({
        projectId,
        targetPath: target.path,
        referencePath: reference.path,
        referenceName: reference.name,
        targetName: target.name,
        referenceAssetId: reference.id,
        targetAssetId: target.id,
      })
      edit.commitPatch({
        referenceMatch: {
          enabled: true,
          method: 'neural-preset',
          strength,
          referenceAssetId: reference.id,
          referenceName: reference.name,
          targetAssetId: target.id,
          targetName: target.name,
          resultPath: generated.path,
          resultKind: 'lut',
          generatedAt: new Date().toISOString(),
          modelVersion: generated.modelVersion,
        },
        lutFilter: { activeId: generated.path, intensity: strength },
      })
      if (generationRef.current !== generationId) return
      lutManager.clearCache()
      toast.success('AI追色已生成并应用到当前照片')
    } catch (error) {
      if (generationRef.current !== generationId) return
      toast.error(error instanceof Error ? error.message : '追色失败，请稍后重试')
    } finally {
      if (generationRef.current === generationId) setGenerating(false)
    }
  }

  const targetThumbnail = target ? thumbnails[target.id]?.thumbnailUrl : null
  const referenceThumbnail = reference ? thumbnails[reference.id]?.thumbnailUrl : null
  const canGenerate = Boolean(media.currentProject?.id && target?.kind === 'image' && reference?.kind === 'image' && referenceAvailable && !targetIsReference && !generating)

  const handleStrengthChange = (value: number): void => {
    setStrength(value)
    const current = edit.pipeline.referenceMatch
    if (!current) return
    edit.updateWorkspacePanel({
      referenceMatch: { ...current, strength: value },
      ...(current.resultKind === 'lut' ? { lutFilter: { intensity: value } } : {}),
    })
  }

  return (
    <div className="workspace-reference-match-panel">
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

      <ParamSlider
        label="追色强度"
        value={strength}
        min={0}
        max={100}
        step={1}
        onChange={handleStrengthChange}
        formatValue={(value) => `${Math.round(value)}%`}
      />

      <Button
        variant="primary"
        size="compact"
        icon={generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
        disabled={!canGenerate}
        onClick={() => void generate()}
      >
        {generating ? 'AI追色中' : 'AI追色'}
      </Button>
    </div>
  )
}
