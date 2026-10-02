import type { ImportedMediaRef } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";

/** Preserve the native source so imported media survives a new renderer session. */
export async function importLunaLocalMedia(mediaId: string, mimeTypes: Record<string, string>): Promise<ImportedMediaRef> {
  const bridge = window.openreel?.lunaMedia;
  if (!bridge?.getLocalMedia || !bridge.readLocalMediaBytes) {
    throw new Error("Local media import is only available in Luna AI Cut");
  }
  const projectId = useProjectStore.getState().project.id;
  const media = await bridge.getLocalMedia(mediaId);
  const bytes = await bridge.readLocalMediaBytes(mediaId);
  const mime = mimeTypes[media.name.split(".").pop()?.toLowerCase() ?? ""]
    ?? (media.kind === "image" ? "image/jpeg" : "video/mp4");
  const file = new File([bytes], media.name, { type: mime });
  const store = useProjectStore.getState();
  if (store.project.id !== projectId) throw new Error("Project changed during media import");
  const existing = store.project.mediaLibrary.items.find((item) => item.id === mediaId);
  const result = existing?.isPlaceholder
    ? await store.replaceMediaAsset(mediaId, file)
    : await store.importMedia(file, { mediaId });
  if (!result.success) throw new Error(result.error?.message ?? "Media import failed");
  const importedId = existing?.id ?? result.actionId;
  const current = useProjectStore.getState().project;
  if (current.id !== projectId) throw new Error("Project changed during media import");
  const item = current.mediaLibrary.items.find((candidate) => candidate.id === importedId);
  if (!item) throw new Error("Imported media was not found");
  if (media.sourcePath) {
    useProjectStore.setState({ project: {
      ...current,
      mediaLibrary: { ...current.mediaLibrary, items: current.mediaLibrary.items.map((candidate) =>
        candidate.id === importedId ? { ...candidate, sourcePath: media.sourcePath, musicTiming: media.musicTiming } : candidate) },
      modifiedAt: Date.now(),
    } });
  }
  return {
    mediaId: item.id, name: media.name, type: item.type,
    durationSec: item.metadata.duration ?? media.duration ?? 0,
    width: item.metadata.width, height: item.metadata.height,
  };
}
