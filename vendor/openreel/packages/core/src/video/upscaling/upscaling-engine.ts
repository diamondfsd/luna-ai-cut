import type {
  UpscalingSettings,
  UpscalingConfig,
  TexturePoolEntry,
} from "./upscaling-types";
import { DEFAULT_UPSCALING_SETTINGS } from "./upscaling-types";
import {
  lanczosShaderSource,
  edgeDetectShaderSource,
  edgeDirectedShaderSource,
  sharpenShaderSource,
  createLanczosDimensionsBuffer,
  createEdgeDimensionsBuffer,
  createSharpenUniformsBuffer,
} from "./shaders";

const MAX_POOL_SIZE = 4;

export class UpscalingEngine {
  private device: GPUDevice | null = null;
  private initialized = false;

  private lanczosBindGroupLayout: GPUBindGroupLayout | null = null;
  private edgeDetectBindGroupLayout: GPUBindGroupLayout | null = null;
  private edgeDirectedBindGroupLayout: GPUBindGroupLayout | null = null;
  private sharpenBindGroupLayout: GPUBindGroupLayout | null = null;

  private lanczosPipeline: GPUComputePipeline | null = null;
  private edgeDetectPipeline: GPUComputePipeline | null = null;
  private edgeDirectedPipeline: GPUComputePipeline | null = null;
  private sharpenPipeline: GPUComputePipeline | null = null;

  private texturePool: Map<string, TexturePoolEntry[]> = new Map();
  private lastProcessingTime = 0;

  async initialize(config: UpscalingConfig): Promise<boolean> {
    if (this.initialized && this.device === config.device) {
      return true;
    }

    this.device = config.device;

    try {
      this.createBindGroupLayouts();
      await this.createPipelines();
      this.initialized = true;
      return true;
    } catch (error) {
      console.error("[UpscalingEngine] Initialization failed:", error);
      return false;
    }
  }

  private createBindGroupLayouts(): void {
    if (!this.device) return;

    this.lanczosBindGroupLayout = this.device.createBindGroupLayout({
      label: "Lanczos Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.edgeDetectBindGroupLayout = this.device.createBindGroupLayout({
      label: "Edge Detect Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.edgeDirectedBindGroupLayout = this.device.createBindGroupLayout({
      label: "Edge Directed Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.sharpenBindGroupLayout = this.device.createBindGroupLayout({
      label: "Sharpen Bind Group Layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
  }

  private async createPipelines(): Promise<void> {
    if (!this.device) return;

    const lanczosModule = this.device.createShaderModule({
      label: "Lanczos Shader",
      code: lanczosShaderSource,
    });

    const edgeDetectModule = this.device.createShaderModule({
      label: "Edge Detect Shader",
      code: edgeDetectShaderSource,
    });

    const edgeDirectedModule = this.device.createShaderModule({
      label: "Edge Directed Shader",
      code: edgeDirectedShaderSource,
    });

    const sharpenModule = this.device.createShaderModule({
      label: "Sharpen Shader",
      code: sharpenShaderSource,
    });

    this.lanczosPipeline = this.device.createComputePipeline({
      label: "Lanczos Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.lanczosBindGroupLayout!],
      }),
      compute: {
        module: lanczosModule,
        entryPoint: "main",
      },
    });

    this.edgeDetectPipeline = this.device.createComputePipeline({
      label: "Edge Detect Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.edgeDetectBindGroupLayout!],
      }),
      compute: {
        module: edgeDetectModule,
        entryPoint: "main",
      },
    });

    this.edgeDirectedPipeline = this.device.createComputePipeline({
      label: "Edge Directed Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.edgeDirectedBindGroupLayout!],
      }),
      compute: {
        module: edgeDirectedModule,
        entryPoint: "main",
      },
    });

    this.sharpenPipeline = this.device.createComputePipeline({
      label: "Sharpen Pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.sharpenBindGroupLayout!],
      }),
      compute: {
        module: sharpenModule,
        entryPoint: "main",
      },
    });
  }

  shouldUpscale(
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
  ): boolean {
    return dstWidth > srcWidth || dstHeight > srcHeight;
  }

  async upscale(
    inputTexture: GPUTexture,
    targetWidth: number,
    targetHeight: number,
    settings: UpscalingSettings = DEFAULT_UPSCALING_SETTINGS,
  ): Promise<GPUTexture> {
    if (!this.initialized || !this.device) {
      throw new Error("UpscalingEngine not initialized");
    }

    const startTime = performance.now();

    const srcWidth = inputTexture.width;
    const srcHeight = inputTexture.height;

    if (!this.shouldUpscale(srcWidth, srcHeight, targetWidth, targetHeight)) {
      return inputTexture;
    }

    let result: GPUTexture;

    switch (settings.quality) {
      case "fast":
        result = await this.upscaleFast(
          inputTexture,
          targetWidth,
          targetHeight,
        );
        break;
      case "balanced":
        result = await this.upscaleBalanced(
          inputTexture,
          targetWidth,
          targetHeight,
        );
        break;
      case "quality":
        result = await this.upscaleQuality(
          inputTexture,
          targetWidth,
          targetHeight,
          settings.sharpening,
        );
        break;
      default:
        result = await this.upscaleBalanced(
          inputTexture,
          targetWidth,
          targetHeight,
        );
    }

    this.lastProcessingTime = performance.now() - startTime;
    return result;
  }

  private async upscaleFast(
    input: GPUTexture,
    targetWidth: number,
    targetHeight: number,
  ): Promise<GPUTexture> {
    return this.applyLanczos(input, targetWidth, targetHeight);
  }

  private async upscaleBalanced(
    input: GPUTexture,
    targetWidth: number,
    targetHeight: number,
  ): Promise<GPUTexture> {
    const lanczosResult = await this.applyLanczos(
      input,
      targetWidth,
      targetHeight,
    );
    const edgeTexture = await this.applyEdgeDetection(lanczosResult);
    const result = await this.applyEdgeDirected(lanczosResult, edgeTexture);

    this.releaseTexture(edgeTexture);

    return result;
  }

  private async upscaleQuality(
    input: GPUTexture,
    targetWidth: number,
    targetHeight: number,
    sharpening: number,
  ): Promise<GPUTexture> {
    const lanczosResult = await this.applyLanczos(
      input,
      targetWidth,
      targetHeight,
    );
    const edgeTexture = await this.applyEdgeDetection(lanczosResult);
    const edgeDirectedResult = await this.applyEdgeDirected(
      lanczosResult,
      edgeTexture,
    );

    this.releaseTexture(edgeTexture);

    if (sharpening > 0.01) {
      const result = await this.applySharpen(edgeDirectedResult, sharpening);
      this.releaseTexture(edgeDirectedResult);
      return result;
    }

    return edgeDirectedResult;
  }

  private async applyLanczos(
    input: GPUTexture,
    targetWidth: number,
    targetHeight: number,
  ): Promise<GPUTexture> {
    if (!this.device || !this.lanczosPipeline || !this.lanczosBindGroupLayout) {
      throw new Error("Lanczos pipeline not ready");
    }

    const srcWidth = input.width;
    const srcHeight = input.height;

    const intermediateTexture = this.getPooledTexture(targetWidth, srcHeight);

    const hBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      hBuffer,
      0,
      createLanczosDimensionsBuffer(
        srcWidth,
        srcHeight,
        targetWidth,
        targetHeight,
        0,
      ),
    );

    const hBindGroup = this.device.createBindGroup({
      layout: this.lanczosBindGroupLayout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: intermediateTexture.createView() },
        { binding: 2, resource: { buffer: hBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const hPass = commandEncoder.beginComputePass();
    hPass.setPipeline(this.lanczosPipeline);
    hPass.setBindGroup(0, hBindGroup);
    hPass.dispatchWorkgroups(
      Math.ceil(targetWidth / 16),
      Math.ceil(srcHeight / 16),
    );
    hPass.end();

    const outputTexture = this.getPooledTexture(targetWidth, targetHeight);

    const vBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      vBuffer,
      0,
      createLanczosDimensionsBuffer(
        targetWidth,
        srcHeight,
        targetWidth,
        targetHeight,
        1,
      ),
    );

    const vBindGroup = this.device.createBindGroup({
      layout: this.lanczosBindGroupLayout,
      entries: [
        { binding: 0, resource: intermediateTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: vBuffer } },
      ],
    });

    const vPass = commandEncoder.beginComputePass();
    vPass.setPipeline(this.lanczosPipeline);
    vPass.setBindGroup(0, vBindGroup);
    vPass.dispatchWorkgroups(
      Math.ceil(targetWidth / 16),
      Math.ceil(targetHeight / 16),
    );
    vPass.end();

    this.device.queue.submit([commandEncoder.finish()]);

    this.releaseTexture(intermediateTexture);
    hBuffer.destroy();
    vBuffer.destroy();

    return outputTexture;
  }

  private async applyEdgeDetection(input: GPUTexture): Promise<GPUTexture> {
    if (
      !this.device ||
      !this.edgeDetectPipeline ||
      !this.edgeDetectBindGroupLayout
    ) {
      throw new Error("Edge detect pipeline not ready");
    }

    const width = input.width;
    const height = input.height;

    const outputTexture = this.getPooledTexture(width, height);

    const uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      uniformBuffer,
      0,
      createEdgeDimensionsBuffer(width, height),
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.edgeDetectBindGroupLayout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.edgeDetectPipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(width / 16),
      Math.ceil(height / 16),
    );
    computePass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    uniformBuffer.destroy();

    return outputTexture;
  }

  private async applyEdgeDirected(
    colorTexture: GPUTexture,
    edgeTexture: GPUTexture,
  ): Promise<GPUTexture> {
    if (
      !this.device ||
      !this.edgeDirectedPipeline ||
      !this.edgeDirectedBindGroupLayout
    ) {
      throw new Error("Edge directed pipeline not ready");
    }

    const width = colorTexture.width;
    const height = colorTexture.height;

    const outputTexture = this.getPooledTexture(width, height);

    const uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      uniformBuffer,
      0,
      createEdgeDimensionsBuffer(width, height),
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.edgeDirectedBindGroupLayout,
      entries: [
        { binding: 0, resource: colorTexture.createView() },
        { binding: 1, resource: edgeTexture.createView() },
        { binding: 2, resource: outputTexture.createView() },
        { binding: 3, resource: { buffer: uniformBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.edgeDirectedPipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(width / 16),
      Math.ceil(height / 16),
    );
    computePass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    uniformBuffer.destroy();

    return outputTexture;
  }

  private async applySharpen(
    input: GPUTexture,
    strength: number,
  ): Promise<GPUTexture> {
    if (!this.device || !this.sharpenPipeline || !this.sharpenBindGroupLayout) {
      throw new Error("Sharpen pipeline not ready");
    }

    const width = input.width;
    const height = input.height;

    const outputTexture = this.getPooledTexture(width, height);

    const uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      uniformBuffer,
      0,
      createSharpenUniformsBuffer(width, height, strength),
    );

    const bindGroup = this.device.createBindGroup({
      layout: this.sharpenBindGroupLayout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.sharpenPipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(width / 16),
      Math.ceil(height / 16),
    );
    computePass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    uniformBuffer.destroy();

    return outputTexture;
  }

  private getPooledTexture(width: number, height: number): GPUTexture {
    if (!this.device) {
      throw new Error("Device not available");
    }

    const key = `${width}x${height}`;
    const pool = this.texturePool.get(key);

    if (pool && pool.length > 0) {
      const entry = pool.pop()!;
      return entry.texture;
    }

    return this.device.createTexture({
      label: `Upscaling Texture ${key}`,
      size: { width, height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
  }

  private releaseTexture(texture: GPUTexture): void {
    const key = `${texture.width}x${texture.height}`;

    if (!this.texturePool.has(key)) {
      this.texturePool.set(key, []);
    }

    const pool = this.texturePool.get(key)!;

    if (pool.length < MAX_POOL_SIZE) {
      pool.push({
        texture,
        width: texture.width,
        height: texture.height,
        lastUsed: Date.now(),
      });
    } else {
      texture.destroy();
    }
  }

  async upscaleImageBitmap(
    image: ImageBitmap,
    targetWidth: number,
    targetHeight: number,
    settings: UpscalingSettings = DEFAULT_UPSCALING_SETTINGS,
  ): Promise<ImageBitmap> {
    if (!this.initialized || !this.device) {
      return this.canvas2DFallback(image, targetWidth, targetHeight);
    }

    try {
      const inputTexture = this.device.createTexture({
        label: "Upscale Input",
        size: { width: image.width, height: image.height },
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      this.device.queue.copyExternalImageToTexture(
        { source: image },
        { texture: inputTexture },
        { width: image.width, height: image.height },
      );

      const resultTexture = await this.upscale(
        inputTexture,
        targetWidth,
        targetHeight,
        settings,
      );

      const resultBitmap = await this.textureToImageBitmap(resultTexture);

      inputTexture.destroy();
      this.releaseTexture(resultTexture);

      return resultBitmap;
    } catch (error) {
      console.warn(
        "[UpscalingEngine] GPU upscale failed, using fallback:",
        error,
      );
      return this.canvas2DFallback(image, targetWidth, targetHeight);
    }
  }

  private async textureToImageBitmap(
    texture: GPUTexture,
  ): Promise<ImageBitmap> {
    if (!this.device) {
      throw new Error("Device not available");
    }

    const width = texture.width;
    const height = texture.height;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;

    const readBuffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture },
      { buffer: readBuffer, bytesPerRow },
      { width, height },
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(readBuffer.getMappedRange());

    const imageData = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * width * 4;
      imageData.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset);
    }

    readBuffer.unmap();
    readBuffer.destroy();

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context");
    }

    const imgData = new ImageData(imageData, width, height);
    ctx.putImageData(imgData, 0, 0);

    return createImageBitmap(canvas);
  }

  private async canvas2DFallback(
    image: ImageBitmap,
    targetWidth: number,
    targetHeight: number,
  ): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get 2D context");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    return createImageBitmap(canvas);
  }

  getLastProcessingTime(): number {
    return this.lastProcessingTime;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  clearTexturePool(): void {
    for (const pool of this.texturePool.values()) {
      for (const entry of pool) {
        entry.texture.destroy();
      }
    }
    this.texturePool.clear();
  }

  dispose(): void {
    this.clearTexturePool();

    this.device = null;
    this.initialized = false;

    this.lanczosPipeline = null;
    this.edgeDetectPipeline = null;
    this.edgeDirectedPipeline = null;
    this.sharpenPipeline = null;

    this.lanczosBindGroupLayout = null;
    this.edgeDetectBindGroupLayout = null;
    this.edgeDirectedBindGroupLayout = null;
    this.sharpenBindGroupLayout = null;
  }
}

let upscalingEngineInstance: UpscalingEngine | null = null;

export function getUpscalingEngine(): UpscalingEngine {
  if (!upscalingEngineInstance) {
    upscalingEngineInstance = new UpscalingEngine();
  }
  return upscalingEngineInstance;
}
