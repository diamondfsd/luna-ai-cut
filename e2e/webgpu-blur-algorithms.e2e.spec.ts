import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const defaultImagePath = '/Users/zhouchao/照片同步/lunaultra/2026-08-09/IMG_20260809_190817_367.jpg'
const imagePath = process.env.LUNA_BLUR_ALGORITHM_IMAGE ?? defaultImagePath

const hasImage = await access(imagePath).then(() => true).catch(() => false)

test.skip(!hasImage, `模糊算法实验需要图片文件: ${imagePath}`)

test('compares WebGPU blur algorithms on the supplied photo', async ({ lunaApp }, testInfo) => {
  const imageBase64 = (await readFile(imagePath)).toString('base64')
  const result = await lunaApp.page.evaluate(async ({ imageBase64 }) => {
    const width = 3840
    const height = 2160
    const image = new Image()
    image.src = `data:image/jpeg;base64,${imageBase64}`
    await image.decode()

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = width
    sourceCanvas.height = height
    const sourceContext = sourceCanvas.getContext('2d')
    if (!sourceContext) throw new Error('无法创建算法实验画布')
    const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
    const drawWidth = image.naturalWidth * coverScale
    const drawHeight = image.naturalHeight * coverScale
    sourceContext.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    )

    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) throw new Error('当前 Electron 没有可用的 WebGPU 适配器')
    const device = await adapter.requestDevice()
    const format: GPUTextureFormat = 'rgba8unorm'
    const shaderStageFragment = 0x2
    const textureUsage = {
      binding: 0x04,
      renderAttachment: 0x10,
      copyDst: 0x02,
      copySrc: 0x01,
    }
    const bufferUsage = {
      uniform: 0x40,
      copyDst: 0x08,
      mapRead: 0x0001,
    }
    const usage = textureUsage.binding
      | textureUsage.renderAttachment
      | textureUsage.copyDst
      | textureUsage.copySrc
    const sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    })

    function createTexture(textureWidth: number, textureHeight: number): GPUTexture {
      return device.createTexture({
        size: { width: textureWidth, height: textureHeight },
        format,
        usage,
      })
    }

    const sourceTexture = createTexture(width, height)
    device.queue.copyExternalImageToTexture(
      { source: sourceCanvas },
      { texture: sourceTexture },
      { width, height },
    )

    const vertexShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
  );
  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, 0.0, 1.0);
  output.uv = position;
  return output;
}
`

    const fast9Shader = /* wgsl */ `${vertexShader}
@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blurStep: vec4f;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let offset = blurStep.xy;
  let off1 = 1.3846153846 * offset;
  let off2 = 3.2307692308 * offset;
  var color = textureSampleLevel(blurTexture, blurSampler, input.uv, 0.0) * 0.2270270270;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv + off1, 0.0) * 0.3162162162;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv - off1, 0.0) * 0.3162162162;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv + off2, 0.0) * 0.0702702703;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv - off2, 0.0) * 0.0702702703;
  return color;
}
`

    const fast13Shader = /* wgsl */ `${vertexShader}
@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blurStep: vec4f;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let offset = blurStep.xy;
  let off1 = 1.411764705882353 * offset;
  let off2 = 3.2941176470588234 * offset;
  let off3 = 5.176470588235294 * offset;
  var color = textureSampleLevel(blurTexture, blurSampler, input.uv, 0.0) * 0.1964825501511404;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv + off1, 0.0) * 0.2969069646728344;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv - off1, 0.0) * 0.2969069646728344;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv + off2, 0.0) * 0.09447039785044732;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv - off2, 0.0) * 0.09447039785044732;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv + off3, 0.0) * 0.010381362401148057;
  color += textureSampleLevel(blurTexture, blurSampler, input.uv - off3, 0.0) * 0.010381362401148057;
  return color;
}
`

    const exactGaussianShader = /* wgsl */ `${vertexShader}
struct GaussianParams {
  radius: u32,
  direction: u32,
  sigma: f32,
  _padding0: f32,
  width: f32,
  height: f32,
  _padding1: vec2f,
};

@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GaussianParams;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let pixel = vec2i(i32(input.position.x), i32(input.position.y));
  let textureSize = vec2i(i32(params.width), i32(params.height));
  let sigma = max(params.sigma, 0.5);
  let twoSigmaSquared = 2.0 * sigma * sigma;
  var color = vec4f(0.0);
  var totalWeight = 0.0;
  for (var index = -i32(params.radius); index <= i32(params.radius); index = index + 1) {
    let delta = select(vec2i(index, 0), vec2i(0, index), params.direction == 1u);
    let samplePosition = clamp(pixel + delta, vec2i(0), textureSize - vec2i(1));
    let weight = exp(-f32(index * index) / twoSigmaSquared);
    color += textureLoad(blurTexture, samplePosition, 0) * weight;
    totalWeight += weight;
  }
  return color / max(totalWeight, 0.0001);
}
`

    const kawaseShader = /* wgsl */ `${vertexShader}
struct KawaseParams {
  sourceWidth: f32,
  sourceHeight: f32,
  offset: f32,
  _padding: f32,
};

@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: KawaseParams;

fn sampleAt(uv: vec2f, delta: vec2f) -> vec4f {
  return textureSampleLevel(blurTexture, blurSampler, uv + delta, 0.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let halfPixel = vec2f(0.5 / params.sourceWidth, 0.5 / params.sourceHeight) * params.offset;
  var color = sampleAt(input.uv, vec2f(0.0)) * 4.0;
  color += sampleAt(input.uv, vec2f(-halfPixel.x, -halfPixel.y));
  color += sampleAt(input.uv, vec2f(halfPixel.x, -halfPixel.y));
  color += sampleAt(input.uv, vec2f(halfPixel.x, halfPixel.y));
  color += sampleAt(input.uv, vec2f(-halfPixel.x, halfPixel.y));
  return color / 8.0;
}
`

    const kawaseUpsampleShader = /* wgsl */ `${vertexShader}
struct KawaseParams {
  sourceWidth: f32,
  sourceHeight: f32,
  offset: f32,
  _padding: f32,
};

@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var blurTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: KawaseParams;

fn sampleAt(uv: vec2f, delta: vec2f) -> vec4f {
  return textureSampleLevel(blurTexture, blurSampler, uv + delta, 0.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let halfPixel = vec2f(0.5 / params.sourceWidth, 0.5 / params.sourceHeight) * params.offset;
  var color = sampleAt(input.uv, vec2f(-halfPixel.x * 2.0, 0.0));
  color += sampleAt(input.uv, vec2f(-halfPixel.x, halfPixel.y)) * 2.0;
  color += sampleAt(input.uv, vec2f(0.0, halfPixel.y * 2.0));
  color += sampleAt(input.uv, vec2f(halfPixel.x, halfPixel.y)) * 2.0;
  color += sampleAt(input.uv, vec2f(halfPixel.x * 2.0, 0.0));
  color += sampleAt(input.uv, vec2f(halfPixel.x, -halfPixel.y)) * 2.0;
  color += sampleAt(input.uv, vec2f(0.0, -halfPixel.y * 2.0));
  color += sampleAt(input.uv, vec2f(-halfPixel.x, -halfPixel.y)) * 2.0;
  return color / 12.0;
}
`

    function createPipeline(shader: string): GPURenderPipeline {
      const module = device.createShaderModule({ code: shader })
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: shaderStageFragment, sampler: { type: 'filtering' } },
          { binding: 1, visibility: shaderStageFragment, texture: { sampleType: 'float' } },
          { binding: 2, visibility: shaderStageFragment, buffer: { type: 'uniform' } },
        ],
      })
      return device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      })
    }

    const fast9Pipeline = createPipeline(fast9Shader)
    const fast13Pipeline = createPipeline(fast13Shader)
    const exactGaussianPipeline = createPipeline(exactGaussianShader)
    const kawasePipeline = createPipeline(kawaseShader)
    const kawaseUpsamplePipeline = createPipeline(kawaseUpsampleShader)
    const temporaryTextures: GPUTexture[] = []
    const temporaryBuffers: GPUBuffer[] = []

    function makeUniformBuffer(values: ArrayBuffer): GPUBuffer {
      const buffer = device.createBuffer({
        size: Math.max(16, values.byteLength),
        usage: bufferUsage.uniform | bufferUsage.copyDst,
      })
      device.queue.writeBuffer(buffer, 0, values)
      temporaryBuffers.push(buffer)
      return buffer
    }

    function encodePass(
      encoder: GPUCommandEncoder,
      input: GPUTexture,
      output: GPUTexture,
      pipeline: GPURenderPipeline,
      values: ArrayBuffer,
    ): void {
      const buffer = makeUniformBuffer(values)
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: output.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: input.createView() },
          { binding: 2, resource: { buffer } },
        ],
      }))
      pass.draw(6)
      pass.end()
    }

    function fastUniform(stepX: number, stepY: number): ArrayBuffer {
      return new Float32Array([stepX, stepY, 0, 0]).buffer
    }

    function gaussianUniform(radius: number, direction: 0 | 1): ArrayBuffer {
      const buffer = new ArrayBuffer(32)
      const view = new DataView(buffer)
      view.setUint32(0, radius, true)
      view.setUint32(4, direction, true)
      view.setFloat32(8, radius / 3, true)
      view.setFloat32(16, width, true)
      view.setFloat32(20, height, true)
      return buffer
    }

    function kawaseUniform(sourceWidth: number, sourceHeight: number): ArrayBuffer {
      return new Float32Array([sourceWidth, sourceHeight, 1, 0]).buffer
    }

    async function renderTexture(texture: GPUTexture): Promise<string> {
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256
      const readback = device.createBuffer({
        size: bytesPerRow * height,
        usage: bufferUsage.copyDst | bufferUsage.mapRead,
      })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readback, bytesPerRow },
        { width, height },
      )
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      await readback.mapAsync(bufferUsage.mapRead)
      const mapped = new Uint8Array(readback.getMappedRange())
      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = width
      outputCanvas.height = height
      const outputContext = outputCanvas.getContext('2d')
      if (!outputContext) throw new Error('无法读取算法实验结果')
      const imageData = outputContext.createImageData(width, height)
      for (let y = 0; y < height; y += 1) {
        imageData.data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
      }
      outputContext.putImageData(imageData, 0, 0)
      readback.unmap()
      readback.destroy()
      return outputCanvas.toDataURL('image/png')
    }

    async function runSeparable(pipeline: GPURenderPipeline, step: number): Promise<string> {
      const horizontal = createTexture(width, height)
      const output = createTexture(width, height)
      temporaryTextures.push(horizontal, output)
      const encoder = device.createCommandEncoder()
      encodePass(encoder, sourceTexture, horizontal, pipeline, fastUniform(step / width, 0))
      encodePass(encoder, horizontal, output, pipeline, fastUniform(0, step / height))
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      return renderTexture(output)
    }

    async function runExactGaussian(): Promise<string> {
      const horizontal = createTexture(width, height)
      const output = createTexture(width, height)
      temporaryTextures.push(horizontal, output)
      const encoder = device.createCommandEncoder()
      encodePass(encoder, sourceTexture, horizontal, exactGaussianPipeline, gaussianUniform(30, 0))
      encodePass(encoder, horizontal, output, exactGaussianPipeline, gaussianUniform(30, 1))
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      return renderTexture(output)
    }

    async function runDualKawase(): Promise<string> {
      const levels = [
        { width: Math.ceil(width / 2), height: Math.ceil(height / 2) },
        { width: Math.ceil(width / 4), height: Math.ceil(height / 4) },
        { width: Math.ceil(width / 8), height: Math.ceil(height / 8) },
      ]
      const downTextures = levels.map((level) => {
        const texture = createTexture(level.width, level.height)
        temporaryTextures.push(texture)
        return texture
      })
      const upTextures = [
        createTexture(levels[1].width, levels[1].height),
        createTexture(levels[0].width, levels[0].height),
        createTexture(width, height),
      ]
      temporaryTextures.push(...upTextures)
      const encoder = device.createCommandEncoder()
      let current = sourceTexture
      let currentSize = { width, height }
      for (const [index, target] of downTextures.entries()) {
        encodePass(encoder, current, target, kawasePipeline, kawaseUniform(currentSize.width, currentSize.height))
        current = target
        currentSize = levels[index]
      }
      for (const [index, target] of upTextures.entries()) {
        encodePass(encoder, current, target, kawaseUpsamplePipeline, kawaseUniform(currentSize.width, currentSize.height))
        current = target
        currentSize = index === 0 ? levels[1] : index === 1 ? levels[0] : { width, height }
      }
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      return renderTexture(current)
    }

    const outputs = {
      original: sourceCanvas.toDataURL('image/png'),
      fast9: await runSeparable(fast9Pipeline, 30 / 3.2307692308),
      fast13: await runSeparable(fast13Pipeline, 30 / 5.1764705882),
      exactGaussian: await runExactGaussian(),
      dualKawase: await runDualKawase(),
    }

    for (const texture of temporaryTextures) texture.destroy()
    for (const buffer of temporaryBuffers) buffer.destroy()
    sourceTexture.destroy()
    device.destroy()
    return { width, height, outputs }
  }, { imageBase64 })

  const outputDir = '/tmp/luna-blur-algorithms'
  await mkdir(outputDir, { recursive: true })
  for (const [name, dataUrl] of Object.entries(result.outputs)) {
    const outputPath = path.join(outputDir, `${name}.png`)
    await writeFile(outputPath, Buffer.from(dataUrl.split(',')[1], 'base64'))
    await testInfo.attach(`${name}.png`, { path: outputPath, contentType: 'image/png' })
  }

  expect(lunaApp.runtimeErrors).toEqual([])
  expect(Object.keys(result.outputs)).toEqual(['original', 'fast9', 'fast13', 'exactGaussian', 'dualKawase'])
  expect(result.width).toBe(3840)
  expect(result.height).toBe(2160)
})
