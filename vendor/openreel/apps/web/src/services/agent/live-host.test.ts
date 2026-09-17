import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Action } from "@openreel/core";
import { executeTool } from "@openreel/agent";
import type { EditorStateView } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { projectManager } from "../project-manager";
import { LiveEditorHost } from "./live-host";

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}`,
  timestamp: Date.now(),
  params,
});

describe("LiveEditorHost", () => {
  beforeEach(() => {
    void projectManager.createProject();
    useProjectStore.getState().createNewProject();
  });

  it("drives the live store through the agent executor", async () => {
    const host = new LiveEditorHost();
    const before = useProjectStore.getState().project.timeline.tracks.length;

    const res = await executeTool("add_track", { trackType: "video" }, host);
    expect(res.ok).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 1);

    const state = (await executeTool("get_editor_state", {}, host)).data as EditorStateView;
    expect(state.trackCount).toBe(before + 1);
  });

  it("requireOpenProject throws when no project is open", () => {
    useProjectStore.setState({ hasOpenProject: false });
    const host = new LiveEditorHost();
    expect(() => host.getProject()).toThrow(/No project is open/);
  });

  it("creates and activates a persisted Luna project", async () => {
    const create = vi.fn(async () => ({
      projectId: "luna-project-from-agent",
      projectName: "Agent Cut",
      createdAt: "2026-09-13T08:00:00.000Z",
      updatedAt: "2026-09-13T08:00:00.000Z",
    }));
    const save = vi.fn(
      async (_projectId: string, _editorDocument: string) => undefined,
    );
    Reflect.set(window, "openreel", {
      lunaProject: { create, save },
    });

    const host = new LiveEditorHost();
    const ref = await host.createProject({
      name: "Agent Cut",
      width: 1080,
      height: 1920,
      frameRate: 30,
    });

    expect(create).toHaveBeenCalledWith("Agent Cut");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      "luna-project-from-agent",
      expect.any(String),
    );
    expect(JSON.parse(save.mock.calls[0][1])).toMatchObject({
      id: "luna-project-from-agent",
      name: "Agent Cut",
    });
    expect(ref.id).toBe("luna-project-from-agent");
    expect(useProjectStore.getState().project.id).toBe(ref.id);
    expect(projectManager.getCurrentLunaProjectId()).toBe(ref.id);
    expect(window.location.hash).toBe("#/editor");
  });

  it("rolls a transaction back as one unit", async () => {
    const host = new LiveEditorHost();
    const before = useProjectStore.getState().project.timeline.tracks.length;

    const txn = host.beginTransaction("turn");
    await host.applyAction(act("track/add", { trackType: "text" }));
    await host.applyAction(act("track/add", { trackType: "graphics" }));
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 2);

    await host.rollbackTransaction(txn);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before);
  });

  it("exposes the capability manifest", () => {
    const host = new LiveEditorHost();
    expect(host.capabilities().blendModes.length).toBeGreaterThan(0);
  });
});
