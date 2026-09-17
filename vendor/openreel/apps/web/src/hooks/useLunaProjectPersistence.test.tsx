import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";

import { projectManager } from "../services/project-manager";
import { useProjectStore } from "../stores/project-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useLunaProjectPersistence } from "./useLunaProjectPersistence";

function createProject(id: string, name: string): Project {
  return { ...createEmptyProject(name), id };
}

describe("useLunaProjectPersistence", () => {
  let currentProjectId: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    currentProjectId = "luna-project-1";
    vi.spyOn(projectManager, "getCurrentLunaProjectId").mockImplementation(
      () => currentProjectId,
    );
    useProjectStore.setState({
      project: createProject("luna-project-1", "Initial"),
      hasOpenProject: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("saves project state changes automatically", async () => {
    const save = vi
      .spyOn(projectManager, "saveLunaProject")
      .mockResolvedValue();
    renderHook(() => useLunaProjectPersistence());

    act(() => {
      const project = useProjectStore.getState().project;
      useProjectStore.setState({
        project: { ...project, name: "Edited", modifiedAt: Date.now() },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(save).toHaveBeenCalledWith(
      "luna-project-1",
      expect.objectContaining({ id: "luna-project-1", name: "Edited" }),
    );
  });

  it("does not save an old snapshot into a switched project", async () => {
    const save = vi
      .spyOn(projectManager, "saveLunaProject")
      .mockResolvedValue();
    renderHook(() => useLunaProjectPersistence());

    act(() => {
      const project = useProjectStore.getState().project;
      useProjectStore.setState({
        project: { ...project, name: "Edited old project" },
      });
      currentProjectId = "luna-project-2";
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(save).not.toHaveBeenCalled();

    act(() => {
      useProjectStore.setState({
        project: createProject("luna-project-2", "New project"),
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(save).toHaveBeenCalledWith(
      "luna-project-2",
      expect.objectContaining({ id: "luna-project-2", name: "New project" }),
    );
  });
});
