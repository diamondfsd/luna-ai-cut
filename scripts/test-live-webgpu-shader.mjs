import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import process from 'node:process'

import { chromium } from '@playwright/test'

import { LIVE_VIDEO_PREVIEW_SHADER } from '../src/components/liveVideoFsrShaders.ts'
import {
  BUFFER_USAGE_COPY_DST,
  BUFFER_USAGE_UNIFORM,
  TEXTURE_USAGE_COPY_DST,
  TEXTURE_USAGE_RENDER_ATTACHMENT,
  TEXTURE_USAGE_TEXTURE_BINDING,
} from '../src/components/webgpu/webgpuGpu.ts'

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><html><body></body></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const address = server.address()
assert.ok(address && typeof address === 'object')
const args = ['--enable-unsafe-webgpu', '--disable-gpu-sandbox']
if (process.platform === 'darwin') args.push('--use-angle=metal')

let browser
try {
  browser = await chromium.launch({ headless: true, args })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}`)
  const result = await page.evaluate(async ({ shader, bufferUsageUniform, bufferUsageCopyDst, textureUsageTextureBinding, textureUsageCopyDst, textureUsageRenderAttachment }) => {
    if (!navigator.gpu) return { available: false, reason: 'WebGPU unavailable' }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return { available: false, reason: 'No WebGPU adapter' }

    const device = await adapter.requestDevice()
    const adapterInfo = adapter.info
    device.pushErrorScope('validation')
    try {
      const module = device.createShaderModule({ code: shader })
      const compilation = await module.getCompilationInfo()
      const shaderErrors = compilation.messages
        .filter((message) => message.type === 'error')
        .map((message) => message.message)
      if (shaderErrors.length > 0) {
        await device.popErrorScope()
        return { available: true, shaderErrors }
      }

      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'previewMain', targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
        primitive: { topology: 'triangle-strip' },
      })
      const inputWidth = 1280
      const inputHeight = 720
      const outputWidth = 1280
      const outputHeight = 720
      const source = device.createTexture({
        size: { width: inputWidth, height: inputHeight, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage: textureUsageTextureBinding | textureUsageCopyDst | textureUsageRenderAttachment,
      })
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = inputWidth
      sourceCanvas.height = inputHeight
      const sourceContext = sourceCanvas.getContext('2d')
      if (!sourceContext) throw new Error('2D test source unavailable')
      sourceContext.fillStyle = '#2040e0'
      sourceContext.fillRect(0, 0, inputWidth / 2, inputHeight)
      sourceContext.fillStyle = '#e04030'
      sourceContext.fillRect(inputWidth / 2, 0, inputWidth / 2, inputHeight)
      device.queue.copyExternalImageToTexture(
        { source: sourceCanvas },
        { texture: source },
        { width: inputWidth, height: inputHeight },
      )

      const sampler = device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' })
      const lutSampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
      })
      const lutTexture = device.createTexture({
        size: { width: 2, height: 2, depthOrArrayLayers: 2 },
        dimension: '3d',
        format: 'rgba8unorm',
        usage: 0x04 | 0x02,
      })
      const lutBytes = new Uint8Array(2 * 2 * 2 * 4)
      for (let z = 0; z < 2; z += 1) {
        for (let y = 0; y < 2; y += 1) {
          for (let x = 0; x < 2; x += 1) {
            const index = (z * 4 + y * 2 + x) * 4
            lutBytes[index] = (1 - x) * 255
            lutBytes[index + 1] = y * 255
            lutBytes[index + 2] = z * 255
            lutBytes[index + 3] = 255
          }
        }
      }
      device.queue.writeTexture(
        { texture: lutTexture },
        lutBytes,
        { bytesPerRow: 8, rowsPerImage: 2 },
        { width: 2, height: 2, depthOrArrayLayers: 2 },
      )
      const textureGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: lutTexture.createView({ dimension: '3d' }) },
          { binding: 3, resource: lutSampler },
        ],
      })
      const resolution = device.createBuffer({ size: 64, usage: bufferUsageUniform | bufferUsageCopyDst })
      device.queue.writeBuffer(resolution, 0, new Float32Array([
        0.75, 2, 0.15, 0, 5, 10, 10, 10, 10, -5, 10, 10, 0, 0,
      ]))
      const resolutionGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: resolution } }],
      })
      const canvas = document.createElement('canvas')
      canvas.width = outputWidth
      canvas.height = outputHeight
      document.body.append(canvas)
      const context = canvas.getContext('webgpu')
      if (!context) throw new Error('WebGPU canvas context unavailable')
      context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })
      const render = (iterations) => {
        const outputView = context.getCurrentTexture().createView()
        const encoder = device.createCommandEncoder()
        for (let index = 0; index < iterations; index += 1) {
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: outputView, loadOp: 'clear', storeOp: 'store' }],
          })
          pass.setPipeline(pipeline)
          pass.setBindGroup(0, textureGroup)
          pass.setBindGroup(1, resolutionGroup)
          pass.draw(4)
          pass.end()
        }
        return encoder.finish()
      }

      device.queue.submit([render(1)])
      await device.queue.onSubmittedWorkDone()
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))

      const renderIterations = 6
      const startedAt = performance.now()
      device.queue.submit([render(renderIterations)])
      await device.queue.onSubmittedWorkDone()
      const frameMs = (performance.now() - startedAt) / renderIterations
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      const validationError = await device.popErrorScope()
      device.destroy()
      return {
        available: true,
        adapter: [adapterInfo?.vendor, adapterInfo?.architecture, adapterInfo?.device].filter(Boolean).join(' / '),
        frameMs,
        canvasSize: [canvas.width, canvas.height],
        validationError: validationError?.message ?? null,
      }
    } catch (error) {
      const validationError = await device.popErrorScope()
      device.destroy()
      return {
        available: true,
        error: error instanceof Error ? error.message : String(error),
        validationError: validationError?.message ?? null,
      }
    }
  }, {
    shader: LIVE_VIDEO_PREVIEW_SHADER,
    bufferUsageUniform: BUFFER_USAGE_UNIFORM,
    bufferUsageCopyDst: BUFFER_USAGE_COPY_DST,
    textureUsageTextureBinding: TEXTURE_USAGE_TEXTURE_BINDING,
    textureUsageCopyDst: TEXTURE_USAGE_COPY_DST,
    textureUsageRenderAttachment: TEXTURE_USAGE_RENDER_ATTACHMENT,
  })

  if (!result.available) {
    console.info(`Live WebGPU shader check skipped: ${result.reason}`)
  } else {
    assert.equal(result.error, undefined, result.error)
    assert.equal(result.validationError, null, result.validationError ?? 'WebGPU validation error')
    assert.deepEqual(result.canvasSize, [1280, 720], 'WebGPU output canvas has an unexpected size')
    assert.equal(LIVE_VIDEO_PREVIEW_SHADER.includes('easu'), false, 'EASU upscaling is disabled')
    assert.ok(Number.isFinite(result.frameMs) && result.frameMs > 0, 'WebGPU render did not complete')
    console.info(`Live WebGPU 720p LUT/color render check passed: ${result.frameMs.toFixed(2)} ms/render, adapter=${result.adapter || 'unknown'}, canvas=${result.canvasSize.join('x')}`)
  }
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}
