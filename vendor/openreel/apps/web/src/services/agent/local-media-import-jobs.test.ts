import { expect, it, vi } from "vitest";
import type { LiveEditorHost } from "./live-host";

vi.mock("./host-singleton", () => ({
  runExclusive: (run: () => Promise<void>) => run(),
}));
import { startLocalMediaImportJob } from "./local-media-import-jobs";

it("keeps identical import batches separate across projects and permits completed retries", async () => {
  let projectId = "first-project";
  const importMedia = vi.fn(async (mediaId: string) => ({ mediaId, name: "clip", type: "video", durationSec: 2 }));
  const host = {
    getProject: () => ({ id: projectId }),
    importMediaFromLocalMedia: importMedia,
  } as unknown as LiveEditorHost;
  const first = startLocalMediaImportJob(["same-media"], host);
  expect(startLocalMediaImportJob(["same-media"], host).jobId).toBe(first.jobId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(first.status).toBe("completed");
  projectId = "second-project";
  const second = startLocalMediaImportJob(["same-media"], host);
  expect(second.jobId).not.toBe(first.jobId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(second.status).toBe("completed");
  const retry = startLocalMediaImportJob(["same-media"], host);
  expect(retry.jobId).not.toBe(second.jobId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(importMedia).toHaveBeenCalledTimes(3);
});
