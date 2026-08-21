import {
  AbsoluteFill,
  Composition,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

const SHOTCRAFT_COMPOSITION_ID = 'shotcraft-promo' as const

type RemotionShot = {
  id: string
  recipe: string
  from: number
  durationInFrames: number
  mediaIds: string[]
  text?: Record<string, string>
}

type RemotionSceneSpec = {
  version: 1
  composition: typeof SHOTCRAFT_COMPOSITION_ID
  width: number
  height: number
  fps: number
  durationInFrames: number
  shots: RemotionShot[]
}

export interface RemotionMediaInput {
  id: string
  name: string
  src: string
}

export interface RemotionInputProps {
  scene: RemotionSceneSpec
  media: RemotionMediaInput[]
}

function backgroundFor(index: number): string {
  const colors = ['#0b0d12', '#141b2d', '#182820', '#2a1d1d', '#171520']
  return colors[index % colors.length] ?? '#0b0d12'
}

function mediaForShot(shot: RemotionShot, media: RemotionMediaInput[]): RemotionMediaInput | undefined {
  const ids = new Set(shot.mediaIds)
  return media.find((item) => ids.has(item.id))
}

function Shot({ shot, index, media }: { shot: RemotionShot; index: number; media: RemotionMediaInput[] }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const localFrame = Math.max(0, frame - shot.from)
  const progress = Math.min(1, localFrame / Math.max(1, shot.durationInFrames - 1))
  const intro = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 120, mass: 0.7 } })
  const translateY = interpolate(intro, [0, 1], [42, 0])
  const zoom = interpolate(progress, [0, 1], [1.08, 1.0])
  const selectedMedia = mediaForShot(shot, media)
  const title = shot.text?.title ?? shot.text?.headline ?? shot.id
  const eyebrow = shot.text?.eyebrow ?? 'FREECUT / SHOTCRAFT'
  const detail = shot.text?.detail ?? 'Local-first creative editing'
  const isMediaShot = shot.recipe !== 'title-card' && shot.recipe !== 'paper-title-card'

  return (
    <AbsoluteFill
      style={{
        backgroundColor: backgroundFor(index),
        opacity: interpolate(progress, [0, 0.12, 0.88, 1], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        fontFamily: 'Arial, sans-serif',
        color: '#f7f8fb',
      }}
    >
      {selectedMedia && isMediaShot ? (
        <AbsoluteFill style={{ overflow: 'hidden', opacity: 0.58 }}>
          <Img src={selectedMedia.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
          <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(8,10,15,.92), rgba(8,10,15,.2))' }} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ left: 112, right: 112, justifyContent: 'center', transform: `translateY(${translateY}px)` }}>
        <div style={{ color: '#7faef2', fontSize: 27, letterSpacing: 5, fontWeight: 700 }}>{eyebrow}</div>
        <div style={{ marginTop: 28, maxWidth: 1450, fontSize: 112, lineHeight: 0.98, fontWeight: 800 }}>{title}</div>
        <div style={{ marginTop: 36, maxWidth: 820, color: '#c8d0df', fontSize: 34, lineHeight: 1.25 }}>{detail}</div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 112, right: 112, bottom: 86, height: 2, backgroundColor: 'rgba(255,255,255,.24)' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: '#7faef2' }} />
      </div>
      <div style={{ position: 'absolute', right: 112, bottom: 102, color: '#aeb8c8', fontSize: 22 }}>{String(index + 1).padStart(2, '0')}</div>
    </AbsoluteFill>
  )
}

function ShotcraftPromo({ scene, media }: RemotionInputProps) {
  const frame = useCurrentFrame()
  const activeIndex = scene.shots.findIndex((shot) => frame >= shot.from && frame < shot.from + shot.durationInFrames)
  const shot = scene.shots[Math.max(0, activeIndex)]!
  return <Shot shot={shot} index={Math.max(0, activeIndex)} media={media} />
}

export function RemotionRoot() {
  const defaultScene: RemotionSceneSpec = {
    version: 1,
    composition: SHOTCRAFT_COMPOSITION_ID,
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 150,
    shots: [{ id: 'intro', recipe: 'title-card', from: 0, durationInFrames: 150, mediaIds: [], text: { title: 'FreeCut', detail: 'Local-first creative editing' } }],
  }
  return (
    <Composition
      id={SHOTCRAFT_COMPOSITION_ID}
      component={ShotcraftPromo}
      width={defaultScene.width}
      height={defaultScene.height}
      fps={defaultScene.fps}
      durationInFrames={defaultScene.durationInFrames}
      defaultProps={{ scene: defaultScene, media: [] }}
      calculateMetadata={({ props }) => ({
        width: props.scene.width,
        height: props.scene.height,
        fps: props.scene.fps,
        durationInFrames: props.scene.durationInFrames,
      })}
    />
  )
}
