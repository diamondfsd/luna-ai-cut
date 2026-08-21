import { cp, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const shotcraftMedia = [
  'spotlight-hero-card.jpg',
  'research-card-stack-scroll.jpg',
  'product-card-progressive-assemble.jpg',
  'word-relay-geometry.jpg',
].map((fileName) => path.join(
  repositoryRoot,
  'vendor/video-shotcraft/gallery/media/poster',
  fileName,
))

function lunaIntroSource(brandLine: string): string {
  return `import { AbsoluteFill, Composition, Img, interpolate, spring, useCurrentFrame } from 'remotion'

// Adapted from video-shotcraft: spotlight-hero-card, product-card-progressive-assemble,
// research-card-stack-scroll, and word-relay-geometry.

type MediaInput = { id: string; name: string; src: string }
type ClipProps = { media: MediaInput[] }

const BLUE = '#0066cc'
const BLUE_LIGHT = '#78b6f2'
const INK = '#0a0e15'
const PAPER = '#f6f8fb'
const MUTED = '#aab6c8'
const CARD_WIDTH = 720
const CARD_HEIGHT = 252

const FEATURES = [
  { label: 'Capture', detail: 'Bring the story in' },
  { label: 'Organize', detail: 'Find the moment' },
  { label: 'Refine', detail: 'Make it yours' },
]

const STACK_TITLES = [
  'Luna Ultra / mountain descent',
  'Luna Ultra / coastal light',
  'Luna Ultra / city motion',
  'Luna Ultra / night ride',
  'Luna Ultra / trail texture',
  'Luna Ultra / orbit detail',
  'Luna Ultra / quiet arrival',
  'Luna Ultra / final frame',
  'Luna Ultra / story beat',
  'Luna Ultra / ready to cut',
]

const PARTICLES = Array.from({ length: 24 }, (_, index) => ({
  left: (index * 37) % 100,
  top: (index * 61) % 100,
  size: 1 + (index % 3),
  phase: (index * 17) % 60,
}))

function mediaAt(media: MediaInput[], index: number): MediaInput | undefined {
  return media[index % Math.max(1, media.length)]
}

function clampOpacity(frame: number, start: number, end: number): number {
  return interpolate(frame, [start, start + 18, end - 18, end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 14 }}>
      <div style={{ width: compact ? 22 : 30, height: compact ? 22 : 30, borderRadius: 8, background: BLUE, transform: 'rotate(45deg)' }} />
      <div style={{ fontSize: compact ? 18 : 26, fontWeight: 800, letterSpacing: 1.5 }}>LUNA AI CUT</div>
    </div>
  )
}

function Grid({ color = 'rgba(120,182,242,.12)', shift = 0 }: { color?: string; shift?: number }) {
  return (
    <AbsoluteFill
      style={{
        opacity: 0.72,
        backgroundImage: \`linear-gradient(\${color} 1px, transparent 1px), linear-gradient(90deg, \${color} 1px, transparent 1px)\`,
        backgroundSize: '64px 64px',
        backgroundPosition: \`0 \${shift}px\`,
      }}
    />
  )
}

function OpeningShot({ frame, media }: { frame: number; media: MediaInput[] }) {
  const local = frame
  const cardRise = spring({ frame: Math.max(0, local - 70), fps: 30, config: { damping: 16, stiffness: 90, mass: 0.9 } })
  const lift = interpolate(cardRise, [0, 1], [0, -34])
  const scale = interpolate(cardRise, [0, 1], [0.94, 1])
  const pan = interpolate(local, [0, 180], [0, 34], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const spotlight = interpolate(local, [0, 80, 140], [0.2, 1, 0.82], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const image = mediaAt(media, 0)

  return (
    <AbsoluteFill style={{ background: INK, opacity: clampOpacity(local, 0, 180), color: '#fff', overflow: 'hidden' }}>
      <Grid shift={pan} />
      <AbsoluteFill style={{ background: \`radial-gradient(circle 330px at \${470 + pan}px \${260 + pan * 0.3}px, rgba(0,102,204,\${0.24 * spotlight}), transparent 72%)\` }} />
      <div style={{ position: 'absolute', left: 88, top: 74, color: BLUE_LIGHT, fontSize: 20, letterSpacing: 4, fontWeight: 700 }}>A LOCAL-FIRST EDITING WORKSPACE</div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 194 + lift,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: 22,
          overflow: 'hidden',
          background: '#152238',
          border: \`1px solid rgba(120,182,242,\${0.28 + spotlight * 0.42})\`,
          boxShadow: \`0 \${20 - lift * 0.15}px \${48 - lift * 0.2}px rgba(0,0,0,.46), 0 0 0 2px rgba(0,102,204,\${spotlight * 0.22})\`,
          transform: \`scale(\${scale}) rotateY(\${interpolate(local, [70, 142], [0, 8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}deg)\`,
          transformOrigin: 'center center',
        }}
      >
        {image ? <Img src={image.src} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.78 }} /> : null}
        <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(8,14,24,.9), rgba(8,14,24,.16))' }} />
        <div style={{ position: 'absolute', left: 36, top: 32, color: BLUE_LIGHT, fontSize: 16, letterSpacing: 3, fontWeight: 700 }}>LUNA ULTRA / SELECTED MOMENT</div>
        <div style={{ position: 'absolute', left: 36, bottom: 34, fontSize: 38, fontWeight: 800 }}>The story starts here.</div>
        <div style={{ position: 'absolute', right: 34, bottom: 35, width: 44, height: 44, border: \`2px solid \${BLUE_LIGHT}\`, borderRadius: 14, opacity: spotlight }} />
      </div>
      <div style={{ position: 'absolute', left: 900, top: 260, width: 292, transform: \`translateY(\${interpolate(cardRise, [0, 1], [18, 0])}px)\` }}>
        <BrandMark />
        <div style={{ marginTop: 32, color: MUTED, fontSize: 25, lineHeight: 1.35 }}>Turn camera moments into a cut with a clear point of view.</div>
      </div>
      <div style={{ position: 'absolute', left: 88, right: 88, bottom: 54, height: 2, background: 'rgba(255,255,255,.18)' }}>
        <div style={{ width: \`${Math.min(100, (local / 180) * 100)}%\`, height: '100%', background: BLUE_LIGHT }} />
      </div>
    </AbsoluteFill>
  )
}

function AssembleShot({ frame, media }: { frame: number; media: MediaInput[] }) {
  const local = frame - 180
  const push = interpolate(local, [0, 180], [1, 1.04], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const image = mediaAt(media, 1)
  const field = (start: number, mode: 'rise' | 'pop' = 'rise') => {
    const progress = interpolate(local, [start, start + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const eased = 1 - Math.pow(1 - progress, 3)
    return {
      opacity: Math.min(1, eased * 2),
      transform: mode === 'pop' ? \`scale(\${interpolate(eased, [0, 1], [0.82, 1.0])})\` : \`translateY(\${interpolate(eased, [0, 1], [20, 0])}px)\`,
    }
  }
  return (
    <AbsoluteFill style={{ background: PAPER, opacity: clampOpacity(local, 0, 180), color: INK }}>
      <div style={{ position: 'absolute', left: 86, top: 64, right: 86, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <BrandMark compact />
        <div style={{ color: '#657287', fontSize: 17, letterSpacing: 2, fontWeight: 700 }}>FROM RAW MEDIA TO A STORY</div>
      </div>
      <div style={{ position: 'absolute', left: 112, top: 176, width: 1056, height: 410, borderRadius: 24, background: '#fff', boxShadow: '0 22px 54px rgba(16,32,56,.12)', display: 'flex', padding: 34, gap: 38, boxSizing: 'border-box', transform: \`scale(\${push})\` }}>
        <div style={{ width: 410, height: 342, borderRadius: 16, background: '#dfe7f1', overflow: 'hidden', position: 'relative', ...field(0) }}>
          {image ? <Img src={image.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          <AbsoluteFill style={{ background: 'linear-gradient(150deg, rgba(0,102,204,.16), rgba(10,14,21,.3))' }} />
          <div style={{ position: 'absolute', left: 24, top: 22, color: '#fff', fontSize: 16, letterSpacing: 2, fontWeight: 700 }}>LUNA ULTRA / 01</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 38, fontWeight: 800, ...field(8) }}>Make every clip intentional.</div>
          <div style={{ display: 'flex', gap: 10, margin: '18px 0 24px' }}>
            {FEATURES.map((feature, index) => <div key={feature.label} style={{ color: BLUE, background: '#eaf3ff', padding: '8px 14px', borderRadius: 99, fontSize: 16, fontWeight: 700, ...field(20 + index * 8, 'pop') }}>{feature.label}</div>)}
          </div>
          <div style={{ fontSize: 20, lineHeight: 1.8, color: '#5c6878' }}>
            {FEATURES.map((feature, index) => <div key={feature.detail} style={{ position: 'relative', ...field(48 + index * 10) }}><span style={{ color: INK, fontWeight: 700 }}>{feature.label}</span><span> / {feature.detail}</span>{index === 1 ? <span style={{ position: 'absolute', left: 0, bottom: 2, width: 178, height: 8, background: 'rgba(120,182,242,.48)', transform: \`scaleX(\${interpolate(local, [74, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })})\`, transformOrigin: 'left center' }} /> : null}</div>)}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...field(92) }}>
            <div style={{ color: '#68778d', fontSize: 16 }}>EDITED LOCALLY / READY TO SHARE</div>
            <div style={{ width: 58, height: 58, borderRadius: 16, background: BLUE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>CUT</div>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 112, bottom: 72, color: '#718096', fontSize: 17, letterSpacing: 1.4 }}>A calm timeline for fast decisions.</div>
    </AbsoluteFill>
  )
}

function StackShot({ frame, media }: { frame: number; media: MediaInput[] }) {
  const local = frame - 360
  const focus = Math.min(STACK_TITLES.length - 1, Math.floor(local / 12))
  const gridShift = (local / 12 * 30) % 64
  return (
    <AbsoluteFill style={{ background: '#0c1119', opacity: clampOpacity(local, 0, 180), color: '#fff', overflow: 'hidden' }}>
      <Grid color="rgba(120,182,242,.09)" shift={gridShift} />
      <div style={{ position: 'absolute', left: 92, top: 68, color: BLUE_LIGHT, fontSize: 18, letterSpacing: 3, fontWeight: 700 }}>SORT THE SIGNAL</div>
      <div style={{ position: 'absolute', left: 92, top: 102, color: '#fff', fontSize: 45, fontWeight: 800 }}>Every moment has a place.</div>
      <div style={{ position: 'absolute', left: '50%', top: '54%', width: 0, height: 0 }}>
        {STACK_TITLES.map((title, index) => {
          const elapsed = local - index * 12
          const enter = interpolate(elapsed, [-6, 0], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const eased = 1 - Math.pow(1 - enter, 3)
          const drift = Math.max(0, elapsed) / 12 * 30
          const depth = Math.min(1, drift / 90)
          const opacity = elapsed < -6 ? 0 : Math.min(1, (elapsed + 6) / 2) * (1 - Math.max(0, (drift - 96) / 48))
          const image = mediaAt(media, index)
          return (
            <div key={title} style={{ position: 'absolute', left: -350, top: -74, width: 700, height: 148, borderRadius: 16, overflow: 'hidden', background: '#171e29', border: '1px solid #2c3a4c', opacity, zIndex: index, boxShadow: '0 18px 36px rgba(0,0,0,.32)', transform: \`translate(\${drift * 0.28}px, \${interpolate(eased, [0, 1], [-40, 0]) + drift}px) scale(\${interpolate(eased, [0, 1], [0.94, 1])})\`, filter: \`blur(\${(depth * 3.8).toFixed(2)}px) brightness(\${(1 - depth * 0.25).toFixed(3)})\` }}>
              {image ? <Img src={image.src} style={{ position: 'absolute', right: 0, top: 0, width: 220, height: '100%', objectFit: 'cover', opacity: index === focus ? 0.72 : 0.12 }} /> : null}
              <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(23,30,41,1) 0%, rgba(23,30,41,.92) 54%, rgba(23,30,41,.18) 100%)' }} />
              <div style={{ position: 'absolute', left: 24, top: 22, width: 4, height: 104, borderRadius: 2, background: index % 3 === 1 ? BLUE_LIGHT : '#2d435c' }} />
              <div style={{ position: 'absolute', left: 46, top: 26, right: 36, fontSize: 22, lineHeight: 1.25, fontWeight: 700 }}>{title}</div>
              <div style={{ position: 'absolute', left: 46, top: 82, right: 36, opacity: index === focus ? 1 : 0, color: BLUE_LIGHT, fontSize: 15, letterSpacing: 1.2 }}>LUNA ULTRA / MEDIA INDEXED</div>
              <div style={{ position: 'absolute', left: 46, bottom: 22, width: 330, height: 5, borderRadius: 3, background: '#334052', opacity: index === focus ? 1 : 0.24 }} />
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', right: 92, top: 104, color: MUTED, fontSize: 16 }}>10 moments / one clear cut</div>
    </AbsoluteFill>
  )
}

function GeometryShot({ frame }: { frame: number }) {
  const local = frame - 540
  const slot = Math.min(2, Math.floor(local / 60))
  const slotFrame = local - slot * 60
  const progress = interpolate(slotFrame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const labels = ['Faster', 'Clearer', 'Yours']
  const particleShift = local * 0.7
  return (
    <AbsoluteFill style={{ background: '#070b12', opacity: clampOpacity(local, 0, 180), color: '#fff', overflow: 'hidden' }}>
      {PARTICLES.map((particle) => <div key={particle.phase} style={{ position: 'absolute', left: \`${particle.left}%\`, top: \`${(particle.top + particleShift + particle.phase) % 110 - 5}%\`, width: particle.size, height: particle.size, borderRadius: 99, background: BLUE_LIGHT, opacity: 0.12 + ((particle.phase % 4) * 0.05) }} />)}
      <div style={{ position: 'absolute', left: 92, top: 68, color: BLUE_LIGHT, fontSize: 18, letterSpacing: 3, fontWeight: 700 }}>A BETTER WAY TO CUT</div>
      <svg viewBox="-640 -360 1280 720" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {slot === 0 ? <circle cx="0" cy="0" r="236" fill="none" stroke="#495b73" strokeWidth="3" strokeDasharray="12 18" opacity={progress} transform={\`rotate(\${local * 0.8}) scale(\${interpolate(progress, [0, 1], [0.68, 1])})\`} /> : null}
        {slot === 1 ? [-220, 0, 220].map((x, index) => <circle key={x} cx={x} cy="0" r="164" fill="none" stroke={BLUE_LIGHT} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - Math.max(0, interpolate(slotFrame, [index * 7, 28 + index * 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))} transform="rotate(-90)" opacity={0.75} />) : null}
        {slot === 2 ? <circle cx="0" cy="0" r="210" fill="none" stroke={BLUE} strokeWidth="4" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} transform="rotate(-90)" opacity={0.9} /> : null}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'relative', fontSize: 88, lineHeight: 1, fontWeight: 800, letterSpacing: -2, opacity: progress, transform: \`scale(\${interpolate(progress, [0, 1], [0.86, 1])})\` }}>
          <div style={{ color: 'transparent', WebkitTextStroke: \`2px \${BLUE_LIGHT}\` }}>{labels[slot]}</div>
          <div style={{ position: 'absolute', inset: 0, color: '#fff', clipPath: \`inset(-20% \${(1 - progress) * 100}% -20% 0)\` }}>{labels[slot]}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 92, bottom: 70, color: MUTED, fontSize: 24 }}>From footage to feeling.</div>
    </AbsoluteFill>
  )
}

function OutroShot({ frame, media }: { frame: number; media: MediaInput[] }) {
  const local = frame - 720
  const reveal = spring({ frame: Math.max(0, local - 16), fps: 30, config: { damping: 18, stiffness: 100, mass: 0.8 } })
  const imageOpacity = interpolate(local, [0, 40, 100, 180], [0, 0.85, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: INK, opacity: clampOpacity(local, 0, 180), color: '#fff', overflow: 'hidden' }}>
      <Grid color="rgba(120,182,242,.08)" shift={local * 0.18} />
      {[0, 1, 2].map((index) => {
        const image = mediaAt(media, index + 1)
        return <div key={index} style={{ position: 'absolute', left: 700 + index * 92, top: 90 + index * 32, width: 300, height: 188, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(120,182,242,.32)', opacity: imageOpacity * (0.72 - index * 0.14), transform: \`rotate(\${-8 + index * 7}deg) translateY(\${(1 - reveal) * 42}px)\`, boxShadow: '0 22px 44px rgba(0,0,0,.3)' }}>{image ? <Img src={image.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div>
      })}
      <div style={{ position: 'absolute', left: 92, top: 172, transform: \`translateY(\${(1 - reveal) * 26}px)\`, opacity: reveal }}>
        <div style={{ color: BLUE_LIGHT, fontSize: 20, letterSpacing: 4, fontWeight: 700 }}>YOUR FOOTAGE. YOUR POINT OF VIEW.</div>
        <div style={{ marginTop: 28, fontSize: 84, lineHeight: 0.98, fontWeight: 800 }}>${brandLine}</div>
        <div style={{ marginTop: 26, color: MUTED, fontSize: 28 }}>Edit locally. Share with intention.</div>
      </div>
      <div style={{ position: 'absolute', left: 92, bottom: 70, display: 'flex', gap: 28, alignItems: 'center', opacity: reveal }}>
        <BrandMark compact />
        <div style={{ color: '#718096', fontSize: 16, letterSpacing: 2 }}>MADE FOR REAL CAMERA STORIES</div>
      </div>
    </AbsoluteFill>
  )
}

function LunaIntroComposition({ media }: ClipProps) {
  const frame = useCurrentFrame()
  if (frame < 180) return <OpeningShot frame={frame} media={media} />
  if (frame < 360) return <AssembleShot frame={frame} media={media} />
  if (frame < 540) return <StackShot frame={frame} media={media} />
  if (frame < 720) return <GeometryShot frame={frame} />
  return <OutroShot frame={frame} media={media} />
}

export default function Root() {
  return <Composition id="remotion-clip" component={LunaIntroComposition} width={1280} height={720} fps={30} durationInFrames={900} defaultProps={{ media: [] }} />
}
`
}

async function waitForTask(
  page: import('@playwright/test').Page,
  taskId: string,
  projectId: string,
): Promise<Awaited<ReturnType<typeof window.luna.remotion.getTask>>> {
  let latest: Awaited<ReturnType<typeof window.luna.remotion.getTask>> = null
  await expect.poll(async () => {
    latest = await page.evaluate(async ({ id, project }) => window.luna.remotion.getTask(id, project), { id: taskId, project: projectId })
    return latest?.status ?? 'missing'
  }, { timeout: 240_000, intervals: [250, 500, 1_000, 2_000] }).toBe('completed')
  return latest
}

test('RemotionClip 可编辑 Luna AI Cut 30 秒介绍片并绑定最新 TSX', async ({ lunaApp }) => {
  test.setTimeout(300_000)

  const mediaDirectory = path.join(lunaApp.baseDir, 'remotion-intro-media')
  await mkdir(mediaDirectory, { recursive: true })
  const assets = await Promise.all(shotcraftMedia.map(async (sourcePath, index) => {
    const name = path.basename(sourcePath)
    const destinationPath = path.join(mediaDirectory, name)
    await cp(sourcePath, destinationPath)
    return { id: `luna-intro-media-${index + 1}`, name, path: destinationPath, kind: 'image' as const }
  }))

  const { page, runtimeErrors } = lunaApp
  const project = await page.evaluate((projectAssets) => window.luna.workspace.createProject('Luna AI Cut 30 秒介绍片', projectAssets), assets)
  const mediaIds = assets.map((asset) => asset.id)
  const initialSource = lunaIntroSource('Luna AI Cut')
  const clip = await page.evaluate(({ projectId, files, ids }) => window.luna.remotion.createClip(projectId, {
    compositionId: 'remotion-clip',
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 900,
    mediaIds: ids,
    files: { 'src/Root.tsx': files },
  }), { projectId: project.id, files: initialSource, ids: mediaIds })

  expect(clip.durationInFrames).toBe(900)
  expect(clip.fps).toBe(30)
  expect(clip.sourceRevision).toBe(1)
  expect(clip.mediaIds).toEqual(mediaIds)

  const sourceSnapshot = await page.evaluate(({ projectId, clipId }) => window.luna.remotion.readSource(projectId, clipId), { projectId: project.id, clipId: clip.clipId })
  expect(sourceSnapshot.sourceRevision).toBe(1)
  expect(sourceSnapshot.files['src/Root.tsx']).toContain('spotlight-hero-card')
  expect(sourceSnapshot.files['src/Root.tsx']).toContain('research-card-stack-scroll')

  const previewTask = await page.evaluate(({ projectId, clipId, revision }) => window.luna.remotion.preview({ projectId, clipId, expectedRevision: revision }), { projectId: project.id, clipId: clip.clipId, revision: sourceSnapshot.sourceRevision })
  const completedPreview = await waitForTask(page, previewTask.taskId, project.id)
  expect(completedPreview?.clipId).toBe(clip.clipId)
  expect(completedPreview?.sourceRevision).toBe(1)

  const editedSource = sourceSnapshot.files['src/Root.tsx'].replace('Luna AI Cut', 'Luna AI Cut / MADE FOR STORIES')
  const updatedClip = await page.evaluate(({ projectId, clipId, expectedRevision, source }) => window.luna.remotion.updateSource({
    projectId,
    clipId,
    expectedRevision,
    files: { 'src/Root.tsx': source },
  }), { projectId: project.id, clipId: clip.clipId, expectedRevision: sourceSnapshot.sourceRevision, source: editedSource })
  expect(updatedClip.sourceRevision).toBe(2)
  expect(updatedClip.sourceHash).not.toBe(clip.sourceHash)
  expect(updatedClip.status).toBe('dirty')

  const renderTask = await page.evaluate(({ projectId, clipId, revision }) => window.luna.remotion.render({ projectId, clipId, expectedRevision: revision }), { projectId: project.id, clipId: clip.clipId, revision: updatedClip.sourceRevision })
  const completedRender = await waitForTask(page, renderTask.taskId, project.id)
  expect(completedRender?.status).toBe('completed')
  expect(completedRender?.clipId).toBe(clip.clipId)
  expect(completedRender?.sourceRevision).toBe(2)
  expect(completedRender?.sourceHash).toBe(updatedClip.sourceHash)
  expect(completedRender?.result?.outputPath).toBeTruthy()

  const outputPath = completedRender!.result!.outputPath
  const outputStats = await stat(outputPath)
  expect(outputStats.isFile()).toBe(true)
  expect(outputStats.size).toBeGreaterThan(50_000)
  const duration = await page.evaluate((filePath) => window.luna.workspace.getVideoDuration(filePath), outputPath)
  expect(duration).toBeGreaterThan(29.8)
  expect(duration).toBeLessThan(30.2)

  const finalClip = await page.evaluate(({ projectId, clipId }) => window.luna.remotion.getClip(projectId, clipId), { projectId: project.id, clipId: clip.clipId })
  expect(finalClip?.status).toBe('ready')
  expect(finalClip?.artifact?.sourceRevision).toBe(2)
  expect(finalClip?.artifact?.sourceHash).toBe(updatedClip.sourceHash)
  expect(finalClip?.artifact?.fileSize).toBe(outputStats.size)

  const clipFilePath = path.join(lunaApp.baseDir, 'workspace-projects', project.id, 'remotion-clips', clip.clipId, 'clip.json')
  const persistedClip = JSON.parse(await readFile(clipFilePath, 'utf8')) as typeof finalClip
  expect(persistedClip?.artifact?.sourceRevision).toBe(2)
  expect(persistedClip?.artifact?.sourceHash).toBe(updatedClip.sourceHash)

  const deliveryPath = path.join(repositoryRoot, 'test-results', 'remotion-luna-ai-cut-intro.mp4')
  await mkdir(path.dirname(deliveryPath), { recursive: true })
  await cp(outputPath, deliveryPath)
  console.log(`Remotion Luna AI Cut 成片: ${deliveryPath}`)
  expect(runtimeErrors).toEqual([])
})
