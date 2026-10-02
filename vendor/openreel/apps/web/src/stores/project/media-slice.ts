import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, MediaItem } from "@openreel/core";
import type { ProjectState } from "../project-store";
import { getMediaBridge, initializeMediaBridge } from "../../bridges/media-bridge";
import { saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";
import type { OpenReelLunaAsset } from "../../types/global";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

function fileUrlForPath(filePath: string): string {
  if (/^(?:data|blob|https?|file):/i.test(filePath)) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  return encodeURI(`file://${normalized.startsWith("/") ? "" : "/"}${normalized}`)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
}

function mimeTypeForAsset(name: string, kind: OpenReelLunaAsset["kind"] | "audio"): string {
  const extension = name.split(".").pop()?.toLowerCase();
  if (kind === "audio") {
    return ({ wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg" } as Record<string, string>)[extension ?? ""] ?? "audio/wav";
  }
  if (kind === "image") {
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    if (extension === "gif") return "image/gif";
    if (extension === "heic" || extension === "heif") return "image/heic";
    return "image/jpeg";
  }
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mkv") return "video/x-matroska";
  return "video/mp4";
}

async function hydrateLunaMediaItem(item: MediaItem): Promise<MediaItem> {
  if (!item.sourcePath || !window.openreel?.lunaMedia?.readFileBytes) return item;

  try {
    const bytes = await window.openreel.lunaMedia.readFileBytes(item.sourcePath);
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
      throw new Error("empty media file");
    }
    const blob = new File([bytes], item.name, {
      type: mimeTypeForAsset(item.name, item.type),
    });
    let thumbnailUrl = item.thumbnailUrl;
    const resolveThumbnail = window.openreel.lunaMedia.resolveThumbnail;
    if ((item.type === "video" || !thumbnailUrl) && resolveThumbnail) {
      const resolvedThumbnail = await resolveThumbnail(
        item.sourcePath,
        item.type === "image" ? "image" : "video",
      ).catch(() => null);
      thumbnailUrl = resolvedThumbnail ?? (item.type === "video" ? null : thumbnailUrl);
    }
    return {
      ...item,
      blob,
      thumbnailUrl,
      isPlaceholder: false,
      sourceFile: item.sourceFile ?? {
        name: item.name,
        size: item.metadata.fileSize,
        lastModified: 0,
      },
    };
  } catch (error) {
    console.warn(`[ProjectStore] Failed to restore Luna media ${item.name}:`, error);
    return {
      ...item,
      blob: null,
      isPlaceholder: true,
      sourceFile: item.sourceFile ?? {
        name: item.name,
        size: item.metadata.fileSize,
        lastModified: 0,
      },
    };
  }
}

export async function hydrateLunaMediaItems(items: readonly MediaItem[]): Promise<MediaItem[]> {
  return Promise.all(items.map((item) => hydrateLunaMediaItem(item)));
}

export type MediaSlice = Pick<
  ProjectState,
  | "importMedia"
  | "importWorkspaceAsset"
  | "deleteMedia"
  | "replaceMediaAsset"
  | "renameMedia"
  | "getMediaItem"
>;

export function createMediaSlice(set: Set, get: Get): MediaSlice {
  return {
    importWorkspaceAsset: async (asset: OpenReelLunaAsset, options) => {
      const { project } = get();
      const requestedMediaId = options?.mediaId?.trim();
      const existing = project.mediaLibrary.items.find((item) => (
        item.sourceAssetId === asset.id ||
        item.sourcePath === asset.path ||
        (requestedMediaId ? item.id === requestedMediaId : false)
      ));
      if (existing) return { success: true, actionId: existing.id };

      // Keep Luna assets path-backed during import. Reading the complete file here
      // duplicates the bytes already used to populate the file input; playback,
      // export, and recovery resolve the source lazily through originalUrl/sourcePath.
      const blob: File | null = null;
      let thumbnailUrl = asset.thumbnailUrl ?? null;
      const resolveThumbnail = window.openreel?.lunaMedia?.resolveThumbnail;
      if (!thumbnailUrl && resolveThumbnail) {
        thumbnailUrl = await resolveThumbnail(asset.path, asset.kind).catch(() => null);
      }
      const mediaItem: MediaItem = {
        id: requestedMediaId || `luna-asset-${asset.id}`,
        name: asset.name,
        type: asset.kind,
        fileHandle: null,
        blob,
        metadata: {
          duration: asset.duration ?? 0,
          width: asset.width ?? 0,
          height: asset.height ?? 0,
          frameRate: asset.frameRate ?? 0,
          codec: "",
          sampleRate: 0,
          channels: 0,
          fileSize: asset.fileSize ?? 0,
        },
        thumbnailUrl,
        waveformData: null,
        originalUrl: fileUrlForPath(asset.path),
        sourceAssetId: asset.id,
        sourcePath: asset.path,
        sourceFile: {
          name: asset.name,
          size: asset.fileSize ?? 0,
          lastModified: 0,
        },
      };

      set({
        project: {
          ...project,
          mediaLibrary: {
            ...project.mediaLibrary,
            items: [...project.mediaLibrary.items, mediaItem],
          },
          modifiedAt: Date.now(),
        },
      });

      return { success: true, actionId: mediaItem.id };
    },

    importMedia: async (file: File, options) => {
      const { project } = get();
      const requestedMediaId = options?.mediaId?.trim();
      const existingMediaId = requestedMediaId
        ? project.mediaLibrary.items.find((item) => item.id === requestedMediaId)
        : undefined;
      if (existingMediaId) return { success: true, actionId: existingMediaId.id };

      try {
        const matchImportAsset = window.openreel?.lunaMedia?.matchImportAsset;
        const sourceAsset = matchImportAsset ? matchImportAsset(file.name, file.size) : null;
        if (sourceAsset) {
          return get().importWorkspaceAsset(sourceAsset, options);
        }

        const mediaBridge = getMediaBridge();
        if (!mediaBridge.isInitialized()) {
          await initializeMediaBridge();
        }

        const isLargeFile = file.size > 50 * 1024 * 1024;
        const importResult = await mediaBridge.importFile(file, true, isLargeFile);

        if (!importResult.success || !importResult.media) {
          return {
            success: false,
            error: {
              code: "DECODE_ERROR" as const,
              message: importResult.error || "Failed to import media",
            },
          };
        }

        const processedMedia = importResult.media;

        let thumbnailUrl: string | null = null;
        const filmstripThumbnails: { timestamp: number; url: string }[] = [];

        if (processedMedia.thumbnails && processedMedia.thumbnails.length > 0) {
          for (const thumb of processedMedia.thumbnails) {
            let thumbUrl: string | null = null;

            if (thumb.dataUrl) {
              thumbUrl = thumb.dataUrl;
            } else if (thumb.canvas) {
              try {
                if (thumb.canvas instanceof OffscreenCanvas) {
                  const blob = await thumb.canvas.convertToBlob({
                    type: "image/jpeg",
                    quality: 0.7,
                  });
                  thumbUrl = URL.createObjectURL(blob);
                } else if (thumb.canvas instanceof HTMLCanvasElement) {
                  thumbUrl = thumb.canvas.toDataURL("image/jpeg", 0.7);
                }
              } catch (e) {
                console.warn("Failed to convert thumbnail canvas to URL:", e);
              }
            }

            if (thumbUrl) {
              filmstripThumbnails.push({ timestamp: thumb.timestamp, url: thumbUrl });
            }
          }

          if (filmstripThumbnails.length > 0) {
            thumbnailUrl = filmstripThumbnails[0].url;
          }
        }

        let mediaType: "video" | "audio" | "image";
        if (file.type.startsWith("image/")) {
          mediaType = "image";
        } else if (processedMedia.metadata.hasVideo) {
          mediaType = "video";
        } else if (processedMedia.metadata.hasAudio) {
          mediaType = "audio";
        } else {
          mediaType = "image";
        }

        if (mediaType === "video" && !thumbnailUrl) {
          try {
            const thumbs = await mediaBridge.generateThumbnailsForMedia(
              processedMedia.blob ?? file,
              mediaType,
            );
            if (thumbs.length > 0) {
              thumbnailUrl = thumbs[0].dataUrl;
              filmstripThumbnails.push(
                ...thumbs.map((thumb) => ({
                  timestamp: thumb.timestamp,
                  url: thumb.dataUrl,
                })),
              );
            }
          } catch {
            // Background retry below is best-effort.
          }
        }

        const newMediaItem: MediaItem = {
          id: requestedMediaId || uuidv4(),
          name: file.name,
          type: mediaType,
          fileHandle: null,
          blob: file,
          metadata: {
            duration: processedMedia.metadata.duration || 0,
            width: processedMedia.metadata.width || 0,
            height: processedMedia.metadata.height || 0,
            frameRate: processedMedia.metadata.frameRate || 0,
            codec: processedMedia.metadata.codec || "",
            sampleRate: processedMedia.metadata.sampleRate || 0,
            channels: processedMedia.metadata.channels || 0,
            fileSize: file.size,
            hasVideo: processedMedia.metadata.hasVideo,
            hasAudio: processedMedia.metadata.hasAudio,
          },
          thumbnailUrl: thumbnailUrl ?? null,
          waveformData: processedMedia.waveformData?.peaks || null,
          filmstripThumbnails:
            filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
          sourceFile: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          },
        };

        const updatedProject = {
          ...project,
          mediaLibrary: {
            ...project.mediaLibrary,
            items: [...project.mediaLibrary.items, newMediaItem],
          },
          modifiedAt: Date.now(),
        };

        set({ project: updatedProject });

        try {
          await saveMediaBlob(
            updatedProject.id,
            newMediaItem.id,
            file,
            newMediaItem.metadata,
          );
        } catch (err) {
          console.error("[ProjectStore] Failed to persist media blob:", err);
        }

        if (mediaType === "video" && !thumbnailUrl) {
          setTimeout(async () => {
            try {
              const thumbs = await mediaBridge.generateThumbnailsForMedia(
                newMediaItem.blob ?? file,
                mediaType,
              );
              if (thumbs.length > 0) {
                const currentProject = get().project;
                const mediaIndex = currentProject.mediaLibrary.items.findIndex(
                  (m) => m.id === newMediaItem.id,
                );
                if (mediaIndex !== -1) {
                  const updatedItems = [...currentProject.mediaLibrary.items];
                  updatedItems[mediaIndex] = {
                    ...updatedItems[mediaIndex],
                    thumbnailUrl: thumbs[0].dataUrl,
                    filmstripThumbnails: thumbs.map((t) => ({
                      timestamp: t.timestamp,
                      url: t.dataUrl,
                    })),
                  };
                  set({
                    project: {
                      ...currentProject,
                      mediaLibrary: {
                        ...currentProject.mediaLibrary,
                        items: updatedItems,
                      },
                      modifiedAt: Date.now(),
                    },
                  });
                }
              }
            } catch {
              // Background thumbnail generation is best-effort
            }
          }, 100);
        }

        return { success: true, actionId: newMediaItem.id };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "DECODE_ERROR" as const,
            message:
              error instanceof Error ? error.message : "Unknown import error",
          },
        };
      }
    },

    deleteMedia: async (mediaId: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "media/delete",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { mediaId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
        deleteMediaBlob(mediaId).catch((err: unknown) =>
          console.warn("[ProjectStore] Failed to delete media blob:", err),
        );
      }
      return result;
    },

    replaceMediaAsset: async (
      mediaId: string,
      file: File,
      sourceFolder?: string,
    ) => {
      const { project } = get();

      try {
        const mediaBridge = getMediaBridge();
        if (!mediaBridge.isInitialized()) {
          await initializeMediaBridge();
        }

        const importResult = await mediaBridge.importFile(file, true);

        if (!importResult.success || !importResult.media) {
          return {
            success: false,
            error: {
              code: "DECODE_ERROR" as const,
              message: importResult.error || "Failed to import media",
            },
          };
        }

        const processedMedia = importResult.media;

        let thumbnailUrl: string | null = null;
        const filmstripThumbnails: { timestamp: number; url: string }[] = [];

        if (processedMedia.thumbnails && processedMedia.thumbnails.length > 0) {
          for (const thumb of processedMedia.thumbnails) {
            let thumbUrl: string | null = null;

            if (thumb.dataUrl) {
              thumbUrl = thumb.dataUrl;
            } else if (thumb.canvas) {
              try {
                if (thumb.canvas instanceof OffscreenCanvas) {
                  const blob = await thumb.canvas.convertToBlob({
                    type: "image/jpeg",
                    quality: 0.7,
                  });
                  thumbUrl = URL.createObjectURL(blob);
                } else if (thumb.canvas instanceof HTMLCanvasElement) {
                  thumbUrl = thumb.canvas.toDataURL("image/jpeg", 0.7);
                }
              } catch (e) {
                console.warn("Failed to convert thumbnail canvas to URL:", e);
              }
            }

            if (thumbUrl) {
              filmstripThumbnails.push({ timestamp: thumb.timestamp, url: thumbUrl });
            }
          }

          if (filmstripThumbnails.length > 0) {
            thumbnailUrl = filmstripThumbnails[0].url;
          }
        }

        const mediaType = processedMedia.metadata.hasVideo
          ? "video"
          : processedMedia.metadata.hasAudio
            ? "audio"
            : "image";

        if (mediaType === "video" && !thumbnailUrl) {
          try {
            const thumbs = await mediaBridge.generateThumbnailsForMedia(
              processedMedia.blob ?? file,
              mediaType,
            );
            if (thumbs.length > 0) {
              thumbnailUrl = thumbs[0].dataUrl;
              filmstripThumbnails.push(
                ...thumbs.map((thumb) => ({
                  timestamp: thumb.timestamp,
                  url: thumb.dataUrl,
                })),
              );
            }
          } catch {
            // Background retry below is best-effort.
          }
        }

        const updatedItem: MediaItem = {
          id: mediaId,
          name: file.name,
          type: mediaType,
          fileHandle: null,
          blob: file,
          metadata: {
            duration: processedMedia.metadata.duration || 0,
            width: processedMedia.metadata.width || 0,
            height: processedMedia.metadata.height || 0,
            frameRate: processedMedia.metadata.frameRate || 0,
            codec: processedMedia.metadata.codec || "",
            sampleRate: processedMedia.metadata.sampleRate || 0,
            channels: processedMedia.metadata.channels || 0,
            fileSize: file.size,
            hasVideo: processedMedia.metadata.hasVideo,
            hasAudio: processedMedia.metadata.hasAudio,
          },
          thumbnailUrl,
          waveformData: processedMedia.waveformData?.peaks || null,
          filmstripThumbnails:
            filmstripThumbnails.length > 0 ? filmstripThumbnails : undefined,
          isPlaceholder: false,
          sourceFile: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            folder: sourceFolder,
          },
        };

        const updatedItems = project.mediaLibrary.items.map((item) =>
          item.id === mediaId ? updatedItem : item,
        );

        set({
          project: {
            ...project,
            mediaLibrary: { items: updatedItems },
            modifiedAt: Date.now(),
          },
        });

        if (updatedItem.type === "video" && !updatedItem.thumbnailUrl) {
          setTimeout(async () => {
            try {
              const thumbs = await mediaBridge.generateThumbnailsForMedia(
                updatedItem.blob ?? file,
                updatedItem.type,
              );
              if (thumbs.length > 0) {
                const currentProject = get().project;
                const updatedItemsWithThumbs =
                  currentProject.mediaLibrary.items.map((item) =>
                    item.id === mediaId
                      ? {
                          ...item,
                          thumbnailUrl: thumbs[0].dataUrl,
                          filmstripThumbnails: thumbs.map((thumb) => ({
                            timestamp: thumb.timestamp,
                            url: thumb.dataUrl,
                          })),
                        }
                      : item,
                  );
                set({
                  project: {
                    ...currentProject,
                    mediaLibrary: { items: updatedItemsWithThumbs },
                    modifiedAt: Date.now(),
                  },
                });
              }
            } catch {
              // Background thumbnail generation is best-effort
            }
          }, 100);
        }

        return { success: true, actionId: uuidv4() };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "DECODE_ERROR" as const,
            message:
              error instanceof Error ? error.message : "Unknown import error",
          },
        };
      }
    },

    renameMedia: async (mediaId: string, name: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "media/rename",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { mediaId, name },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    getMediaItem: (mediaId: string) =>
      get().project.mediaLibrary.items.find((item) => item.id === mediaId),
  };
}
