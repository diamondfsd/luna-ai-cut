import { generateId } from "../utils";
import type { Effect } from "../types/timeline";
import type { PhotoProject, AdjustmentType, AdjustmentParams } from "./types";

export interface AdjustmentLayerConfig {
  type: AdjustmentType;
  params: AdjustmentParams[AdjustmentType];
}

export class PhotoAdjustmentEngine {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  createAdjustment<T extends AdjustmentType>(
    type: T,
    params: AdjustmentParams[T],
  ): Effect {
    return {
      id: generateId(),
      type,
      enabled: true,
      params: params as Record<string, unknown>,
    };
  }

  addAdjustmentToLayer(
    project: PhotoProject,
    layerId: string,
    adjustment: Effect,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId
          ? { ...layer, adjustments: [...layer.adjustments, adjustment] }
          : layer,
      ),
    };
  }

  removeAdjustmentFromLayer(
    project: PhotoProject,
    layerId: string,
    adjustmentId: string,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              adjustments: layer.adjustments.filter(
                (a) => a.id !== adjustmentId,
              ),
            }
          : layer,
      ),
    };
  }

  updateAdjustment(
    project: PhotoProject,
    layerId: string,
    adjustmentId: string,
    params: Record<string, unknown>,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              adjustments: layer.adjustments.map((a) =>
                a.id === adjustmentId ? { ...a, params } : a,
              ),
            }
          : layer,
      ),
    };
  }

  async applyBrightness(
    image: ImageBitmap,
    value: number,
  ): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Shift luminance values
    const adjustment = value * 255;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.max(0, Math.min(255, data[i] + adjustment));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + adjustment));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + adjustment));
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyContrast(image: ImageBitmap, value: number): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Expand/compress around midpoint
    const factor = value;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.max(0, Math.min(255, (data[i] - 128) * factor + 128));
      data[i + 1] = Math.max(
        0,
        Math.min(255, (data[i + 1] - 128) * factor + 128),
      );
      data[i + 2] = Math.max(
        0,
        Math.min(255, (data[i + 2] - 128) * factor + 128),
      );
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applySaturation(
    image: ImageBitmap,
    value: number,
  ): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Adjust color intensity
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      data[i] = Math.max(0, Math.min(255, luminance + (r - luminance) * value));
      data[i + 1] = Math.max(
        0,
        Math.min(255, luminance + (g - luminance) * value),
      );
      data[i + 2] = Math.max(
        0,
        Math.min(255, luminance + (b - luminance) * value),
      );
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyTemperature(
    image: ImageBitmap,
    value: number,
  ): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Shift color balance
    const warmth = value * 30; // Scale factor for visible effect
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.max(0, Math.min(255, data[i] + warmth));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] - warmth));
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyExposure(image: ImageBitmap, value: number): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const multiplier = Math.pow(2, value);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.max(0, Math.min(255, data[i] * multiplier));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * multiplier));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * multiplier));
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyHighlights(
    image: ImageBitmap,
    value: number,
  ): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Adjust only bright pixels
    const adjustment = value * 50;
    for (let i = 0; i < data.length; i += 4) {
      const luminance =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const highlightWeight = Math.max(0, (luminance - 128) / 127);

      data[i] = Math.max(
        0,
        Math.min(255, data[i] + adjustment * highlightWeight),
      );
      data[i + 1] = Math.max(
        0,
        Math.min(255, data[i + 1] + adjustment * highlightWeight),
      );
      data[i + 2] = Math.max(
        0,
        Math.min(255, data[i + 2] + adjustment * highlightWeight),
      );
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyShadows(image: ImageBitmap, value: number): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Adjust only dark pixels
    const adjustment = value * 50;
    for (let i = 0; i < data.length; i += 4) {
      const luminance =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const shadowWeight = Math.max(0, (128 - luminance) / 128);

      data[i] = Math.max(0, Math.min(255, data[i] + adjustment * shadowWeight));
      data[i + 1] = Math.max(
        0,
        Math.min(255, data[i + 1] + adjustment * shadowWeight),
      );
      data[i + 2] = Math.max(
        0,
        Math.min(255, data[i + 2] + adjustment * shadowWeight),
      );
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyVibrance(image: ImageBitmap, value: number): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Vibrance increases saturation more for less saturated colors
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;

      // Less saturated colors get more boost
      const boost = (1 - saturation) * value;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

      data[i] = Math.max(
        0,
        Math.min(255, luminance + (r - luminance) * (1 + boost)),
      );
      data[i + 1] = Math.max(
        0,
        Math.min(255, luminance + (g - luminance) * (1 + boost)),
      );
      data[i + 2] = Math.max(
        0,
        Math.min(255, luminance + (b - luminance) * (1 + boost)),
      );
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async applyAdjustments(
    image: ImageBitmap,
    adjustments: Effect[],
  ): Promise<ImageBitmap> {
    let result = image;

    for (const adjustment of adjustments) {
      if (!adjustment.enabled) continue;

      const params = adjustment.params as Record<string, number>;
      const value = params.value ?? 0;

      switch (adjustment.type) {
        case "brightness":
          result = await this.applyBrightness(result, value);
          break;
        case "contrast":
          result = await this.applyContrast(result, value);
          break;
        case "saturation":
          result = await this.applySaturation(result, value);
          break;
        case "temperature":
          result = await this.applyTemperature(result, value);
          break;
        case "exposure":
          result = await this.applyExposure(result, value);
          break;
        case "highlights":
          result = await this.applyHighlights(result, value);
          break;
        case "shadows":
          result = await this.applyShadows(result, value);
          break;
        case "vibrance":
          result = await this.applyVibrance(result, value);
          break;
      }
    }

    return result;
  }

  private getCanvas(
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
    if (
      !this.canvas ||
      this.canvas.width !== width ||
      this.canvas.height !== height
    ) {
      this.canvas = new OffscreenCanvas(width, height);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    return { canvas: this.canvas, ctx: this.ctx! };
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}
let adjustmentEngineInstance: PhotoAdjustmentEngine | null = null;

export function getPhotoAdjustmentEngine(): PhotoAdjustmentEngine {
  if (!adjustmentEngineInstance) {
    adjustmentEngineInstance = new PhotoAdjustmentEngine();
  }
  return adjustmentEngineInstance;
}
