import { v4 as uuidv4 } from "uuid";
import type {
  AnimationSchema,
  LayerDefinition,
  TextLayer,
  ShapeLayer,
  ImageLayer,
  VideoLayer,
  AnimationDefinition,
} from "./animation-schema";
import {
  validateAnimationSchema,
  substituteVariables,
} from "./animation-schema";
import type {
  Timeline,
  Track,
  Clip,
  Keyframe,
  Transform,
  EasingType,
} from "../types/timeline";
import type { Project, MediaItem, MediaMetadata } from "../types/project";
import type {
  TextClip,
  TextStyle as CoreTextStyle,
  FontWeight,
} from "../text/types";
import type {
  ShapeClip,
  ShapeType,
  ShapeStyle,
  FillStyle,
  StrokeStyle as CoreStrokeStyle,
} from "../graphics/types";

export interface ImportResult {
  success: boolean;
  project?: Project;
  mediaItems?: MediaItem[];
  textClips?: TextClip[];
  shapeClips?: ShapeClip[];
  errors: string[];
  warnings: string[];
}

export interface ImportOptions {
  variables?: Record<string, unknown>;
  generateIds?: boolean;
  validateSchema?: boolean;
}

function createDefaultMediaMetadata(
  type: "video" | "audio" | "image",
  overrides: Partial<MediaMetadata> = {},
): MediaMetadata {
  return {
    duration: 0,
    width: type === "audio" ? 0 : 1920,
    height: type === "audio" ? 0 : 1080,
    frameRate: type === "video" ? 30 : 0,
    codec: "",
    sampleRate: type === "audio" ? 48000 : 0,
    channels: type === "audio" ? 2 : 0,
    fileSize: 0,
    ...overrides,
  };
}

function parseFontWeight(weight: number | string | undefined): FontWeight {
  if (weight === undefined || weight === "normal") return "normal";
  if (weight === "bold") return "bold";
  if (typeof weight === "number") {
    const validWeights: FontWeight[] = [
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ];
    if (validWeights.includes(weight as FontWeight)) {
      return weight as FontWeight;
    }
  }
  return "normal";
}

function mapShapeType(schemaType: string, sides?: number): ShapeType {
  switch (schemaType) {
    case "rectangle":
      return "rectangle";
    case "ellipse":
      return "ellipse";
    case "circle":
      return "circle";
    case "polygon":
      if (sides === 3) return "triangle";
      return "polygon";
    case "star":
      return "star";
    default:
      return "rectangle";
  }
}

export class AnimationImporter {
  import(schema: AnimationSchema, options: ImportOptions = {}): ImportResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (options.validateSchema !== false) {
      const validation = validateAnimationSchema(schema);
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          warnings: [],
        };
      }
    }

    let processedSchema = schema;
    if (options.variables) {
      processedSchema = substituteVariables(schema, options.variables);
    }

    try {
      const projectId = options.generateIds
        ? uuidv4()
        : `project-${Date.now()}`;
      const mediaItems: MediaItem[] = [];
      const textClips: TextClip[] = [];
      const shapeClips: ShapeClip[] = [];

      const videoTrackId = `track-video-${Date.now()}`;
      const audioTrackId = `track-audio-${Date.now()}`;

      const videoTrack: Track = {
        id: videoTrackId,
        type: "video",
        name: "Video Track",
        clips: [],
        transitions: [],
        hidden: false,
        locked: false,
        muted: false,
        solo: false,
      };

      const audioTrack: Track = {
        id: audioTrackId,
        type: "audio",
        name: "Audio Track",
        clips: [],
        transitions: [],
        hidden: false,
        locked: false,
        muted: false,
        solo: false,
      };

      if (processedSchema.assets?.images) {
        for (const imageAsset of processedSchema.assets.images) {
          mediaItems.push({
            id: imageAsset.id,
            name: imageAsset.id,
            type: "image",
            fileHandle: null,
            blob: null,
            thumbnailUrl: imageAsset.url,
            waveformData: null,
            metadata: createDefaultMediaMetadata("image", {
              width: imageAsset.width || 1920,
              height: imageAsset.height || 1080,
            }),
          });
        }
      }

      if (processedSchema.assets?.videos) {
        for (const videoAsset of processedSchema.assets.videos) {
          mediaItems.push({
            id: videoAsset.id,
            name: videoAsset.id,
            type: "video",
            fileHandle: null,
            blob: null,
            thumbnailUrl: videoAsset.url,
            waveformData: null,
            metadata: createDefaultMediaMetadata("video", {
              duration: videoAsset.duration || 5,
            }),
          });
        }
      }

      if (processedSchema.assets?.audio) {
        for (const audioAsset of processedSchema.assets.audio) {
          mediaItems.push({
            id: audioAsset.id,
            name: audioAsset.id,
            type: "audio",
            fileHandle: null,
            blob: null,
            thumbnailUrl: null,
            waveformData: null,
            metadata: createDefaultMediaMetadata("audio", {
              duration: audioAsset.duration || 5,
            }),
          });
        }
      }

      for (const layer of processedSchema.layers) {
        const result = this.processLayer(
          layer,
          processedSchema,
          videoTrack,
          videoTrackId,
          textClips,
          shapeClips,
          warnings,
        );
        if (!result.success && result.error) {
          errors.push(result.error);
        }
      }

      if (processedSchema.audio?.tracks) {
        for (const audioConfig of processedSchema.audio.tracks) {
          const clip: Clip = {
            id: `clip-audio-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            mediaId: audioConfig.assetId,
            trackId: audioTrack.id,
            startTime: audioConfig.startTime,
            duration: audioConfig.duration || processedSchema.project.duration,
            inPoint: 0,
            outPoint: audioConfig.duration || processedSchema.project.duration,
            effects: [],
            audioEffects: [],
            transform: this.createDefaultTransform(),
            volume: audioConfig.volume ?? 1,
            keyframes: [],
          };
          (audioTrack.clips as Clip[]).push(clip);
        }
      }

      const timeline: Timeline = {
        tracks: [videoTrack, audioTrack],
        duration: processedSchema.project.duration,
        markers: [],
        subtitles: [],
      };

      const project: Project = {
        id: projectId,
        name: processedSchema.project.name,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        timeline,
        settings: {
          width: processedSchema.project.width,
          height: processedSchema.project.height,
          frameRate: processedSchema.project.fps,
          sampleRate: 48000,
          channels: 2,
        },
        mediaLibrary: {
          items: mediaItems,
        },
      };

      return {
        success: errors.length === 0,
        project,
        mediaItems,
        textClips,
        shapeClips,
        errors,
        warnings,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          error instanceof Error ? error.message : "Unknown import error",
        ],
        warnings,
      };
    }
  }

  private processLayer(
    layer: LayerDefinition,
    schema: AnimationSchema,
    videoTrack: Track,
    videoTrackId: string,
    textClips: TextClip[],
    shapeClips: ShapeClip[],
    warnings: string[],
  ): { success: boolean; error?: string } {
    switch (layer.type) {
      case "text":
        return this.processTextLayer(
          layer as TextLayer,
          schema,
          videoTrackId,
          textClips,
        );
      case "shape":
        return this.processShapeLayer(
          layer as ShapeLayer,
          schema,
          videoTrackId,
          shapeClips,
        );
      case "image":
        return this.processImageLayer(layer as ImageLayer, schema, videoTrack);
      case "video":
        return this.processVideoLayer(layer as VideoLayer, schema, videoTrack);
      case "group":
        warnings.push(`Group layers not fully supported yet: ${layer.id}`);
        return { success: true };
      case "lottie":
        warnings.push(`Lottie layers not supported yet: ${layer.id}`);
        return { success: true };
      case "particle":
        warnings.push(`Particle layers not supported yet: ${layer.id}`);
        return { success: true };
      default:
        return {
          success: false,
          error: `Unknown layer type: ${(layer as LayerDefinition).type}`,
        };
    }
  }

  private processTextLayer(
    layer: TextLayer,
    schema: AnimationSchema,
    trackId: string,
    textClips: TextClip[],
  ): { success: boolean; error?: string } {
    const textStyle: CoreTextStyle = {
      fontFamily: layer.style.fontFamily || "Arial",
      fontSize: layer.style.fontSize || 48,
      fontWeight: parseFontWeight(layer.style.fontWeight),
      fontStyle: layer.style.fontStyle || "normal",
      color:
        typeof layer.style.fill === "string" ? layer.style.fill : "#ffffff",
      textAlign: layer.style.textAlign || "center",
      verticalAlign: layer.style.verticalAlign || "middle",
      lineHeight: layer.style.lineHeight || 1.2,
      letterSpacing: layer.style.letterSpacing || 0,
      shadowColor: layer.style.shadow?.color,
      shadowBlur: layer.style.shadow?.blur,
      shadowOffsetX: layer.style.shadow?.offsetX,
      shadowOffsetY: layer.style.shadow?.offsetY,
      strokeColor: layer.style.stroke?.color,
      strokeWidth: layer.style.stroke?.width,
    };

    const textClip: TextClip = {
      id:
        layer.id ||
        `text-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      trackId,
      text: layer.content,
      startTime: layer.startTime ?? 0,
      duration: layer.duration ?? schema.project.duration,
      style: textStyle,
      transform: {
        position: {
          x: layer.position?.x ?? schema.project.width / 2,
          y: layer.position?.y ?? schema.project.height / 2,
        },
        scale: { x: layer.scale?.x ?? 1, y: layer.scale?.y ?? 1 },
        rotation: layer.rotation ?? 0,
        anchor: { x: layer.anchor?.x ?? 0.5, y: layer.anchor?.y ?? 0.5 },
        opacity: layer.opacity ?? 1,
      },
      keyframes: this.convertAnimationsToKeyframes(layer.animations || []),
    };

    textClips.push(textClip);
    return { success: true };
  }

  private processShapeLayer(
    layer: ShapeLayer,
    schema: AnimationSchema,
    trackId: string,
    shapeClips: ShapeClip[],
  ): { success: boolean; error?: string } {
    const shapeType = mapShapeType(
      layer.shape.type,
      layer.shape.type === "polygon" ? layer.shape.sides : undefined,
    );

    const fillColor = typeof layer.fill === "string" ? layer.fill : "#ffffff";

    const fillStyle: FillStyle = {
      type: "solid",
      color: fillColor,
      opacity: layer.opacity ?? 1,
    };

    const strokeStyle: CoreStrokeStyle = {
      color: layer.stroke?.color || "#000000",
      width: layer.stroke?.width ?? 0,
      opacity: 1,
      lineCap: layer.stroke?.lineCap,
      lineJoin: layer.stroke?.lineJoin,
    };

    const style: ShapeStyle = {
      fill: fillStyle,
      stroke: strokeStyle,
    };

    const shapeClip: ShapeClip = {
      id:
        layer.id ||
        `shape-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      trackId,
      type: "shape",
      shapeType,
      startTime: layer.startTime ?? 0,
      duration: layer.duration ?? schema.project.duration,
      style,
      transform: {
        position: {
          x: layer.position?.x ?? schema.project.width / 2,
          y: layer.position?.y ?? schema.project.height / 2,
        },
        scale: { x: layer.scale?.x ?? 1, y: layer.scale?.y ?? 1 },
        rotation: layer.rotation ?? 0,
        anchor: { x: layer.anchor?.x ?? 0.5, y: layer.anchor?.y ?? 0.5 },
        opacity: layer.opacity ?? 1,
      },
      keyframes: this.convertAnimationsToKeyframes(layer.animations || []),
    };

    shapeClips.push(shapeClip);
    return { success: true };
  }

  private processImageLayer(
    layer: ImageLayer,
    schema: AnimationSchema,
    videoTrack: Track,
  ): { success: boolean; error?: string } {
    const clip: Clip = {
      id:
        layer.id ||
        `clip-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      mediaId: layer.assetId,
      trackId: videoTrack.id,
      startTime: layer.startTime ?? 0,
      duration: layer.duration ?? schema.project.duration,
      inPoint: 0,
      outPoint: layer.duration ?? schema.project.duration,
      effects: [],
      audioEffects: [],
      transform: {
        position: {
          x: layer.position?.x ?? 0,
          y: layer.position?.y ?? 0,
        },
        scale: {
          x: layer.scale?.x ?? 1,
          y: layer.scale?.y ?? 1,
        },
        rotation: layer.rotation ?? 0,
        anchor: {
          x: layer.anchor?.x ?? 0.5,
          y: layer.anchor?.y ?? 0.5,
        },
        opacity: layer.opacity ?? 1,
      },
      volume: 1,
      keyframes: this.convertAnimationsToKeyframes(layer.animations || []),
    };

    (videoTrack.clips as Clip[]).push(clip);
    return { success: true };
  }

  private processVideoLayer(
    layer: VideoLayer,
    schema: AnimationSchema,
    videoTrack: Track,
  ): { success: boolean; error?: string } {
    const clip: Clip = {
      id:
        layer.id ||
        `clip-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      mediaId: layer.assetId,
      trackId: videoTrack.id,
      startTime: layer.startTime ?? 0,
      duration: layer.duration ?? schema.project.duration,
      inPoint: layer.inPoint ?? 0,
      outPoint: layer.outPoint ?? layer.duration ?? schema.project.duration,
      effects: [],
      audioEffects: [],
      transform: {
        position: {
          x: layer.position?.x ?? 0,
          y: layer.position?.y ?? 0,
        },
        scale: {
          x: layer.scale?.x ?? 1,
          y: layer.scale?.y ?? 1,
        },
        rotation: layer.rotation ?? 0,
        anchor: {
          x: layer.anchor?.x ?? 0.5,
          y: layer.anchor?.y ?? 0.5,
        },
        opacity: layer.opacity ?? 1,
      },
      volume: layer.muted ? 0 : 1,
      keyframes: this.convertAnimationsToKeyframes(layer.animations || []),
    };

    (videoTrack.clips as Clip[]).push(clip);
    return { success: true };
  }

  private convertAnimationsToKeyframes(
    animations: AnimationDefinition[],
  ): Keyframe[] {
    const keyframes: Keyframe[] = [];

    for (const animation of animations) {
      for (const kf of animation.keyframes) {
        keyframes.push({
          id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          time: kf.time + (animation.delay || 0),
          property: animation.property,
          value: kf.value,
          easing: (kf.easing || "linear") as EasingType,
        });
      }
    }

    return keyframes;
  }

  private createDefaultTransform(): Transform {
    return {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    };
  }
}

export const animationImporter = new AnimationImporter();

export function importAnimation(
  schema: AnimationSchema,
  options?: ImportOptions,
): ImportResult {
  return animationImporter.import(schema, options);
}

export function importAnimationFromJSON(
  json: string,
  options?: ImportOptions,
): ImportResult {
  try {
    const schema = JSON.parse(json) as AnimationSchema;
    return importAnimation(schema, options);
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : "Invalid JSON"],
      warnings: [],
    };
  }
}
