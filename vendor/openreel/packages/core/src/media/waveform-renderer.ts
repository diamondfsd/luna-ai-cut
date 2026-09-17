import type { WaveformData } from "./types";
import type { MultiResolutionWaveform } from "./waveform-generator";
import {
  getWaveformGenerator,
  WAVEFORM_RESOLUTIONS,
} from "./waveform-generator";

export interface WaveformStyle {
  fillColor?: string;
  backgroundColor?: string;
  rmsColor?: string;
  showRms?: boolean;
  lineWidth?: number;
  mirror?: boolean;
  verticalPadding?: number;
  amplitudeScale?: number;
}

export interface WaveformRenderOptions {
  startTime: number;
  endTime: number;
  width: number;
  height: number;
  style?: WaveformStyle;
  devicePixelRatio?: number;
}

export interface AmplitudeInfo {
  time: number;
  peak: number;
  rms: number;
  db: number;
}

const DEFAULT_STYLE: Required<WaveformStyle> = {
  fillColor: "#4a9eff",
  backgroundColor: "transparent",
  rmsColor: "#2d7dd2",
  showRms: true,
  lineWidth: 1,
  mirror: true,
  verticalPadding: 0.1,
  amplitudeScale: 1.0,
};

export class WaveformRenderer {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;

  setCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
  }

  setWaveform(_waveform: MultiResolutionWaveform): void {
    // Reserved for future caching optimization
  }

  render(waveformData: WaveformData, options: WaveformRenderOptions): void {
    if (!this.canvas || !this.ctx) {
      throw new Error("Canvas not set. Call setCanvas() first.");
    }

    const style = { ...DEFAULT_STYLE, ...options.style };
    const dpr = options.devicePixelRatio || 1;
    this.canvas.width = options.width * dpr;
    this.canvas.height = options.height * dpr;

    // Scale context for high-DPI
    this.ctx.scale(dpr, dpr);
    if (style.backgroundColor !== "transparent") {
      this.ctx.fillStyle = style.backgroundColor;
      this.ctx.fillRect(0, 0, options.width, options.height);
    } else {
      this.ctx.clearRect(0, 0, options.width, options.height);
    }
    const duration = options.endTime - options.startTime;
    if (duration <= 0) return;

    const startSample = Math.floor(
      options.startTime * waveformData.samplesPerSecond,
    );
    const endSample = Math.ceil(
      options.endTime * waveformData.samplesPerSecond,
    );
    const sampleCount = endSample - startSample;

    if (sampleCount <= 0) return;
    const padding = options.height * style.verticalPadding;
    const waveformHeight = options.height - padding * 2;
    const centerY = options.height / 2;
    const halfHeight = (waveformHeight / 2) * style.amplitudeScale;
    const samplesPerPixel = sampleCount / options.width;
    this.ctx.fillStyle = style.fillColor;

    if (samplesPerPixel <= 1) {
      // High zoom: render each sample as a line
      this.renderHighZoom(
        waveformData,
        startSample,
        endSample,
        options.width,
        centerY,
        halfHeight,
        style,
      );
    } else {
      // Low zoom: aggregate samples per pixel
      this.renderLowZoom(
        waveformData,
        startSample,
        endSample,
        options.width,
        centerY,
        halfHeight,
        samplesPerPixel,
        style,
      );
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private renderHighZoom(
    waveformData: WaveformData,
    startSample: number,
    endSample: number,
    width: number,
    centerY: number,
    halfHeight: number,
    style: Required<WaveformStyle>,
  ): void {
    if (!this.ctx) return;

    const sampleCount = endSample - startSample;
    const pixelsPerSample = width / sampleCount;

    // Draw peak waveform
    this.ctx.beginPath();

    for (let i = 0; i < sampleCount; i++) {
      const sampleIdx = startSample + i;
      if (sampleIdx < 0 || sampleIdx >= waveformData.peaks.length) continue;

      const x = i * pixelsPerSample;
      const peak = Math.min(1, waveformData.peaks[sampleIdx]);
      const peakHeight = peak * halfHeight;

      if (style.mirror) {
        // Draw mirrored waveform
        this.ctx.moveTo(x, centerY - peakHeight);
        this.ctx.lineTo(x, centerY + peakHeight);
      } else {
        // Draw single-sided waveform
        this.ctx.moveTo(x, centerY);
        this.ctx.lineTo(x, centerY - peakHeight);
      }
    }

    this.ctx.strokeStyle = style.fillColor;
    this.ctx.lineWidth = Math.max(1, pixelsPerSample);
    this.ctx.stroke();

    // Draw RMS overlay if enabled
    if (style.showRms) {
      this.ctx.beginPath();

      for (let i = 0; i < sampleCount; i++) {
        const sampleIdx = startSample + i;
        if (sampleIdx < 0 || sampleIdx >= waveformData.rms.length) continue;

        const x = i * pixelsPerSample;
        const rms = Math.min(1, waveformData.rms[sampleIdx]);
        const rmsHeight = rms * halfHeight;

        if (style.mirror) {
          this.ctx.moveTo(x, centerY - rmsHeight);
          this.ctx.lineTo(x, centerY + rmsHeight);
        } else {
          this.ctx.moveTo(x, centerY);
          this.ctx.lineTo(x, centerY - rmsHeight);
        }
      }

      this.ctx.strokeStyle = style.rmsColor;
      this.ctx.lineWidth = Math.max(1, pixelsPerSample);
      this.ctx.stroke();
    }
  }

  private renderLowZoom(
    waveformData: WaveformData,
    startSample: number,
    _endSample: number,
    width: number,
    centerY: number,
    halfHeight: number,
    samplesPerPixel: number,
    style: Required<WaveformStyle>,
  ): void {
    if (!this.ctx) return;

    // Draw peak waveform as filled area
    this.ctx.beginPath();
    this.ctx.moveTo(0, centerY);

    // Top edge (positive peaks)
    for (let x = 0; x < width; x++) {
      const sampleStart = startSample + Math.floor(x * samplesPerPixel);
      const sampleEnd = Math.min(
        startSample + Math.floor((x + 1) * samplesPerPixel),
        waveformData.peaks.length,
      );

      let maxPeak = 0;
      for (let i = sampleStart; i < sampleEnd; i++) {
        if (i >= 0 && i < waveformData.peaks.length) {
          maxPeak = Math.max(maxPeak, waveformData.peaks[i]);
        }
      }

      const peakHeight = Math.min(1, maxPeak) * halfHeight;
      this.ctx.lineTo(x, centerY - peakHeight);
    }

    if (style.mirror) {
      // Bottom edge (mirrored)
      for (let x = width - 1; x >= 0; x--) {
        const sampleStart = startSample + Math.floor(x * samplesPerPixel);
        const sampleEnd = Math.min(
          startSample + Math.floor((x + 1) * samplesPerPixel),
          waveformData.peaks.length,
        );

        let maxPeak = 0;
        for (let i = sampleStart; i < sampleEnd; i++) {
          if (i >= 0 && i < waveformData.peaks.length) {
            maxPeak = Math.max(maxPeak, waveformData.peaks[i]);
          }
        }

        const peakHeight = Math.min(1, maxPeak) * halfHeight;
        this.ctx.lineTo(x, centerY + peakHeight);
      }
    } else {
      this.ctx.lineTo(width, centerY);
    }

    this.ctx.closePath();
    this.ctx.fillStyle = style.fillColor;
    this.ctx.fill();

    // Draw RMS overlay if enabled
    if (style.showRms) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, centerY);

      // Top edge (positive RMS)
      for (let x = 0; x < width; x++) {
        const sampleStart = startSample + Math.floor(x * samplesPerPixel);
        const sampleEnd = Math.min(
          startSample + Math.floor((x + 1) * samplesPerPixel),
          waveformData.rms.length,
        );

        let sumSquares = 0;
        let count = 0;
        for (let i = sampleStart; i < sampleEnd; i++) {
          if (i >= 0 && i < waveformData.rms.length) {
            sumSquares += waveformData.rms[i] * waveformData.rms[i];
            count++;
          }
        }

        const avgRms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
        const rmsHeight = Math.min(1, avgRms) * halfHeight;
        this.ctx.lineTo(x, centerY - rmsHeight);
      }

      if (style.mirror) {
        // Bottom edge (mirrored)
        for (let x = width - 1; x >= 0; x--) {
          const sampleStart = startSample + Math.floor(x * samplesPerPixel);
          const sampleEnd = Math.min(
            startSample + Math.floor((x + 1) * samplesPerPixel),
            waveformData.rms.length,
          );

          let sumSquares = 0;
          let count = 0;
          for (let i = sampleStart; i < sampleEnd; i++) {
            if (i >= 0 && i < waveformData.rms.length) {
              sumSquares += waveformData.rms[i] * waveformData.rms[i];
              count++;
            }
          }

          const avgRms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
          const rmsHeight = Math.min(1, avgRms) * halfHeight;
          this.ctx.lineTo(x, centerY + rmsHeight);
        }
      } else {
        this.ctx.lineTo(width, centerY);
      }

      this.ctx.closePath();
      this.ctx.fillStyle = style.rmsColor;
      this.ctx.fill();
    }
  }

  renderMultiResolution(
    multiRes: MultiResolutionWaveform,
    options: WaveformRenderOptions,
  ): void {
    const duration = options.endTime - options.startTime;
    const pixelsPerSecond = options.width / duration;
    const generator = getWaveformGenerator();
    const waveformData = generator.getWaveformForZoomLevel(
      multiRes,
      pixelsPerSecond,
    );

    if (!waveformData) {
      // Fallback to any available resolution
      const firstRes = multiRes.resolutions.values().next().value;
      if (firstRes) {
        this.render(firstRes, options);
      }
      return;
    }

    this.render(waveformData, options);
  }

  getAmplitudeAtPosition(
    waveformData: WaveformData,
    x: number,
    options: WaveformRenderOptions,
  ): AmplitudeInfo | null {
    const duration = options.endTime - options.startTime;
    const timePerPixel = duration / options.width;
    const time = options.startTime + x * timePerPixel;

    const sampleIdx = Math.floor(time * waveformData.samplesPerSecond);
    if (sampleIdx < 0 || sampleIdx >= waveformData.peaks.length) {
      return null;
    }

    const peak = waveformData.peaks[sampleIdx];
    const rms = waveformData.rms[sampleIdx];
    const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;

    return {
      time,
      peak,
      rms,
      db,
    };
  }

  toDataURL(type: string = "image/png", quality?: number): string {
    if (!this.canvas) {
      throw new Error("Canvas not set");
    }

    if (this.canvas instanceof HTMLCanvasElement) {
      return this.canvas.toDataURL(type, quality);
    }

    // For OffscreenCanvas, we need to convert differently
    throw new Error(
      "toDataURL not supported for OffscreenCanvas. Use toBlob() instead.",
    );
  }

  async toBlob(type: string = "image/png", quality?: number): Promise<Blob> {
    if (!this.canvas) {
      throw new Error("Canvas not set");
    }

    if (this.canvas instanceof OffscreenCanvas) {
      return this.canvas.convertToBlob({ type, quality });
    }

    return new Promise((resolve, reject) => {
      (this.canvas as HTMLCanvasElement).toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob"));
          }
        },
        type,
        quality,
      );
    });
  }

  static getOptimalResolution(pixelsPerSecond: number): number {
    // We want roughly 1-2 samples per pixel
    const idealSamples = pixelsPerSecond * 1.5;

    if (idealSamples <= WAVEFORM_RESOLUTIONS.OVERVIEW) {
      return WAVEFORM_RESOLUTIONS.OVERVIEW;
    } else if (idealSamples <= WAVEFORM_RESOLUTIONS.LOW) {
      return WAVEFORM_RESOLUTIONS.LOW;
    } else if (idealSamples <= WAVEFORM_RESOLUTIONS.MEDIUM) {
      return WAVEFORM_RESOLUTIONS.MEDIUM;
    } else if (idealSamples <= WAVEFORM_RESOLUTIONS.HIGH) {
      return WAVEFORM_RESOLUTIONS.HIGH;
    } else {
      return WAVEFORM_RESOLUTIONS.MAX;
    }
  }
}

export function createWaveformImage(
  waveformData: WaveformData,
  width: number,
  height: number,
  style?: WaveformStyle,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const renderer = new WaveformRenderer();
  renderer.setCanvas(canvas);
  renderer.render(waveformData, {
    startTime: 0,
    endTime: waveformData.duration,
    width,
    height,
    style,
  });
  return canvas;
}

export function createClipWaveformThumbnail(
  waveformData: WaveformData,
  clipStartTime: number,
  clipDuration: number,
  width: number,
  height: number,
  style?: WaveformStyle,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const renderer = new WaveformRenderer();
  renderer.setCanvas(canvas);
  renderer.render(waveformData, {
    startTime: clipStartTime,
    endTime: clipStartTime + clipDuration,
    width,
    height,
    style,
  });
  return canvas;
}
