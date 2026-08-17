import { useEffect, useRef, useState } from 'react'

import { WebGpuCompositionRenderer } from '../lib/webgpu/composition'
import type { CompositionInput } from '../shared/types'
import '../styles/webgpu-composition-test.css'

const TEST_COMPOSITION: CompositionInput = {
  canvas: { width: 640, height: 360 },
  layers: [
    {
      id: 'background',
      layerType: 'shape',
      source: { path: '' },
      rect: { x: 0, y: 0, w: 1, h: 1 },
      shape: 'rectangle',
      fillColor: '#16283a',
      opacity: 1,
      zIndex: 0,
    },
    {
      id: 'rounded-panel',
      layerType: 'shape',
      source: { path: '' },
      rect: { x: 0.08, y: 0.12, w: 0.84, h: 0.76 },
      shape: 'rounded-rectangle',
      cornerRadius: 24,
      fillColor: '#244563',
      strokeColor: '#68b8e8',
      strokeWidth: 3,
      opacity: 1,
      zIndex: 1,
    },
    {
      id: 'accent',
      layerType: 'shape',
      source: { path: '' },
      rect: { x: 0.14, y: 0.22, w: 0.12, h: 0.12 },
      shape: 'circle',
      fillColor: '#ffb84d',
      opacity: 1,
      zIndex: 2,
    },
    {
      id: 'title',
      layerType: 'text',
      source: { path: '' },
      rect: { x: 0.28, y: 0.22, w: 0.56, h: 0.24 },
      content: 'WebGPU',
      fontFamily: 'Arial, sans-serif',
      fontSize: 48,
      fontWeight: 700,
      textColor: '#ffffff',
      textAlign: 'center',
      verticalAlign: 'middle',
      opacity: 1,
      zIndex: 2,
    },
    {
      id: 'description',
      layerType: 'text',
      source: { path: '' },
      rect: { x: 0.18, y: 0.53, w: 0.64, h: 0.18 },
      content: 'Shape and text layers are composited on the GPU',
      fontFamily: 'Arial, sans-serif',
      fontSize: 18,
      fontWeight: 400,
      textColor: '#d9edf8',
      textAlign: 'center',
      verticalAlign: 'middle',
      opacity: 1,
      zIndex: 2,
    },
  ],
}

export function WebGpuCompositionTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGpuCompositionRenderer | null>(null)
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting')
  const [detail, setDetail] = useState('正在创建 GPU 合成画面')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const renderer = new WebGpuCompositionRenderer(canvas)
    rendererRef.current = renderer

    void renderer.initialize({
      resolveImage: async () => {
        throw new Error('此验证画面不应请求图片资源')
      },
      onDeviceLost: (message) => {
        if (!disposed) {
          setStatus('error')
          setDetail(message)
        }
      },
      onError: (message) => {
        if (!disposed) {
          setStatus('error')
          setDetail(message)
        }
      },
    }).then(async () => {
      const stats = await renderer.render(TEST_COMPOSITION)
      await renderer.waitForGpu()
      if (disposed) return
      setStatus('ready')
      setDetail(`${stats.layerCount} 个图层已提交，提交耗时 ${stats.submitMs.toFixed(1)} ms`)
    }).catch((error: unknown) => {
      if (disposed) return
      setStatus('error')
      setDetail(error instanceof Error ? error.message : String(error))
    })

    return () => {
      disposed = true
      renderer.destroy()
      rendererRef.current = null
    }
  }, [])

  return (
    <main className="webgpu-composition-test-page">
      <header>
        <p className="webgpu-composition-test-eyebrow">WebGPU composition test</p>
        <h1>形状与文字图层</h1>
        <p>验证栅格化图层进入统一合成链路后的透明度、描边和文字布局。</p>
      </header>
      <section className="webgpu-composition-test-stage" aria-label="WebGPU 合成测试画面">
        <canvas
          ref={canvasRef}
          data-testid="webgpu-composition-canvas"
          data-status={status}
        />
      </section>
      <p className={`webgpu-composition-test-status is-${status}`} data-testid="webgpu-composition-status">
        {detail}
      </p>
    </main>
  )
}
