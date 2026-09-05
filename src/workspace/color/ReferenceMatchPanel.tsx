import { Image as ImageIcon, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, IconButton, toast } from '../../ui'
import type { ReferenceMatchMethod } from '../../shared/types/referenceMatch'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { workspaceImageCache, type ImageCacheEntry } from '../shared/imageCache'
import { ParamSlider } from '../components/ParamSlider'
import { generateReferenceMatchLut, imageBitmapToReferenceMatchImage } from './referenceMatch'
import './ReferenceMatchPanel.css'

const VIDEO_REFERENCE_MATCH_METHOD: ReferenceMatchMethod = 'reinhard'

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
  }

  const generate = async (): Promise<void> => {
    if (!target || !reference || !referenceAvailable || targetIsReference || generating) {
      if (targetIsReference) toast.error('请切换到需要追色的目标素材')
      return
    }
    const projectId = media.currentProject?.id
    if (!projectId) {
      toast.error('请先将素材加入项目后再使用 AI追色')
      return
    }
    const generationId = ++generationRef.current
    setGenerating(true)
    try {
      if (target.kind === 'video') {
        if (reference.kind !== 'image') throw new Error('参考图必须是照片')
        const [targetEntry, referenceEntry] = await Promise.all([
          workspaceImageCache.generate(target.path),
          workspaceImageCache.generate(reference.path),
        ])
        const result = generateReferenceMatchLut(
          imageBitmapToReferenceMatchImage(targetEntry.previewBitmap),
          imageBitmapToReferenceMatchImage(referenceEntry.previewBitmap),
          { method: VIDEO_REFERENCE_MATCH_METHOD },
        )
        const saved = await window.luna.workspace.saveReferenceMatchLut({
          projectId,
          cube: result.cube,
          name: `AI追色 · ${reference.name}`,
          description: `根据「${reference.name}」为「${target.name}」生成的 AI追色效果`,
          method: VIDEO_REFERENCE_MATCH_METHOD,
          referenceAssetId: reference.id,
          referenceName: reference.name,
          targetAssetId: target.id,
          targetName: target.name,
        })
        edit.commitPatch({
          referenceMatch: {
            enabled: true,
            method: VIDEO_REFERENCE_MATCH_METHOD,
            strength,
            referenceAssetId: reference.id,
            referenceName: reference.name,
            referencePath: reference.path,
            targetAssetId: target.id,
            targetName: target.name,
            resultPath: saved.path,
            resultKind: 'lut',
            generatedAt: new Date().toISOString(),
          },
        })
        if (generationRef.current !== generationId) return
        toast.success('追色成功')
        return
      }

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
          referencePath: reference.path,
          targetAssetId: target.id,
          targetName: target.name,
          resultPath: generated.path,
          resultKind: 'lut',
          generatedAt: new Date().toISOString(),
          modelVersion: generated.modelVersion,
        },
      })
      if (generationRef.current !== generationId) return
      toast.success('追色成功')
    } catch (error) {
      if (generationRef.current !== generationId) return
      toast.error(error instanceof Error ? error.message : '追色失败，请稍后重试')
    } finally {
      if (generationRef.current === generationId) setGenerating(false)
    }
  }

  const targetThumbnail = target ? thumbnails[target.id]?.thumbnailUrl : null
  const referenceThumbnail = reference ? thumbnails[reference.id]?.thumbnailUrl : null
  const canGenerate = Boolean(media.currentProject?.id && (target?.kind === 'image' || target?.kind === 'video') && reference?.kind === 'image' && referenceAvailable && !targetIsReference && !generating)

  const handleStrengthChange = (value: number): void => {
    setStrength(value)
    const current = edit.pipeline.referenceMatch
    if (!current) return
    edit.updateWorkspacePanel({
      referenceMatch: { ...current, strength: value },
    })
  }

  const removeReferenceMatch = (): void => {
    if (!edit.pipeline.referenceMatch || generating) return
    edit.commitPatch({ referenceMatch: null })
  }

  return (
    <div className="workspace-reference-match-panel">
      <div className="workspace-reference-match-preview-row">
        <div className="workspace-reference-match-preview workspace-reference-match-reference-preview">
          <span>参考图</span>
          {referenceThumbnail ? <img src={referenceThumbnail} alt="参考图预览" /> : <div className="workspace-reference-match-empty-thumb"><ImageIcon size={20} /></div>}
          <strong title={reference?.name}>{reference?.name ?? '尚未设置'}</strong>
          {reference && (
            <IconButton
              variant="circle"
              size="mini"
              icon={<X size={14} />}
              aria-label="清除参考图"
              title="清除参考图"
              onClick={() => media.setReferenceAsset(null)}
            />
          )}
        </div>
        <div className="workspace-reference-match-arrow" aria-hidden="true">→</div>
        <div className="workspace-reference-match-preview">
          <span>{target?.kind === 'video' ? '当前视频' : '当前照片'}</span>
          <div className="workspace-reference-match-target-thumb">
            {targetThumbnail ? <img src={targetThumbnail} alt="当前素材预览" /> : <div className="workspace-reference-match-empty-thumb"><ImageIcon size={20} /></div>}
            {edit.pipeline.referenceMatch && (
              <Button
                className="workspace-reference-match-remove-button"
                variant="danger"
                size="mini"
                icon={<X size={13} />}
                disabled={generating}
                onClick={removeReferenceMatch}
              >
                移除追色
              </Button>
            )}
          </div>
          <strong title={target?.name}>{target?.name ?? '未选择素材'}</strong>
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
          {reference ? '更新参考图' : '设为参考图'}
        </Button>
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

      <ParamSlider
        label="追色强度"
        value={strength}
        min={0}
        max={100}
        step={1}
        onChange={handleStrengthChange}
        formatValue={(value) => `${Math.round(value)}%`}
      />
    </div>
  )
}
