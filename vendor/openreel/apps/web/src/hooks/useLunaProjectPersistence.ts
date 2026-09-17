import { useEffect, useRef } from "react";
import type { Project } from "@openreel/core";

import { projectManager } from "../services/project-manager";
import { useProjectStore } from "../stores/project-store";

const SAVE_DEBOUNCE_MS = 800;

/** Persists embedded Luna projects beside their workspace project. */
export function useLunaProjectPersistence(): void {
  const project = useProjectStore((state) => state.project);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queueSaveRef = useRef<(snapshot: Project) => Promise<void>>(() =>
    Promise.resolve(),
  );

  queueSaveRef.current = (snapshot: Project) => {
    const projectId = projectManager.getCurrentLunaProjectId();
    if (!projectId || projectId !== snapshot.id) return Promise.resolve();

    const queuedSave = saveQueueRef.current
      .catch(() => undefined)
      .then(() => {
        if (projectManager.getCurrentLunaProjectId() !== snapshot.id) return;
        return projectManager.saveLunaProject(snapshot.id, snapshot);
      });
    const settledSave = queuedSave.catch((error) => {
      console.error("[LunaProjectPersistence] Save failed:", error);
    });
    saveQueueRef.current = settledSave;
    return settledSave;
  };

  useEffect(() => {
    if (!projectManager.getCurrentLunaProjectId()) return;

    const timeoutId = window.setTimeout(() => {
      void queueSaveRef.current(useProjectStore.getState().getFullProject());
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [project]);

  useEffect(() => {
    const flush = () => {
      if (!projectManager.getCurrentLunaProjectId()) return;
      void queueSaveRef.current(useProjectStore.getState().getFullProject());
    };

    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
}
