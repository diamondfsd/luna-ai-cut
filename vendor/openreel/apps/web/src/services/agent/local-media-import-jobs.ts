import { getLiveEditorHost, runExclusive } from "./host-singleton";

export interface LocalMediaToolError {
  code: string;
  message: string;
  retryable?: boolean;
  suggestedAction?: string;
}

type LocalMediaImportOutcome =
  | {
      mediaId: string;
      ok: true;
      imported: Awaited<ReturnType<NonNullable<ReturnType<typeof getLiveEditorHost>["importMediaFromLocalMedia"]>>>;
    }
  | {
      mediaId: string;
      ok: false;
      error: LocalMediaToolError;
    };

type LocalMediaImportJobStatus = "queued" | "processing" | "completed" | "partial" | "failed";

interface LocalMediaImportJob {
  jobId: string;
  projectId: string;
  requestedMediaIds: string[];
  status: LocalMediaImportJobStatus;
  results: LocalMediaImportOutcome[];
  createdAt: string;
  updatedAt: string;
  error?: LocalMediaToolError;
}

export const MAX_IMPORT_BATCH_SIZE = 50;
const IMPORT_JOB_TTL_MS = 30 * 60 * 1000;
export const localMediaImportJobs = new Map<string, LocalMediaImportJob>();
const localMediaImportJobsByKey = new Map<string, string>();

function importJobKey(mediaIds: readonly string[], projectId: string): string {
  return JSON.stringify([projectId, [...mediaIds].sort()]);
}

export function pruneLocalMediaImportJobs(now = Date.now()): void {
  for (const [jobId, job] of localMediaImportJobs) {
    if (Date.parse(job.updatedAt) + IMPORT_JOB_TTL_MS > now) continue;
    localMediaImportJobs.delete(jobId);
    if (localMediaImportJobsByKey.get(importJobKey(job.requestedMediaIds, job.projectId)) === jobId) {
      localMediaImportJobsByKey.delete(importJobKey(job.requestedMediaIds, job.projectId));
    }
  }
}

export function importJobData(job: LocalMediaImportJob): Record<string, unknown> {
  const completedMediaIds = job.results.filter((result) => result.ok).map((result) => result.mediaId);
  const failedMediaIds = job.results.filter((result) => !result.ok).map((result) => result.mediaId);
  const finishedMediaIds = new Set(job.results.map((result) => result.mediaId));
  return {
    jobId: job.jobId,
    status: job.status,
    requestedMediaIds: job.requestedMediaIds,
    completedMediaIds,
    pendingMediaIds: job.requestedMediaIds.filter((mediaId) => !finishedMediaIds.has(mediaId)),
    importedMediaIds: job.results.flatMap((result) => result.ok ? [result.imported.mediaId] : []),
    failedMediaIds,
    results: job.results,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.error ? { error: job.error } : {}),
  };
}

function updateLocalMediaImportJob(job: LocalMediaImportJob, patch: Partial<LocalMediaImportJob>): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

export function startLocalMediaImportJob(
  mediaIds: string[],
  host: ReturnType<typeof getLiveEditorHost>,
): LocalMediaImportJob {
  const projectId = host.getProject().id;
  const existingJobId = localMediaImportJobsByKey.get(importJobKey(mediaIds, projectId));
  const existingJob = existingJobId ? localMediaImportJobs.get(existingJobId) : undefined;
  if (existingJob && (existingJob.status === "queued" || existingJob.status === "processing")) return existingJob;

  const timestamp = new Date().toISOString();
  const job: LocalMediaImportJob = {
    jobId: globalThis.crypto?.randomUUID?.() ?? `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId,
    requestedMediaIds: [...mediaIds],
    status: "queued",
    results: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  localMediaImportJobs.set(job.jobId, job);
  localMediaImportJobsByKey.set(importJobKey(mediaIds, projectId), job.jobId);

  void runExclusive(async () => {
    updateLocalMediaImportJob(job, { status: "processing" });
    for (const mediaId of job.requestedMediaIds) {
      try {
        if (host.getProject().id !== projectId) throw new Error("Project changed during media import");
        const imported = await host.importMediaFromLocalMedia!(mediaId);
        job.results.push({ mediaId, ok: true, imported });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        job.results.push({
          mediaId,
          ok: false,
          error: { code: localMediaImportErrorCode(message), message },
        });
      }
      updateLocalMediaImportJob(job, {});
    }
    const succeeded = job.results.some((result) => result.ok);
    const failed = job.results.some((result) => !result.ok);
    updateLocalMediaImportJob(job, {
      status: failed ? (succeeded ? "partial" : "failed") : "completed",
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    updateLocalMediaImportJob(job, {
      status: "failed",
      error: {
        code: "LOCAL_MEDIA_IMPORT_FAILED",
        message,
        retryable: false,
        suggestedAction: "读取 get_local_media_import_status 的结果；不要重复导入同一批素材",
      },
    });
  });
  return job;
}

function localMediaImportErrorCode(message: string): string {
  if (/不存在|已被移除|not found|removed/i.test(message)) return "LOCAL_MEDIA_NOT_FOUND";
  if (/only available|不可用|unavailable/i.test(message)) return "UNSUPPORTED";
  return "LOCAL_MEDIA_IMPORT_FAILED";
}
