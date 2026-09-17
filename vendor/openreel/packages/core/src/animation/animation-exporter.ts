import type {
  AnimationSchema,
  ProjectConfig,
  AssetDefinitions,
  LayerDefinition,
  TextLayer,
  ShapeLayer,
  ImageLayer,
  VideoLayer,
  AnimationDefinition,
  KeyframeDefinition,
  TextStyle,
  StrokeStyle,
  ShadowStyle,
  RectangleShape,
  EllipseShape,
  PolygonShape,
  StarShape,
  AudioConfig,
  AudioTrackConfig,
} from "./animation-schema";
import type { Project, MediaItem } from "../types/project";
import type { Clip, Keyframe, EasingType } from "../types/timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, ShapeType } from "../graphics/types";
import { getMediaItemCapabilities } from "../timeline/timeline-items";

export interface ExportResult {
  success: boolean;
  schema?: AnimationSchema;
  json?: string;
  errors: string[];
  warnings: string[];
}

export interface ExportOptions {
  prettyPrint?: boolean;
  includeIds?: boolean;
  version?: string;
}

interface GroupedKeyframes {
  [property: string]: Keyframe[];
}

export class AnimationExporter {
  export(
    project: Project,
    textClips: TextClip[] = [],
    shapeClips: ShapeClip[] = [],
    options: ExportOptions = {},
  ): ExportResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const projectConfig: ProjectConfig = {
        name: project.name,
        width: project.settings.width,
        height: project.settings.height,
        fps: project.settings.frameRate,
        duration: project.timeline.duration,
        backgroundColor: "#000000",
      };

      const assets = this.exportAssets(project.mediaLibrary.items);
      const layers: LayerDefinition[] = [];

      for (const textClip of textClips) {
        const layer = this.exportTextClip(
          textClip,
          project.settings.width,
          project.settings.height,
        );
        layers.push(layer);
      }

      for (const shapeClip of shapeClips) {
        const layer = this.exportShapeClip(
          shapeClip,
          project.settings.width,
          project.settings.height,
        );
        layers.push(layer);
      }

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          const mediaItem = project.mediaLibrary.items.find(
            (item) => item.id === clip.mediaId,
          );
          if (!mediaItem) {
            warnings.push(`Media item not found for clip ${clip.id}`);
            continue;
          }

          if (mediaItem.type === "image") {
            const layer = this.exportImageClip(
              clip,
              mediaItem,
              options.includeIds,
            );
            layers.push(layer);
          } else if (mediaItem.type === "video") {
            const layer = this.exportVideoClip(
              clip,
              mediaItem,
              options.includeIds,
            );
            layers.push(layer);
          }
        }
      }

      const audioConfig = this.exportAudioTracks(project);

      const schema: AnimationSchema = {
        version: options.version || "1.0",
        project: projectConfig,
        assets,
        layers,
        audio: audioConfig,
        variables: {},
      };

      const json = options.prettyPrint
        ? JSON.stringify(schema, null, 2)
        : JSON.stringify(schema);

      return {
        success: errors.length === 0,
        schema,
        json,
        errors,
        warnings,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          error instanceof Error ? error.message : "Unknown export error",
        ],
        warnings,
      };
    }
  }

  private exportAssets(mediaItems: MediaItem[]): AssetDefinitions {
    const assets: AssetDefinitions = {
      fonts: [],
      images: [],
      videos: [],
      audio: [],
      lottie: [],
    };

    for (const item of mediaItems) {
      if (item.type === "image") {
        assets.images?.push({
          id: item.id,
          url: item.thumbnailUrl || "",
          width: item.metadata.width,
          height: item.metadata.height,
        });
      } else if (item.type === "video") {
        assets.videos?.push({
          id: item.id,
          url: item.thumbnailUrl || "",
          duration: item.metadata.duration,
        });
      } else if (item.type === "audio") {
        assets.audio?.push({
          id: item.id,
          url: item.thumbnailUrl || "",
          duration: item.metadata.duration,
        });
      }
    }

    return assets;
  }

  private exportTextClip(
    clip: TextClip,
    _canvasWidth: number,
    _canvasHeight: number,
  ): TextLayer {
    const textStyle: TextStyle = {
      fontFamily: clip.style.fontFamily,
      fontSize: clip.style.fontSize,
      fontWeight:
        typeof clip.style.fontWeight === "string"
          ? clip.style.fontWeight === "bold"
            ? 700
            : 400
          : clip.style.fontWeight,
      fontStyle: clip.style.fontStyle,
      fill: clip.style.color,
      textAlign:
        clip.style.textAlign === "justify" ? "left" : clip.style.textAlign,
      verticalAlign: clip.style.verticalAlign,
      lineHeight: clip.style.lineHeight,
      letterSpacing: clip.style.letterSpacing,
    };

    if (clip.style.strokeColor && clip.style.strokeWidth) {
      const stroke: StrokeStyle = {
        color: clip.style.strokeColor,
        width: clip.style.strokeWidth,
      };
      textStyle.stroke = stroke;
    }

    if (clip.style.shadowColor && clip.style.shadowBlur !== undefined) {
      const shadow: ShadowStyle = {
        color: clip.style.shadowColor,
        blur: clip.style.shadowBlur,
        offsetX: clip.style.shadowOffsetX || 0,
        offsetY: clip.style.shadowOffsetY || 0,
      };
      textStyle.shadow = shadow;
    }

    const animations = this.convertKeyframesToAnimations(clip.keyframes);

    return {
      id: clip.id,
      type: "text",
      content: clip.text,
      style: textStyle,
      startTime: clip.startTime,
      duration: clip.duration,
      position: {
        x: clip.transform.position.x,
        y: clip.transform.position.y,
      },
      scale: {
        x: clip.transform.scale.x,
        y: clip.transform.scale.y,
      },
      rotation: clip.transform.rotation,
      anchor: {
        x: clip.transform.anchor.x,
        y: clip.transform.anchor.y,
      },
      opacity: clip.transform.opacity,
      animations,
    };
  }

  private exportShapeClip(
    clip: ShapeClip,
    _canvasWidth: number,
    _canvasHeight: number,
  ): ShapeLayer {
    const shapeDefinition = this.createShapeDefinition(clip.shapeType);
    const animations = this.convertKeyframesToAnimations(clip.keyframes);

    return {
      id: clip.id,
      type: "shape",
      shape: shapeDefinition,
      fill: clip.style.fill.color || "#ffffff",
      stroke: clip.style.stroke
        ? {
            color: clip.style.stroke.color,
            width: clip.style.stroke.width,
            lineCap: clip.style.stroke.lineCap,
            lineJoin: clip.style.stroke.lineJoin,
          }
        : undefined,
      startTime: clip.startTime,
      duration: clip.duration,
      position: {
        x: clip.transform.position.x,
        y: clip.transform.position.y,
      },
      scale: {
        x: clip.transform.scale.x,
        y: clip.transform.scale.y,
      },
      rotation: clip.transform.rotation,
      anchor: {
        x: clip.transform.anchor.x,
        y: clip.transform.anchor.y,
      },
      opacity: clip.transform.opacity,
      animations,
    };
  }

  private createShapeDefinition(
    shapeType: ShapeType,
  ): RectangleShape | EllipseShape | PolygonShape | StarShape {
    switch (shapeType) {
      case "rectangle":
        return { type: "rectangle", width: 100, height: 100 };
      case "circle":
      case "ellipse":
        return { type: "ellipse", width: 100, height: 100 };
      case "triangle":
        return { type: "polygon", sides: 3, radius: 50 };
      case "polygon":
        return { type: "polygon", sides: 6, radius: 50 };
      case "star":
        return { type: "star", points: 5, innerRadius: 25, outerRadius: 50 };
      default:
        return { type: "rectangle", width: 100, height: 100 };
    }
  }

  private exportImageClip(
    clip: Clip,
    mediaItem: MediaItem,
    includeIds?: boolean,
  ): ImageLayer {
    const animations = this.convertKeyframesToAnimations(clip.keyframes);

    return {
      id: includeIds ? clip.id : `image-${Date.now()}`,
      type: "image",
      assetId: mediaItem.id,
      startTime: clip.startTime,
      duration: clip.duration,
      position: {
        x: clip.transform.position.x,
        y: clip.transform.position.y,
      },
      scale: {
        x: clip.transform.scale.x,
        y: clip.transform.scale.y,
      },
      rotation: clip.transform.rotation,
      anchor: {
        x: clip.transform.anchor.x,
        y: clip.transform.anchor.y,
      },
      opacity: clip.transform.opacity,
      animations,
    };
  }

  private exportVideoClip(
    clip: Clip,
    mediaItem: MediaItem,
    includeIds?: boolean,
  ): VideoLayer {
    const animations = this.convertKeyframesToAnimations(clip.keyframes);

    return {
      id: includeIds ? clip.id : `video-${Date.now()}`,
      type: "video",
      assetId: mediaItem.id,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      muted: clip.volume === 0,
      position: {
        x: clip.transform.position.x,
        y: clip.transform.position.y,
      },
      scale: {
        x: clip.transform.scale.x,
        y: clip.transform.scale.y,
      },
      rotation: clip.transform.rotation,
      anchor: {
        x: clip.transform.anchor.x,
        y: clip.transform.anchor.y,
      },
      opacity: clip.transform.opacity,
      animations,
    };
  }

  private exportAudioTracks(project: Project): AudioConfig {
    const audioTracks: AudioTrackConfig[] = [];

    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const mediaItem = project.mediaLibrary.items.find(
          (item) => item.id === clip.mediaId,
        );
        if (!mediaItem || !getMediaItemCapabilities(mediaItem).audio) continue;

        audioTracks.push({
          assetId: clip.mediaId,
          startTime: clip.startTime,
          duration: clip.duration,
          volume: clip.volume,
        });
      }
    }

    return { tracks: audioTracks };
  }

  private convertKeyframesToAnimations(
    keyframes: Keyframe[],
  ): AnimationDefinition[] {
    if (keyframes.length === 0) return [];

    const grouped: GroupedKeyframes = {};

    for (const kf of keyframes) {
      if (!grouped[kf.property]) {
        grouped[kf.property] = [];
      }
      grouped[kf.property].push(kf);
    }

    const animations: AnimationDefinition[] = [];

    for (const [property, kfs] of Object.entries(grouped)) {
      const sortedKfs = [...kfs].sort((a, b) => a.time - b.time);

      const keyframeDefs: KeyframeDefinition[] = sortedKfs.map((kf) => ({
        time: kf.time,
        value: kf.value,
        easing: kf.easing as EasingType,
      }));

      animations.push({
        property: property as AnimationDefinition["property"],
        keyframes: keyframeDefs,
      });
    }

    return animations;
  }
}

export const animationExporter = new AnimationExporter();

export function exportAnimation(
  project: Project,
  textClips?: TextClip[],
  shapeClips?: ShapeClip[],
  options?: ExportOptions,
): ExportResult {
  return animationExporter.export(project, textClips, shapeClips, options);
}

export function exportAnimationToJSON(
  project: Project,
  textClips?: TextClip[],
  shapeClips?: ShapeClip[],
  options?: ExportOptions,
): string {
  const result = exportAnimation(project, textClips, shapeClips, {
    ...options,
    prettyPrint: true,
  });
  return result.json || "{}";
}
