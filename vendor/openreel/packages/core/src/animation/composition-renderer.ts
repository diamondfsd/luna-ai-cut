import type {
  Composition,
  Layer,
  ShapeLayer,
  TextLayer,
  ImageLayer,
  VideoLayer,
  Transform,
  PropertyKeyframes,
  EasingFunction,
} from "../types/composition";
import { EASING_FUNCTIONS, type EasingName } from "./easing-functions";

export class CompositionRenderer {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private imageCache: Map<string, HTMLImageElement | ImageBitmap> = new Map();
  private videoCache: Map<string, HTMLVideoElement> = new Map();

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false,
    })!;
  }

  async renderFrame(
    composition: Composition,
    time: number,
  ): Promise<ImageBitmap> {
    const { width, height, backgroundColor } = composition;

    this.ctx.clearRect(0, 0, width, height);

    if (backgroundColor && backgroundColor !== "#00000000") {
      this.ctx.fillStyle = backgroundColor;
      this.ctx.fillRect(0, 0, width, height);
    }

    const visibleLayers = composition.layers.filter(
      (layer) =>
        layer.visible &&
        time >= layer.startTime &&
        time < layer.startTime + layer.duration,
    );

    for (const layer of visibleLayers) {
      await this.renderLayer(layer, time);
    }

    return this.canvas.transferToImageBitmap();
  }

  private async renderLayer(layer: Layer, time: number): Promise<void> {
    const localTime = time - layer.startTime;

    const transform = this.evaluateTransform(layer, localTime);

    this.ctx.save();

    this.applyTransform(transform);

    if (layer.blendMode && layer.blendMode !== "normal") {
      this.ctx.globalCompositeOperation = this.mapBlendMode(layer.blendMode);
    }

    switch (layer.type) {
      case "shape":
        this.renderShapeLayer(layer as ShapeLayer);
        break;
      case "text":
        this.renderTextLayer(layer as TextLayer);
        break;
      case "image":
        await this.renderImageLayer(layer as ImageLayer);
        break;
      case "video":
        await this.renderVideoLayer(layer as VideoLayer, localTime);
        break;
      case "group":
        break;
    }

    this.ctx.restore();
  }

  private evaluateTransform(layer: Layer, time: number): Transform {
    const transform = { ...layer.transform };

    for (const propKeyframes of layer.keyframes) {
      const value = this.evaluateKeyframes(propKeyframes, time);
      if (value !== null) {
        this.setNestedProperty(transform, propKeyframes.property, value);
      }
    }

    return transform;
  }

  private evaluateKeyframes(
    propKeyframes: PropertyKeyframes,
    time: number,
  ): any {
    const keyframes = propKeyframes.keyframes;

    if (keyframes.length === 0) return null;
    if (keyframes.length === 1) return keyframes[0].value;

    if (time <= keyframes[0].time) return keyframes[0].value;
    if (time >= keyframes[keyframes.length - 1].time) {
      return keyframes[keyframes.length - 1].value;
    }

    for (let i = 0; i < keyframes.length - 1; i++) {
      const kf1 = keyframes[i];
      const kf2 = keyframes[i + 1];

      if (time >= kf1.time && time <= kf2.time) {
        const progress = (time - kf1.time) / (kf2.time - kf1.time);
        const easedProgress = this.applyEasing(progress, kf1.ease || "linear");

        return this.interpolateValue(kf1.value, kf2.value, easedProgress);
      }
    }

    return null;
  }

  private applyEasing(progress: number, ease: EasingFunction): number {
    const easingName = this.mapEasingName(ease);
    const easingFn = EASING_FUNCTIONS[easingName];
    return easingFn ? easingFn(progress) : progress;
  }

  private mapEasingName(ease: EasingFunction): EasingName {
    const kebabToCamel: Record<string, EasingName> = {
      linear: "linear",
      ease: "easeInOutQuad",
      "ease-in": "easeInQuad",
      "ease-out": "easeOutQuad",
      "ease-in-out": "easeInOutQuad",
      "ease-in-cubic": "easeInCubic",
      "ease-out-cubic": "easeOutCubic",
      "ease-in-out-cubic": "easeInOutCubic",
      "ease-in-quad": "easeInQuad",
      "ease-out-quad": "easeOutQuad",
      "ease-in-out-quad": "easeInOutQuad",
      "ease-in-quart": "easeInQuart",
      "ease-out-quart": "easeOutQuart",
      "ease-in-out-quart": "easeInOutQuart",
      "ease-in-quint": "easeInQuint",
      "ease-out-quint": "easeOutQuint",
      "ease-in-out-quint": "easeInOutQuint",
      "ease-in-sine": "easeInSine",
      "ease-out-sine": "easeOutSine",
      "ease-in-out-sine": "easeInOutSine",
      "ease-in-expo": "easeInExpo",
      "ease-out-expo": "easeOutExpo",
      "ease-in-out-expo": "easeInOutExpo",
      "ease-in-circ": "easeInCirc",
      "ease-out-circ": "easeOutCirc",
      "ease-in-out-circ": "easeInOutCirc",
      "ease-in-back": "easeInBack",
      "ease-out-back": "easeOutBack",
      "ease-in-out-back": "easeInOutBack",
      "ease-in-elastic": "easeInElastic",
      "ease-out-elastic": "easeOutElastic",
      "ease-in-out-elastic": "easeInOutElastic",
      "ease-in-bounce": "easeInBounce",
      "ease-out-bounce": "easeOutBounce",
      "ease-in-out-bounce": "easeInOutBounce",
    };

    return kebabToCamel[ease] || "linear";
  }

  private interpolateValue(from: any, to: any, progress: number): any {
    if (typeof from === "number" && typeof to === "number") {
      return from + (to - from) * progress;
    }

    if (typeof from === "object" && typeof to === "object") {
      const result: any = {};
      for (const key in from) {
        result[key] = this.interpolateValue(from[key], to[key], progress);
      }
      return result;
    }

    return progress < 0.5 ? from : to;
  }

  private setNestedProperty(obj: any, path: string, value: any): void {
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = value;
  }

  private applyTransform(transform: Transform): void {
    this.ctx.globalAlpha = transform.opacity;

    this.ctx.translate(transform.position.x, transform.position.y);

    if (transform.rotation !== 0) {
      this.ctx.rotate((transform.rotation * Math.PI) / 180);
    }

    this.ctx.scale(transform.scale.x, transform.scale.y);

    if (transform.anchorPoint) {
      this.ctx.translate(-transform.anchorPoint.x, -transform.anchorPoint.y);
    }
  }

  private renderShapeLayer(layer: ShapeLayer): void {
    const { shapeType, fill, stroke } = layer;

    this.ctx.beginPath();

    switch (shapeType) {
      case "rectangle":
        this.ctx.rect(-50, -50, 100, 100);
        break;
      case "circle":
        this.ctx.arc(0, 0, 50, 0, Math.PI * 2);
        break;
      case "ellipse":
        this.ctx.ellipse(0, 0, 60, 40, 0, 0, Math.PI * 2);
        break;
      case "polygon":
        this.renderPolygon(layer.points || 5, 50);
        break;
      case "path":
        if (layer.path) {
          this.renderBezierPath(layer.path);
        }
        break;
    }

    if (fill && fill.type !== "none") {
      if (fill.type === "solid" && fill.color) {
        this.ctx.fillStyle = fill.color;
        this.ctx.fill();
      } else if (fill.type === "gradient" && fill.gradient) {
        const gradient = this.createGradient(fill.gradient);
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
      }
    }

    if (stroke) {
      this.ctx.strokeStyle = stroke.color;
      this.ctx.lineWidth = stroke.width;
      if (stroke.lineCap) this.ctx.lineCap = stroke.lineCap;
      if (stroke.lineJoin) this.ctx.lineJoin = stroke.lineJoin;
      if (stroke.dashArray) this.ctx.setLineDash(stroke.dashArray);
      this.ctx.stroke();
    }
  }

  private renderPolygon(sides: number, radius: number): void {
    for (let i = 0; i < sides; i++) {
      const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
  }

  private renderBezierPath(path: any): void {
    if (!path.points || path.points.length === 0) return;

    const firstPoint = path.points[0];
    this.ctx.moveTo(firstPoint.point.x, firstPoint.point.y);

    for (let i = 1; i < path.points.length; i++) {
      const point = path.points[i];
      const prevPoint = path.points[i - 1];

      if (point.inTangent || prevPoint.outTangent) {
        const cp1 = prevPoint.outTangent || prevPoint.point;
        const cp2 = point.inTangent || point.point;
        this.ctx.bezierCurveTo(
          cp1.x,
          cp1.y,
          cp2.x,
          cp2.y,
          point.point.x,
          point.point.y,
        );
      } else {
        this.ctx.lineTo(point.point.x, point.point.y);
      }
    }

    if (path.closed) {
      this.ctx.closePath();
    }
  }

  private createGradient(gradientDef: any): CanvasGradient {
    let gradient: CanvasGradient;

    if (gradientDef.type === "linear") {
      const start = gradientDef.start || { x: 0, y: 0 };
      const end = gradientDef.end || { x: 100, y: 100 };
      gradient = this.ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    } else {
      const center = gradientDef.center || { x: 0, y: 0 };
      const radius = gradientDef.radius || 50;
      gradient = this.ctx.createRadialGradient(
        center.x,
        center.y,
        0,
        center.x,
        center.y,
        radius,
      );
    }

    for (const stop of gradientDef.stops) {
      gradient.addColorStop(stop.offset, stop.color);
    }

    return gradient;
  }

  private renderTextLayer(layer: TextLayer): void {
    const { content, style } = layer;

    this.ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    this.ctx.fillStyle = style.color;
    this.ctx.textAlign = style.textAlign as CanvasTextAlign;
    this.ctx.textBaseline = "middle";

    if (style.letterSpacing) {
      this.renderTextWithLetterSpacing(content, 0, 0, style.letterSpacing);
    } else {
      this.ctx.fillText(content, 0, 0);
    }
  }

  private renderTextWithLetterSpacing(
    text: string,
    x: number,
    y: number,
    spacing: number,
  ): void {
    let currentX = x;
    for (const char of text) {
      this.ctx.fillText(char, currentX, y);
      const metrics = this.ctx.measureText(char);
      currentX += metrics.width + spacing;
    }
  }

  private async renderImageLayer(layer: ImageLayer): Promise<void> {
    let image = this.imageCache.get(layer.imageUrl);

    if (!image) {
      image = await this.loadImage(layer.imageUrl);
      this.imageCache.set(layer.imageUrl, image);
    }

    if (image instanceof HTMLImageElement) {
      this.ctx.drawImage(image, -image.width / 2, -image.height / 2);
    } else if (image instanceof ImageBitmap) {
      this.ctx.drawImage(image, -image.width / 2, -image.height / 2);
    }
  }

  private async renderVideoLayer(
    layer: VideoLayer,
    time: number,
  ): Promise<void> {
    let video = this.videoCache.get(layer.videoUrl);

    if (!video) {
      video = await this.loadVideo(layer.videoUrl);
      this.videoCache.set(layer.videoUrl, video);
    }

    video.currentTime = time;

    this.ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
  }

  private async loadImage(
    url: string,
  ): Promise<HTMLImageElement | ImageBitmap> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  private async loadVideo(url: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.onloadeddata = () => resolve(video);
      video.onerror = reject;
      video.src = url;
      video.load();
    });
  }

  private mapBlendMode(blendMode: string): GlobalCompositeOperation {
    const blendModeMap: Record<string, GlobalCompositeOperation> = {
      normal: "source-over",
      multiply: "multiply",
      screen: "screen",
      overlay: "overlay",
      darken: "darken",
      lighten: "lighten",
      "color-dodge": "color-dodge",
      "color-burn": "color-burn",
      "hard-light": "hard-light",
      "soft-light": "soft-light",
      difference: "difference",
      exclusion: "exclusion",
      hue: "hue",
      saturation: "saturation",
      color: "color",
      luminosity: "luminosity",
    };

    return blendModeMap[blendMode] || "source-over";
  }

  resize(width: number, height: number): void {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext("2d", { alpha: true })!;
  }

  clearCache(): void {
    this.imageCache.clear();
    this.videoCache.clear();
  }
}
