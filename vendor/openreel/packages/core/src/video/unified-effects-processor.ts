import type { Effect } from "../types/timeline";
import { isWebGPUSupported } from "./renderer-factory";

export interface ColorGradingParams {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  shadows?: number;
  midtones?: number;
  highlights?: number;
}

export interface ProcessingResult {
  frame: ImageBitmap;
  processingTime: number;
}

export class UnifiedEffectsProcessor {
  private device: GPUDevice | null = null;
  private useGPU: boolean = false;
  private width: number;
  private height: number;
  private initialized: boolean = false;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(width: number = 1920, height: number = 1080) {
    this.width = width;
    this.height = height;
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    // Try WebGPU first
    if (isWebGPUSupported()) {
      try {
        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: "high-performance",
        });

        if (adapter) {
          this.device = await adapter.requestDevice();
          this.useGPU = true;
        }
      } catch (error) {
        console.warn("[UnifiedEffectsProcessor] WebGPU init failed:", error);
      }
    }

    // Fallback to Canvas2D
    if (!this.useGPU) {
      this.canvas = new OffscreenCanvas(this.width, this.height);
      this.ctx = this.canvas.getContext("2d");
    }

    this.initialized = true;
    return true;
  }

  async processFrame(
    frame: ImageBitmap,
    effects: Effect[],
    colorGrading?: ColorGradingParams,
  ): Promise<ProcessingResult> {
    const startTime = performance.now();

    if (!this.initialized) {
      await this.initialize();
    }

    let processedFrame = frame;
    const enabledEffects = effects.filter((e) => e.enabled);

    if (enabledEffects.length === 0 && !colorGrading) {
      return { frame, processingTime: 0 };
    }

    if (this.useGPU && this.device) {
      processedFrame = await this.processWithWebGPU(
        frame,
        enabledEffects,
        colorGrading,
      );
    } else {
      processedFrame = await this.processWithCanvas2D(
        frame,
        enabledEffects,
        colorGrading,
      );
    }

    const processingTime = performance.now() - startTime;
    return { frame: processedFrame, processingTime };
  }

  private async processWithWebGPU(
    frame: ImageBitmap,
    effects: Effect[],
    colorGrading?: ColorGradingParams,
  ): Promise<ImageBitmap> {
    // For now, use Canvas2D as a working fallback
    return this.processWithCanvas2D(frame, effects, colorGrading);
  }

  private async processWithCanvas2D(
    frame: ImageBitmap,
    effects: Effect[],
    colorGrading?: ColorGradingParams,
  ): Promise<ImageBitmap> {
    if (!this.canvas || !this.ctx) {
      this.canvas = new OffscreenCanvas(frame.width, frame.height);
      this.ctx = this.canvas.getContext("2d");
    }

    if (!this.ctx) {
      return frame;
    }

    // Resize canvas if needed
    if (
      this.canvas.width !== frame.width ||
      this.canvas.height !== frame.height
    ) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    const filters = this.buildFilterString(effects, colorGrading);
    this.ctx.filter = filters || "none";
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(frame, 0, 0);
    this.ctx.filter = "none";

    return createImageBitmap(this.canvas);
  }

  private buildFilterString(
    effects: Effect[],
    colorGrading?: ColorGradingParams,
  ): string {
    const filters: string[] = [];
    for (const effect of effects) {
      if (!effect.enabled) continue;

      const params = effect.params as Record<string, number>;

      switch (effect.type) {
        case "brightness":
          // Effect value typically -1 to 1, so map to 0 to 2
          const brightness = 1 + (params.value ?? 0);
          filters.push(`brightness(${brightness})`);
          break;

        case "contrast":
          const contrast = 1 + (params.value ?? 0);
          filters.push(`contrast(${contrast})`);
          break;

        case "saturation":
          const saturation = 1 + (params.value ?? 0);
          filters.push(`saturate(${saturation})`);
          break;

        case "blur":
          const blur = params.radius ?? params.value ?? 0;
          if (blur > 0) {
            filters.push(`blur(${blur}px)`);
          }
          break;

        case "hue":
          const hue = params.value ?? 0;
          filters.push(`hue-rotate(${hue * 360}deg)`);
          break;

        case "grayscale":
          const grayscale = params.value ?? 1;
          filters.push(`grayscale(${grayscale})`);
          break;

        case "sepia":
          const sepia = params.value ?? 1;
          filters.push(`sepia(${sepia})`);
          break;

        case "invert":
          const invert = params.value ?? 1;
          filters.push(`invert(${invert})`);
          break;
      }
    }
    if (colorGrading) {
      if (
        colorGrading.brightness !== undefined &&
        colorGrading.brightness !== 0
      ) {
        filters.push(`brightness(${1 + colorGrading.brightness})`);
      }
      if (colorGrading.contrast !== undefined && colorGrading.contrast !== 1) {
        filters.push(`contrast(${colorGrading.contrast})`);
      }
      if (
        colorGrading.saturation !== undefined &&
        colorGrading.saturation !== 1
      ) {
        filters.push(`saturate(${colorGrading.saturation})`);
      }
    }

    return filters.join(" ");
  }

  async applyEffect(
    frame: ImageBitmap,
    effectType: string,
    value: number,
  ): Promise<ImageBitmap> {
    const effect: Effect = {
      id: "temp",
      type: effectType as Effect["type"],
      enabled: true,
      params: { value },
    };
    const result = await this.processFrame(frame, [effect]);
    return result.frame;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  isUsingGPU(): boolean {
    return this.useGPU;
  }

  dispose(): void {
    this.device = null;
    this.canvas = null;
    this.ctx = null;
    this.initialized = false;
  }
}
let instance: UnifiedEffectsProcessor | null = null;

export function getUnifiedEffectsProcessor(): UnifiedEffectsProcessor {
  if (!instance) {
    instance = new UnifiedEffectsProcessor();
  }
  return instance;
}

export async function initUnifiedEffectsProcessor(
  width?: number,
  height?: number,
): Promise<UnifiedEffectsProcessor> {
  if (!instance) {
    instance = new UnifiedEffectsProcessor(width, height);
  }
  await instance.initialize();
  return instance;
}
