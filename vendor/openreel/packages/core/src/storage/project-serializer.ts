import type { Project, MediaItem } from "../types";
import { isTransitionType } from "../types/effects";
import type { Transition } from "../types/timeline";
import type { IStorageEngine, MediaRecord } from "./types";
import type { ValidationResult, ProjectFileWithMetadata } from "./schema-types";
import type {
  MotionAudioClip,
  MotionComposition,
  MotionCompositionInstance,
  MotionLayer,
} from "../motion/types";
import type {
  MotionShaderCategory,
  MotionShaderDef,
  MotionShaderParamDef,
} from "../motion/shaders/types";
import { normalizeMotionCamera } from "../motion/motion-camera";
import { normalizeMotionLights } from "../motion/motion-lights";
import { normalizeMotionTracks } from "../motion/motion-tracking";
import { normalizeCreationState } from "../creation";
import {
  UNIVERSAL_TRACKS_MIN_READER_VERSION,
  projectUsesUniversalTracks,
} from "../timeline/timeline-items";

const MOTION_SHADER_CATEGORIES: ReadonlySet<MotionShaderCategory> = new Set([
  "fill",
  "effect",
  "text",
]);

function isMotionShaderParamDef(value: unknown): value is MotionShaderParamDef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const param = value as Record<string, unknown>;
  return (
    typeof param.name === "string" &&
    typeof param.label === "string" &&
    (param.type === "number" || param.type === "color") &&
    typeof param.default === "number" &&
    typeof param.min === "number" &&
    typeof param.max === "number" &&
    typeof param.step === "number"
  );
}

function isMotionShaderDef(value: unknown): value is MotionShaderDef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const def = value as Record<string, unknown>;
  return (
    typeof def.id === "string" &&
    def.id.length > 0 &&
    typeof def.name === "string" &&
    typeof def.category === "string" &&
    MOTION_SHADER_CATEGORIES.has(def.category as MotionShaderCategory) &&
    typeof def.glsl === "string" &&
    def.glsl.length > 0 &&
    Array.isArray(def.params) &&
    def.params.every(isMotionShaderParamDef)
  );
}

export function normalizeGeneratedShaders(
  value: unknown,
): readonly MotionShaderDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isMotionShaderDef).map((def) => ({
    id: def.id,
    name: def.name,
    category: def.category,
    glsl: def.glsl,
    params: def.params,
    origin: "generated" as const,
  }));
}

export interface ProjectFile {
  readonly version: string;
  readonly minimumReaderVersion?: string;
  readonly capabilities?: readonly string[];
  readonly project: Project;
}

export const SCHEMA_VERSION = "1.2.0";

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function getProjectFileCompatibility(project: Project): Pick<
  ProjectFile,
  "minimumReaderVersion" | "capabilities"
> {
  const capabilities = project.capabilities ?? [];
  return {
    minimumReaderVersion: projectUsesUniversalTracks(project)
      ? UNIVERSAL_TRACKS_MIN_READER_VERSION
      : project.minimumReaderVersion,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
  };
}

function assertReaderCompatibility(projectFile: ProjectFile): void {
  const minimumReaderVersion = projectFile.minimumReaderVersion;
  if (
    minimumReaderVersion &&
    compareVersions(minimumReaderVersion, SCHEMA_VERSION) > 0
  ) {
    throw new Error(
      `This project requires OpenReel project reader ${minimumReaderVersion} or newer. Current reader: ${SCHEMA_VERSION}.`,
    );
  }
}

function normalizeMotionAudioClips(
  composition: Pick<MotionComposition, "audioClips">,
): MotionAudioClip[] {
  if (!Array.isArray(composition.audioClips)) {
    return [];
  }
  return composition.audioClips.filter(
    (clip): clip is MotionAudioClip =>
      !!clip && typeof clip === "object" && typeof clip.id === "string",
  );
}

function normalizeMotionLayers(
  composition: Pick<MotionComposition, "layers">,
): MotionLayer[] {
  if (!Array.isArray(composition.layers)) {
    return [];
  }
  return composition.layers.filter(
    (layer): layer is MotionLayer =>
      !!layer && typeof layer === "object" && typeof layer.id === "string",
  );
}

export function normalizeMotionComposition(
  composition: MotionComposition,
): MotionComposition {
  return {
    ...composition,
    layers: normalizeMotionLayers(composition),
    assets: Array.isArray(composition.assets) ? composition.assets : [],
    variables: Array.isArray(composition.variables) ? composition.variables : [],
    markers: Array.isArray(composition.markers) ? composition.markers : [],
    audioClips: normalizeMotionAudioClips(composition),
    guides: Array.isArray(composition.guides) ? composition.guides : [],
    lights: normalizeMotionLights(composition),
    camera: composition.camera
      ? normalizeMotionCamera(composition)
      : undefined,
    tracks: normalizeMotionTracks(composition),
  };
}

export function normalizeProjectMotionFields(project: Project): Project {
  const motionInstances: MotionCompositionInstance[] = Array.isArray(
    project.motionInstances,
  )
    ? project.motionInstances
    : [];

  return {
    ...project,
    motionCompositions: Array.isArray(project.motionCompositions)
      ? project.motionCompositions.map(normalizeMotionComposition)
      : [],
    motionInstances,
  };
}

export function normalizeProjectCreationFields(project: Project): Project {
  return {
    ...project,
    creation: normalizeCreationState(project.creation),
  };
}

export function normalizeProjectGeneratedShaderFields(
  project: Project,
): Project {
  return {
    ...project,
    generatedShaders: normalizeGeneratedShaders(project.generatedShaders),
  };
}

function normalizeTransition(transition: unknown): Transition | null {
  if (!transition || typeof transition !== "object") {
    return null;
  }

  const candidate = transition as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.clipAId !== "string" ||
    typeof candidate.duration !== "number"
  ) {
    return null;
  }

  // Older AI runs used the legacy transition names. Keep those projects
  // editable by translating them to the current timeline transition model.
  const type =
    candidate.type === "fade" || candidate.type === "dissolve"
      ? "crossfade"
      : candidate.type === "iris"
        ? "circleReveal"
        : candidate.type;
  if (!isTransitionType(type)) {
    return null;
  }

  return {
    ...candidate,
    type,
    params:
      candidate.params && typeof candidate.params === "object"
        ? (candidate.params as Record<string, unknown>)
        : {},
  } as Transition;
}

export function normalizeProjectTransitionFields(project: Project): Project {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        transitions: (track.transitions ?? [])
          .map(normalizeTransition)
          .filter((transition): transition is Transition => transition !== null),
      })),
    },
  };
}

export function normalizeProjectStoredFields(project: Project): Project {
  return normalizeProjectTransitionFields(
    normalizeProjectGeneratedShaderFields(
      normalizeProjectCreationFields(normalizeProjectMotionFields(project)),
    ),
  );
}

export class ProjectSerializer {
  private storage: IStorageEngine;

  constructor(storage: IStorageEngine) {
    this.storage = storage;
  }

  async saveProject(project: Project): Promise<void> {
    await this.saveMediaBlobs(project);

    const projectToSave: Project = {
      ...project,
      modifiedAt: Date.now(),
    };

    await this.storage.saveProject(projectToSave);
  }

  async loadProject(id: string): Promise<Project | null> {
    const project = await this.storage.loadProject(id);
    if (!project) {
      return null;
    }

    const restoredProject = await this.restoreMediaBlobs(project);
    return restoredProject;
  }

  exportToJson(project: Project): string {
    const projectFile: ProjectFile = {
      version: SCHEMA_VERSION,
      ...getProjectFileCompatibility(project),
      project: this.stripMediaBlobs(project),
    };
    return JSON.stringify(projectFile, null, 2);
  }

  importFromJson(json: string): Project {
    const projectFile = JSON.parse(json) as ProjectFile;
    assertReaderCompatibility(projectFile);

    if (projectFile.version !== SCHEMA_VERSION) {
      return this.migrateProject(projectFile);
    }

    const project = this.normalizeStoredFields(projectFile.project);

    const processedItems: MediaItem[] = project.mediaLibrary.items.map(
      (item: MediaItem) => {
        if (!item.blob) {
          return {
            ...item,
            isPlaceholder: true,
            originalUrl: item.thumbnailUrl || undefined,
          };
        }
        return item;
      },
    );

    return {
      ...project,
      mediaLibrary: {
        items: processedItems,
      },
    };
  }

  exportToJsonWithMetadata(project: Project, description?: string): string {
    const projectFile: ProjectFileWithMetadata = {
      version: SCHEMA_VERSION,
      ...getProjectFileCompatibility(project),
      project: this.stripMediaBlobs(project),
      metadata: {
        exportedAt: Date.now(),
        description,
      },
    };
    return JSON.stringify(projectFile, null, 2);
  }

  validateProjectJson(json: string): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      missingAssets: [],
    };

    try {
      const projectFile = JSON.parse(json) as ProjectFile;

      if (!projectFile.version) {
        result.errors.push("Missing version field");
        result.valid = false;
      } else if (projectFile.version !== SCHEMA_VERSION) {
        result.warnings.push(
          `Version mismatch: expected ${SCHEMA_VERSION}, got ${projectFile.version}`,
        );
      }

      if (
        projectFile.minimumReaderVersion &&
        compareVersions(projectFile.minimumReaderVersion, SCHEMA_VERSION) > 0
      ) {
        result.errors.push(
          `Project requires reader ${projectFile.minimumReaderVersion} or newer`,
        );
        result.valid = false;
      }

      if (!projectFile.project) {
        result.errors.push("Missing project field");
        result.valid = false;
        return result;
      }

      const project = projectFile.project;

      if (!project.id) {
        result.errors.push("Missing project.id");
        result.valid = false;
      }
      if (!project.name) {
        result.errors.push("Missing project.name");
        result.valid = false;
      }
      if (!project.settings) {
        result.errors.push("Missing project.settings");
        result.valid = false;
      }
      if (!project.timeline) {
        result.errors.push("Missing project.timeline");
        result.valid = false;
      }
      if (!project.mediaLibrary) {
        result.errors.push("Missing project.mediaLibrary");
        result.valid = false;
      }

      if (!result.valid) {
        return result;
      }

      const mediaIds = new Set(
        project.mediaLibrary.items.map((item: MediaItem) => item.id),
      );

      for (const item of project.mediaLibrary.items) {
        if (!item.blob && !item.thumbnailUrl) {
          result.missingAssets!.push(item.id);
        }
      }

      if (project.timeline.tracks) {
        for (const track of project.timeline.tracks) {
          if (track.clips) {
            for (const clip of track.clips) {
              const isVirtualClip =
                clip.mediaId &&
                (clip.mediaId.startsWith("text-") ||
                  clip.mediaId.startsWith("shape-") ||
                  clip.mediaId.startsWith("svg-") ||
                  clip.mediaId.startsWith("sticker-") ||
                  clip.mediaId.startsWith("motion-"));
              if (
                clip.mediaId &&
                !isVirtualClip &&
                !mediaIds.has(clip.mediaId)
              ) {
                result.errors.push(
                  `Clip ${clip.id} references non-existent mediaId: ${clip.mediaId}`,
                );
                result.valid = false;
              }
            }
          }
        }
      }

      if (result.missingAssets && result.missingAssets.length > 0) {
        result.warnings.push(
          `${result.missingAssets.length} asset(s) need replacement`,
        );
      }
    } catch (error) {
      result.errors.push(
        `Invalid JSON: ${error instanceof Error ? error.message : "Parse error"}`,
      );
      result.valid = false;
    }

    return result;
  }

  importFromJsonWithValidation(json: string): {
    project: Project | null;
    validation: ValidationResult;
  } {
    const validation = this.validateProjectJson(json);

    if (!validation.valid) {
      return { project: null, validation };
    }

    const project = this.importFromJson(json);
    return { project, validation };
  }

  private async saveMediaBlobs(project: Project): Promise<void> {
    for (const item of project.mediaLibrary.items) {
      if (item.blob) {
        const mediaRecord: MediaRecord = {
          id: item.id,
          projectId: project.id,
          blob: item.blob,
          metadata: item.metadata,
        };
        await this.storage.saveMedia(mediaRecord);
      }
    }
  }

  private async restoreMediaBlobs(project: Project): Promise<Project> {
    const restoredItems: MediaItem[] = [];

    for (const item of project.mediaLibrary.items) {
      const mediaRecord = await this.storage.loadMedia(item.id);

      if (mediaRecord) {
        restoredItems.push({
          ...item,
          blob: mediaRecord.blob,
          metadata: mediaRecord.metadata,
        });
      } else {
        restoredItems.push(item);
      }
    }

    return {
      ...project,
      mediaLibrary: {
        items: restoredItems,
      },
    };
  }

  private stripMediaBlobs(project: Project): Project {
    const strippedItems: MediaItem[] = project.mediaLibrary.items.map(
      (item) => ({
        ...item,
        blob: null,
        fileHandle: null,
        waveformData: null,
      }),
    );

    return {
      ...project,
      mediaLibrary: {
        items: strippedItems,
      },
    };
  }

  private migrateProject(projectFile: ProjectFile): Project {
    return this.normalizeStoredFields(projectFile.project);
  }

  private normalizeStoredFields(project: Project): Project {
    return normalizeProjectStoredFields(project);
  }

  async deleteProject(id: string): Promise<void> {
    await this.storage.deleteProject(id);
  }

  async listProjects() {
    return this.storage.listProjects();
  }
}

export function createProjectSerializer(
  storage: IStorageEngine,
): ProjectSerializer {
  return new ProjectSerializer(storage);
}
