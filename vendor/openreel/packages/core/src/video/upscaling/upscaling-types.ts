export type UpscaleQuality = "fast" | "balanced" | "quality";

export interface UpscalingSettings {
  enabled: boolean;
  quality: UpscaleQuality;
  sharpening: number;
}

export const DEFAULT_UPSCALING_SETTINGS: UpscalingSettings = {
  enabled: false,
  quality: "balanced",
  sharpening: 0.3,
};

export interface UpscalingConfig {
  device: GPUDevice;
  maxTextureSize?: number;
}

export interface TexturePoolEntry {
  texture: GPUTexture;
  width: number;
  height: number;
  lastUsed: number;
}

export interface UpscalingPipelines {
  lanczosH: GPUComputePipeline;
  lanczosV: GPUComputePipeline;
  edgeDetect: GPUComputePipeline;
  edgeDirected: GPUComputePipeline;
  sharpen: GPUComputePipeline;
}

export interface UpscalingUniforms {
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
  sharpening: number;
  padding: number[];
}
