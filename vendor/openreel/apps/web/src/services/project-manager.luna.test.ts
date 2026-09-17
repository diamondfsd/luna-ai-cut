import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectManager } from "./project-manager";

const { mockLoadProjectMedia } = vi.hoisted(() => ({
  mockLoadProjectMedia: vi.fn(),
}));

vi.mock("./media-storage", () => ({
  loadProjectMedia: mockLoadProjectMedia,
}));

const storedProject = {
  id: "luna-project-1",
  name: "Luna Demo",
  createdAt: 1,
  modifiedAt: 2,
  settings: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    sampleRate: 48000,
    channels: 2,
  },
  timeline: {
    duration: 0,
    tracks: [],
    markers: [],
    subtitles: [],
  },
  mediaLibrary: {
    items: [
      {
        id: "media-1",
        name: "clip.mp4",
        type: "video",
        fileHandle: null,
        blob: new Blob(["runtime data"]),
        metadata: {
          duration: 1,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: "h264",
          sampleRate: 48000,
          channels: 2,
          fileSize: 12,
        },
        thumbnailUrl: "blob:preview",
        waveformData: new Float32Array([0.2]),
      },
    ],
  },
};

describe("ProjectManager Luna project persistence", () => {
  beforeEach(async () => {
    mockLoadProjectMedia.mockReset().mockResolvedValue([]);
    await projectManager.createProject();
  });

  afterEach(() => {
    delete (window as any).openreel;
  });

  it("creates a project with the Luna id when no editor document exists", async () => {
    (window as any).openreel = {
      lunaProject: {
        load: vi.fn(async () => ({
          projectId: "luna-project-1",
          projectName: "Luna Demo",
          editorDocument: null,
        })),
        save: vi.fn(),
      },
    };

    const project = await projectManager.loadLunaProject("luna-project-1");

    expect(project.id).toBe("luna-project-1");
    expect(project.name).toBe("Luna Demo");
    expect(projectManager.getCurrentLunaProjectId()).toBe("luna-project-1");
  });

  it("loads and saves the Luna document using the autosave-safe format", async () => {
    const save = vi.fn(
      async (_projectId: string, _editorDocument: string) => undefined,
    );
    (window as any).openreel = {
      lunaProject: {
        load: vi.fn(async () => ({
          projectId: storedProject.id,
          projectName: storedProject.name,
          editorDocument: JSON.stringify(storedProject),
        })),
        save,
      },
    };

    const project = await projectManager.loadLunaProject(storedProject.id);
    await projectManager.saveLunaProject(storedProject.id, project);

    expect(save).toHaveBeenCalledTimes(1);
    const serialized = JSON.parse(save.mock.calls[0][1]);
    expect(serialized.id).toBe(storedProject.id);
    expect(serialized.mediaLibrary.items[0].blob).toBeNull();
    expect(serialized.mediaLibrary.items[0].fileHandle).toBeNull();
    expect(serialized.mediaLibrary.items[0].waveformData).toBeNull();
    expect(serialized.mediaLibrary.items[0].thumbnailUrl).toBeNull();
  });

  it("restores media blobs saved in local storage when reopening a Luna project", async () => {
    const storedBlob = new Blob(["restored"], { type: "video/mp4" });
    mockLoadProjectMedia.mockResolvedValue([
      {
        id: "media-1",
        projectId: storedProject.id,
        blob: storedBlob,
        metadata: storedProject.mediaLibrary.items[0].metadata,
      },
    ]);
    (window as any).openreel = {
      lunaProject: {
        load: vi.fn(async () => ({
          projectId: storedProject.id,
          projectName: storedProject.name,
          editorDocument: JSON.stringify({
            ...storedProject,
            mediaLibrary: {
              items: [
                {
                  ...storedProject.mediaLibrary.items[0],
                  blob: null,
                  thumbnailUrl: "data:image/png;base64,stored",
                },
              ],
            },
          }),
        })),
        save: vi.fn(),
      },
    };

    const project = await projectManager.loadLunaProject(storedProject.id);

    expect(project.mediaLibrary.items[0].blob).toBe(storedBlob);
    expect(project.mediaLibrary.items[0].isPlaceholder).toBe(false);
  });

  it("lists and creates projects through the native Luna project bridge", async () => {
    const save = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({
      projectId: "luna-project-2",
      projectName: "New Luna Project",
      createdAt: "2026-09-09T08:00:00.000Z",
      updatedAt: "2026-09-09T08:00:00.000Z",
    }));
    const list = vi.fn(async () => [
      {
        projectId: "luna-project-1",
        projectName: "Stored Luna Project",
        createdAt: "2026-09-09T07:00:00.000Z",
        updatedAt: "2026-09-09T07:30:00.000Z",
      },
    ]);
    (window as any).openreel = {
      lunaProject: { list, create, save },
    };

    const recent = await projectManager.getRecentProjects();
    const project = await projectManager.createLunaProject("New Luna Project", {
      width: 1080,
      height: 1920,
      frameRate: 30,
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect(recent[0]).toMatchObject({
      id: "luna-project-1",
      name: "Stored Luna Project",
    });
    expect(create).toHaveBeenCalledWith("New Luna Project");
    expect(save).toHaveBeenCalledTimes(1);
    expect(project.id).toBe("luna-project-2");
    expect(project.settings).toMatchObject({ width: 1080, height: 1920 });
  });

  it("deletes projects through the native Luna project bridge", async () => {
    const deleteProject = vi.fn(async () => undefined);
    (window as any).openreel = {
      lunaProject: { delete: deleteProject },
    };

    await projectManager.deleteProject("luna-project-1");

    expect(deleteProject).toHaveBeenCalledWith("luna-project-1");
  });
});
