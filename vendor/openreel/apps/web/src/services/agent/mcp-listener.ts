import {
  executeTool,
  getTool,
  requiresUserConfirmation,
  toMcpTools,
  type ToolResult,
} from "@openreel/agent";
import type { MotionComposition } from "@openreel/core";
import { getLiveEditorHost, runExclusive } from "./host-singleton";
import { useMotionStore } from "../../motion/stores/motion-store";
import { useUIStore } from "../../stores/ui-store";
import { resolveMotionCreatorPreviewTime } from "../../motion/composition-selection";
import {
  LUNA_EDITING_SKILL_INDEX,
  getLunaEditingSkillDefinitions,
  getLunaEditingSkillResource,
  resolveLunaEditingSkills,
} from "./luna-editing-skill";
import {
  annotateContactSheet,
  buildContactSheetIndexText,
  contactSheetFrameLabel,
  formatContactSheetCaptureTime,
  formatContactSheetFrameTime,
  type ContactSheetAnnotationFrame,
} from "./contact-sheet-annotation";

export interface McpBridgeRequest {
  readonly callId: string;
  readonly kind: "listTools" | "callTool";
  readonly name?: string;
  readonly args?: Record<string, unknown>;
}

export interface McpBridgeResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly content?: readonly McpBridgeContent[];
}

interface McpBridgeContent {
  readonly type: "text" | "image";
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

interface PendingMediaDeletion {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly expiresAt: number;
}

const MEDIA_DELETION_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const pendingMediaDeletions = new Map<string, PendingMediaDeletion>();
let editingSkillRead = false;

const CONFIRM_MEDIA_DELETION_TOOL = {
  name: "confirm_media_deletion",
  description:
    "Confirm a pending media-library deletion after the user explicitly approves it. Pass the confirmationToken returned by delete_media or a raw media/delete action.",
  inputSchema: {
    type: "object",
    properties: {
      confirmationToken: {
        type: "string",
        description: "Token returned by the pending deletion request.",
      },
    },
    required: ["confirmationToken"],
    additionalProperties: false,
  },
} as const;

const GET_EDITING_SKILL_TOOL = {
  name: "get_editing_skill",
  description:
    "Read the Luna AI Cut core editing skill and any selected scene skills. Call with no arguments for luna-core, or pass skillId/skillIds to load task-specific skills after checking list_editing_skills.",
  inputSchema: {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        description: "One scene skill id returned by list_editing_skills.",
      },
      skillIds: {
        type: "array",
        maxItems: 8,
        items: { type: "string" },
        description: "Scene skill ids to combine with luna-core.",
      },
    },
    additionalProperties: false,
  },
} as const;

const LIST_EDITING_SKILLS_TOOL = {
  name: "list_editing_skills",
  description:
    "Scan Luna AI Cut's built-in core and scene skills with their descriptions and available references. Select luna-core plus 1-3 relevant scene skills, then call get_editing_skill with their ids.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

const GET_EDITING_SKILL_RESOURCE_TOOL = {
  name: "get_editing_skill_resource",
  description:
    "Read one referenced Markdown resource from a selected editing skill. Use only resource paths listed by list_editing_skills or linked from the selected SKILL.md.",
  inputSchema: {
    type: "object",
    properties: {
      skillId: { type: "string", description: "Skill id that owns the resource." },
      resourcePath: { type: "string", description: "Relative path such as references/packaging-principles.md." },
    },
    required: ["skillId", "resourcePath"],
    additionalProperties: false,
  },
} as const;

const LOCAL_MEDIA_TOOLS = [
  {
    name: "list_local_media",
    description:
      "List image, video, and generated audio files in Luna AI Cut's local media library. Visual media is sorted by capture time; generated music can be requested with kind=audio.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum number of files to return. Defaults to 100." },
        from: { type: "string", description: "Optional ISO date/time lower bound for capture time." },
        to: { type: "string", description: "Optional ISO date/time upper bound for capture time." },
        kind: { type: "string", enum: ["image", "video", "audio"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_local_media_metadata",
    description:
      "Read original technical metadata for local images, videos, and generated audio. Returns normalized dimensions, duration, frame rate, frame count, codecs, container format, and raw ffprobe or EXIF fields without exposing local file paths.",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "Media IDs returned by list_local_media.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "import_local_media",
    description:
      "Start importing selected files, including generated background music, from Luna AI Cut's local media library into the currently open project. The operation is asynchronous; poll get_local_media_import_status with the returned jobId before editing. Pass no more than 50 mediaIds per batch.",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "One or more mediaIds returned by list_local_media or generate_background_music.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "get_local_media_import_status",
    description:
      "Read the status and per-file results of an asynchronous import_local_media job. Poll while status is processing; only continue editing after completed or partial.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          minLength: 1,
          description: "The jobId returned by import_local_media.",
        },
      },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "inspect_local_media",
    description:
      "Inspect local images and videos with built-in low-cost representative frames. Use overview first, then detail for selected videos. The result includes MCP image content; no external dependencies are required.",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "Media IDs returned by list_local_media.",
        },
        mode: {
          type: "string",
          enum: ["overview", "detail"],
          description: "Overview returns one representative frame; detail returns three video frames.",
        },
        maxWidth: {
          type: "integer",
          minimum: 160,
          maximum: 800,
          description: "Maximum preview width in pixels. Defaults to 480.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "create_media_contact_sheet",
    description:
      "Create one labeled JPEG contact sheet from built-in representative frames for fast visual review of many local media files. Each cell shows a stable number, short media name, media type, and video time or photo capture time. The result also keeps explicit mediaId, frameId, frameIndex, timecode, and cell coordinates in data.items[].frames[].",
    inputSchema: {
      type: "object",
      properties: {
        mediaIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50,
          description: "Media IDs returned by list_local_media.",
        },
        mode: {
          type: "string",
          enum: ["overview", "detail"],
          description: "Overview returns one frame per media; detail returns three video frames per media.",
        },
        maxWidth: {
          type: "integer",
          minimum: 160,
          maximum: 480,
          description: "Maximum width of each contact-sheet cell in pixels. Defaults to 320.",
        },
        columns: {
          type: "integer",
          minimum: 1,
          maximum: 6,
          description: "Number of columns in the contact sheet. Defaults to 4.",
        },
      },
      required: ["mediaIds"],
      additionalProperties: false,
    },
  },
  {
    name: "transcribe_local_media",
    description:
      "Transcribe Chinese speech from a local video with Luna's built-in speech model and return timestamped cues. Long videos are automatically processed in time chunks with overlap context so the editor stays responsive. Use this first for talking-head, interview, narration, tutorial, and dialogue edits; no external dependencies are required.",
    inputSchema: {
      type: "object",
      properties: {
        mediaId: {
          type: "string",
          description: "A video mediaId returned by list_local_media.",
        },
        startSec: {
          type: "number",
          minimum: 0,
          description: "Optional start time in the original video's timeline. Defaults to 0.",
        },
        endSec: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Optional end time in the original video's timeline. Defaults to the video end.",
        },
        chunkDurationSec: {
          type: "number",
          minimum: 10,
          maximum: 900,
          description: "Logical recognition chunk length in seconds. Defaults to 120; use 60-120 for very long videos.",
        },
        overlapSec: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description: "Extra recognition context before and after each chunk. Defaults to 1.5 seconds; do not cut this context twice.",
        },
      },
      required: ["mediaId"],
      additionalProperties: false,
    },
  },
] as const;

interface LocalMediaToolError {
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
  requestedMediaIds: string[];
  status: LocalMediaImportJobStatus;
  results: LocalMediaImportOutcome[];
  createdAt: string;
  updatedAt: string;
  error?: LocalMediaToolError;
}

const MAX_IMPORT_BATCH_SIZE = 50;
const IMPORT_JOB_TTL_MS = 30 * 60 * 1000;
const localMediaImportJobs = new Map<string, LocalMediaImportJob>();
const localMediaImportJobsByKey = new Map<string, string>();

function importJobKey(mediaIds: readonly string[]): string {
  return [...mediaIds].sort().join("\u0000");
}

function pruneLocalMediaImportJobs(now = Date.now()): void {
  for (const [jobId, job] of localMediaImportJobs) {
    if (Date.parse(job.updatedAt) + IMPORT_JOB_TTL_MS > now) continue;
    localMediaImportJobs.delete(jobId);
    if (localMediaImportJobsByKey.get(importJobKey(job.requestedMediaIds)) === jobId) {
      localMediaImportJobsByKey.delete(importJobKey(job.requestedMediaIds));
    }
  }
}

function importJobData(job: LocalMediaImportJob): Record<string, unknown> {
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

function startLocalMediaImportJob(
  mediaIds: string[],
  host: ReturnType<typeof getLiveEditorHost>,
): LocalMediaImportJob {
  const existingJobId = localMediaImportJobsByKey.get(importJobKey(mediaIds));
  const existingJob = existingJobId ? localMediaImportJobs.get(existingJobId) : undefined;
  if (existingJob) return existingJob;

  const timestamp = new Date().toISOString();
  const job: LocalMediaImportJob = {
    jobId: globalThis.crypto?.randomUUID?.() ?? `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    requestedMediaIds: [...mediaIds],
    status: "queued",
    results: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  localMediaImportJobs.set(job.jobId, job);
  localMediaImportJobsByKey.set(importJobKey(mediaIds), job.jobId);

  void runExclusive(async () => {
    updateLocalMediaImportJob(job, { status: "processing" });
    for (const mediaId of job.requestedMediaIds) {
      try {
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

function localMediaToolResult(
  ok: boolean,
  summary: string,
  data?: unknown,
  error?: LocalMediaToolError,
): { ok: boolean; summary: string; data?: unknown; error?: LocalMediaToolError } {
  return { ok, summary, ...(data === undefined ? {} : { data }), ...(error ? { error } : {}) };
}

function contactSheetToolError(message: string): LocalMediaToolError {
  if (/宽度|列数|参数|width|columns/i.test(message)) {
    return {
      code: "INVALID_PARAMS",
      message,
      retryable: true,
      suggestedAction: "调整 maxWidth 或 columns 后最多重试一次；仍失败时停止当前步骤并上报失败",
    };
  }
  if (/没有可用于生成联络表的预览帧|没有可用/i.test(message)) {
    return {
      code: "CONTACT_SHEET_NO_FRAMES",
      message,
      retryable: false,
      suggestedAction: "改用 inspect_local_media 检查可用素材，或缩小 mediaIds 范围",
    };
  }
  return {
    code: "CONTACT_SHEET_RENDER_FAILED",
    message,
    retryable: true,
    suggestedAction: "调整 maxWidth 或 columns 后最多重试一次；再次失败时停止当前步骤并上报失败",
  };
}

function localMediaImportErrorCode(message: string): string {
  if (/不存在|已被移除|not found|removed/i.test(message)) return "LOCAL_MEDIA_NOT_FOUND";
  if (/only available|不可用|unavailable/i.test(message)) return "UNSUPPORTED";
  return "LOCAL_MEDIA_IMPORT_FAILED";
}

async function handleLocalMediaTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpBridgeResponse | null> {
  if (name === "list_local_media") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.listLocalMedia !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local media listing is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材查询不可用" }) };
    }
    const query: {
      limit?: number;
      from?: string;
      to?: string;
      kind?: "image" | "video" | "audio";
    } = {
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      ...(typeof args.from === "string" ? { from: args.from } : {}),
      ...(typeof args.to === "string" ? { to: args.to } : {}),
      ...(args.kind === "image" || args.kind === "video" || args.kind === "audio" ? { kind: args.kind } : {}),
    };
    try {
      const media = await bridge.listLocalMedia(query);
      return { ok: true, result: localMediaToolResult(true, `Found ${media.length} local media file${media.length === 1 ? "" : "s"}`, media) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name === "get_local_media_metadata") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.getLocalMediaMetadata !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local media metadata is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材原始信息读取不可用" }) };
    }
    const mediaIds = Array.isArray(args.mediaIds)
      ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (mediaIds.length === 0) {
      return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
    }
    if (mediaIds.length > 50) {
      return { ok: true, result: localMediaToolResult(false, "Too many mediaIds", undefined, {
        code: "INVALID_PARAMS",
        message: "一次最多读取 50 个素材的信息，请拆成多个批次",
        retryable: true,
        suggestedAction: "拆成每批不超过 50 个素材后重试",
      }) };
    }
    try {
      const metadata = await bridge.getLocalMediaMetadata(mediaIds);
      return {
        ok: true,
        result: localMediaToolResult(true, `Read original metadata for ${metadata.length} local media file${metadata.length === 1 ? "" : "s"}`, { items: metadata }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name === "inspect_local_media") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.inspectLocalMedia !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local media inspection is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材画面分析不可用" }) };
    }
    const mediaIds = Array.isArray(args.mediaIds)
      ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (mediaIds.length === 0) {
      return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
    }
    const mode = args.mode === "detail" ? "detail" : "overview";
    const maxWidth = typeof args.maxWidth === "number" ? args.maxWidth : undefined;
    try {
      const inspection = await bridge.inspectLocalMedia(mediaIds, { mode, ...(maxWidth === undefined ? {} : { maxWidth }) });
      const publicItems = inspection.items.map((item) => ({
        mediaId: item.mediaId,
        name: item.name,
        kind: item.kind,
        ...(item.duration === undefined ? {} : { duration: item.duration }),
        capturedAt: item.capturedAt,
        frames: item.frames.map((frame, frameIndex) => ({
          frameIndex,
          frameId: `${item.mediaId}#${frameIndex}`,
          mediaId: item.mediaId,
          timeSec: frame.timeSec,
        })),
        ...(item.error ? { error: item.error } : {}),
      }));
      const content: McpBridgeContent[] = [{
        type: "text",
        text: JSON.stringify({ mode: inspection.mode, maxWidth: inspection.maxWidth, items: publicItems }),
      }];
      for (const item of inspection.items) {
        for (const [frameIndex, frame] of item.frames.entries()) {
          content.push({
            type: "text",
            text: `素材 ${item.name} (${item.mediaId})，frameIndex=${frameIndex}，frameId=${item.mediaId}#${frameIndex}，时间 ${frame.timeSec}s；下一张图片就是这一帧`,
          });
          content.push({ type: "image", data: frame.base64, mimeType: frame.mimeType });
        }
      }
      return {
        ok: true,
        result: localMediaToolResult(true, `Inspected ${inspection.items.length} local media file${inspection.items.length === 1 ? "" : "s"}`, {
          mode: inspection.mode,
          maxWidth: inspection.maxWidth,
          items: publicItems,
        }),
        content,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name === "create_media_contact_sheet") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.createMediaContactSheet !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Contact-sheet generation is unavailable", undefined, { code: "UNSUPPORTED", message: "素材联络表不可用" }) };
    }
    const mediaIds = Array.isArray(args.mediaIds)
      ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (mediaIds.length === 0) {
      return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
    }
    const mode = args.mode === "detail" ? "detail" : "overview";
    const maxWidth = typeof args.maxWidth === "number" ? args.maxWidth : undefined;
    const columns = typeof args.columns === "number" ? args.columns : undefined;
    try {
      const sheet = await bridge.createMediaContactSheet(mediaIds, {
        mode,
        ...(maxWidth === undefined ? {} : { maxWidth }),
        ...(columns === undefined ? {} : { columns }),
      });
      const annotationFrames: ContactSheetAnnotationFrame[] = sheet.items.flatMap((item) => item.frames.map((frame, frameIndex) => ({
        mediaId: item.mediaId,
        frameIndex,
        frameId: `${item.mediaId}#${frameIndex}`,
        timeSec: frame.timeSec,
        name: item.name,
        kind: item.kind,
        capturedAt: item.capturedAt,
        base64: frame.base64,
      })));
      const annotatedSheet = await annotateContactSheet(sheet.contactSheet, annotationFrames);
      const cellsByFrameId = new Map(sheet.contactSheet.cells.map((cell) => [cell.frameId, cell]));
      const publicItems = sheet.items.map((item) => ({
        mediaId: item.mediaId,
        name: item.name,
        kind: item.kind,
        ...(item.duration === undefined ? {} : { duration: item.duration }),
        capturedAt: item.capturedAt,
        frames: item.frames.map((frame, frameIndex) => {
          const frameId = `${item.mediaId}#${frameIndex}`;
          const cell = cellsByFrameId.get(frameId);
          return {
            frameIndex,
            frameId,
            mediaId: item.mediaId,
            timeSec: frame.timeSec,
            timecode: formatContactSheetFrameTime(frame.timeSec),
            ...(cell ? { label: contactSheetFrameLabel(cell.sheetIndex), sheetNumber: cell.sheetIndex + 1 } : {}),
            ...(item.kind === "image" && item.capturedAt ? { captureTime: formatContactSheetCaptureTime(item.capturedAt) } : {}),
            ...(cell ? { cell: { sheetIndex: cell.sheetIndex, x: cell.x, y: cell.y, width: cell.width, height: cell.height } } : {}),
          };
        }),
        ...(item.error ? { error: item.error } : {}),
      }));
      const { base64: _base64, ...contactSheetMetadata } = sheet.contactSheet;
      const data = {
        mode: sheet.mode,
        maxWidth: sheet.maxWidth,
        items: publicItems,
        contactSheet: { ...contactSheetMetadata, labeled: annotatedSheet.labeled },
      };
      return {
        ok: true,
        result: localMediaToolResult(true, `Created a labeled contact sheet for ${sheet.items.length} local media file${sheet.items.length === 1 ? "" : "s"}`, data),
        content: [
          { type: "text", text: JSON.stringify(data) },
          { type: "text", text: buildContactSheetIndexText(annotationFrames, sheet.contactSheet.cells) },
          { type: "image", data: annotatedSheet.base64, mimeType: sheet.contactSheet.mimeType },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, contactSheetToolError(message)) };
    }
  }

  if (name === "transcribe_local_media") {
    const bridge = window.openreel?.lunaMedia;
    if (typeof bridge?.transcribeLocalMedia !== "function") {
      return { ok: true, result: localMediaToolResult(false, "Local speech transcription is unavailable", undefined, { code: "UNSUPPORTED", message: "本地语音识别不可用" }) };
    }
    const mediaId = typeof args.mediaId === "string" ? args.mediaId.trim() : "";
    if (!mediaId) {
      return { ok: true, result: localMediaToolResult(false, "mediaId is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的视频 mediaId" }) };
    }
    const transcriptionOptions = {
      ...(typeof args.startSec === "number" ? { startSec: args.startSec } : {}),
      ...(typeof args.endSec === "number" ? { endSec: args.endSec } : {}),
      ...(typeof args.chunkDurationSec === "number" ? { chunkDurationSec: args.chunkDurationSec } : {}),
      ...(typeof args.overlapSec === "number" ? { overlapSec: args.overlapSec } : {}),
    };
    try {
      const transcript = await bridge.transcribeLocalMedia(mediaId, transcriptionOptions);
      const cues = transcript.cues.map((cue) => ({
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        startSec: Number((cue.startMs / 1_000).toFixed(3)),
        endSec: Number((cue.endMs / 1_000).toFixed(3)),
        text: cue.text,
        source: cue.source,
      }));
      return {
        ok: true,
        result: localMediaToolResult(true, `Transcribed ${cues.length} speech cue${cues.length === 1 ? "" : "s"} in ${transcript.chunks.length} chunk${transcript.chunks.length === 1 ? "" : "s"}`, {
          mediaId: transcript.mediaId,
          name: transcript.name,
          durationSec: transcript.durationSec,
          requestedRange: transcript.requestedRange,
          chunkDurationSec: transcript.chunkDurationSec,
          overlapSec: transcript.overlapSec,
          chunks: transcript.chunks,
          language: transcript.language,
          cues,
          model: transcript.model,
          sourceFingerprint: transcript.sourceFingerprint,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
    }
  }

  if (name === "get_local_media_import_status") {
    pruneLocalMediaImportJobs();
    const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
    const job = jobId ? localMediaImportJobs.get(jobId) : undefined;
    if (!job) {
      return {
        ok: true,
        result: localMediaToolResult(false, "Import job not found", undefined, {
          code: "IMPORT_JOB_NOT_FOUND",
          message: "导入任务不存在或已过期，请重新调用 import_local_media",
          retryable: false,
          suggestedAction: "不要重复提交同一批素材；重新 list_local_media 后再发起导入",
        }),
      };
    }
    return {
      ok: true,
      result: localMediaToolResult(
        job.status !== "failed",
        job.status === "processing" || job.status === "queued"
          ? "素材仍在导入"
          : job.status === "completed"
            ? "素材导入完成"
            : job.status === "partial"
              ? "部分素材导入完成"
              : "素材导入失败",
        importJobData(job),
        job.status === "failed" ? job.error : undefined,
      ),
    };
  }

  if (name !== "import_local_media") return null;
  const mediaIds = Array.isArray(args.mediaIds)
    ? args.mediaIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (mediaIds.length === 0) {
    return { ok: true, result: localMediaToolResult(false, "mediaIds is required", undefined, { code: "INVALID_PARAMS", message: "请传入 list_local_media 返回的 mediaIds" }) };
  }
  if (mediaIds.length > MAX_IMPORT_BATCH_SIZE) {
    return {
      ok: true,
      result: localMediaToolResult(false, "Too many mediaIds", undefined, {
        code: "INVALID_PARAMS",
        message: `一次最多导入 ${MAX_IMPORT_BATCH_SIZE} 个素材，请拆成多个批次`,
        retryable: true,
        suggestedAction: `拆成每批不超过 ${MAX_IMPORT_BATCH_SIZE} 个素材后重试；每批先轮询 get_local_media_import_status，再提交下一批`,
      }),
    };
  }
  const host = getLiveEditorHost();
  if (typeof host.importMediaFromLocalMedia !== "function") {
    return { ok: true, result: localMediaToolResult(false, "Local media import is unavailable", undefined, { code: "UNSUPPORTED", message: "本地素材导入不可用" }) };
  }
  try {
    host.requireOpenProject();
    pruneLocalMediaImportJobs();
    const job = startLocalMediaImportJob(mediaIds, host);
    return {
      ok: true,
      result: localMediaToolResult(true, "已开始导入素材，请轮询导入状态", {
        ...importJobData(job),
        pollTool: "get_local_media_import_status",
        pollAfterMs: 500,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: true, result: localMediaToolResult(false, message, undefined, { code: "LOCAL_MEDIA_ERROR", message }) };
  }
}

function newConfirmationToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `media-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prunePendingMediaDeletions(now = Date.now()): void {
  for (const [token, pending] of pendingMediaDeletions) {
    if (pending.expiresAt <= now) pendingMediaDeletions.delete(token);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstKeyframeTime(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const time = optionalNumber(asRecord(item)?.time);
    if (time !== null) return time;
  }
  return null;
}

function getResultDataRecord(result: ToolResult): Record<string, unknown> | null {
  return asRecord(result.data);
}

function getMotionCompositionId(
  args: Record<string, unknown>,
  result: ToolResult,
): string | null {
  const data = getResultDataRecord(result);
  const composition = asRecord(data?.composition);
  const syncedCompositionIds = data?.syncedCompositionIds;
  return (
    optionalString(data?.compositionId) ??
    optionalString(data?.syncedCompositionId) ??
    optionalString(composition?.id) ??
    (Array.isArray(syncedCompositionIds)
      ? optionalString(syncedCompositionIds[0])
      : null) ??
    optionalString(args.compositionId)
  );
}

function getMotionComposition(result: ToolResult): MotionComposition | null {
  const composition = asRecord(getResultDataRecord(result)?.composition);
  if (
    !composition ||
    !optionalString(composition.id) ||
    !optionalNumber(composition.duration) ||
    !Array.isArray(composition.layers)
  ) {
    return null;
  }
  return composition as unknown as MotionComposition;
}

function getMotionFocusTime(args: Record<string, unknown>): number | null {
  return (
    optionalNumber(args.timeSeconds) ??
    optionalNumber(args.startTime) ??
    firstKeyframeTime(args.position) ??
    firstKeyframeTime(args.rotation) ??
    firstKeyframeTime(args.scale) ??
    firstKeyframeTime(args.opacity) ??
    firstKeyframeTime(args.lidAngle) ??
    firstKeyframeTime(args.target) ??
    firstKeyframeTime(args.fov)
  );
}

function getMotionLayerId(result: ToolResult): string | null {
  const data = getResultDataRecord(result);
  const layerIds = data?.layerIds;
  const createdLayerIds = data?.createdLayerIds;
  if (Array.isArray(createdLayerIds)) {
    return optionalString(createdLayerIds[0]);
  }
  if (Array.isArray(layerIds)) {
    return optionalString(layerIds[0]);
  }
  const keyedLayerIds = asRecord(layerIds);
  return (
    optionalString(data?.layerId) ??
    optionalString(data?.syncedLayerId) ??
    optionalString(data?.groupId) ??
    optionalString(keyedLayerIds ? Object.values(keyedLayerIds)[0] : undefined)
  );
}

function insertedMotionIntoEditor(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): boolean {
  if (name === "insert_motion_into_editor") return true;
  const data = getResultDataRecord(result);
  return (
    optionalString(data?.insertedInstanceId) !== null ||
    optionalString(data?.insertedClipId) !== null ||
    (args.insertIntoEditor === true && optionalString(data?.instanceId) !== null)
  );
}

function followMcpMotionResult(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  if (!result.ok || getTool(name)?.domain !== "motion") return;
  const compositionId = getMotionCompositionId(args, result);
  if (!compositionId) return;

  useUIStore
    .getState()
    .setDesktopPage(insertedMotionIntoEditor(name, args, result) ? "edit" : "motion");

  const motion = useMotionStore.getState();
  const activeChanged = motion.activeCompositionId !== compositionId;
  if (motion.activeCompositionId !== compositionId) {
    motion.setActiveCompositionId(compositionId);
  }

  const focusTime = getMotionFocusTime(args);
  if (focusTime !== null) {
    motion.setPlayhead(Math.max(0, focusTime));
  } else if (activeChanged) {
    const composition = getMotionComposition(result);
    if (composition) {
      motion.setPlayhead(resolveMotionCreatorPreviewTime(composition));
    }
  }

  const layerId = getMotionLayerId(result);
  if (layerId) {
    motion.selectLayer(layerId);
  }
}

/**
 * Runs a main-process MCP request against the live editor. Every MCP client
 * uses the same live host and can execute the complete editor tool catalog.
 */
export async function handleMcpBridgeRequest(
  req: McpBridgeRequest,
): Promise<McpBridgeResponse> {
  try {
    if (req.kind === "listTools") {
      return {
        ok: true,
        result: [GET_EDITING_SKILL_TOOL, LIST_EDITING_SKILLS_TOOL, GET_EDITING_SKILL_RESOURCE_TOOL, ...toMcpTools(), CONFIRM_MEDIA_DELETION_TOOL, ...LOCAL_MEDIA_TOOLS],
      };
    }
    if (req.kind === "callTool") {
      const name = req.name;
      if (!name) return { ok: false, error: "Missing tool name" };

      if (name === "list_editing_skills") {
        return {
          ok: true,
          result: localMediaToolResult(true, "Luna editing skills listed", {
            index: LUNA_EDITING_SKILL_INDEX,
            skills: getLunaEditingSkillDefinitions().map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              resources: skill.resources,
              required: skill.id === "luna-core",
            })),
          }),
        };
      }

      if (name === "get_editing_skill_resource") {
        const skillId = typeof req.args?.skillId === "string" ? req.args.skillId.trim() : "";
        const resourcePath = typeof req.args?.resourcePath === "string" ? req.args.resourcePath.trim() : "";
        if (!skillId || !resourcePath) {
          return {
            ok: true,
            result: localMediaToolResult(false, "Missing skill resource", undefined, {
              code: "INVALID_PARAMS",
              message: "skillId 和 resourcePath 必填",
            }),
          };
        }
        const content = getLunaEditingSkillResource(skillId, resourcePath);
        if (content === null) {
          return {
            ok: true,
            result: localMediaToolResult(false, "Skill resource not found", undefined, {
              code: "SKILL_RESOURCE_NOT_FOUND",
              message: `未找到技能资源：${skillId}/${resourcePath}`,
              suggestedAction: "先调用 list_editing_skills，并从返回的 resources 或 SKILL.md 链接中选择路径。",
            }),
          };
        }
        return {
          ok: true,
          result: localMediaToolResult(true, "Luna editing skill resource loaded", {
            skillId,
            resourcePath,
            content,
          }),
        };
      }

      if (name === "get_editing_skill") {
        const requestedSkillIds = [
          ...(typeof req.args?.skillId === "string" ? [req.args.skillId] : []),
          ...(Array.isArray(req.args?.skillIds)
            ? req.args.skillIds.filter((value): value is string => typeof value === "string")
            : []),
        ];
        const knownSkillIds = new Set<string>(getLunaEditingSkillDefinitions().map((skill) => skill.id));
        const unknownSkillIds = requestedSkillIds.filter((skillId) => !knownSkillIds.has(skillId));
        if (unknownSkillIds.length > 0) {
          return {
            ok: true,
            result: localMediaToolResult(false, "Unknown editing skill", undefined, {
              code: "SKILL_NOT_FOUND",
              message: `未知技能：${unknownSkillIds.join(", ")}`,
              suggestedAction: "先调用 list_editing_skills，再使用返回的 skill id。",
            }),
          };
        }
        const selected = resolveLunaEditingSkills(requestedSkillIds);
        editingSkillRead = selected.some((skill) => skill.id === "luna-core");
        return {
          ok: true,
          result: localMediaToolResult(true, "Luna editing skills loaded", {
            name: "luna-ai-cut-editing",
            version: "2.0",
            index: LUNA_EDITING_SKILL_INDEX,
            selectedSkillIds: selected.map((skill) => skill.id),
            skills: selected.map((skill) => ({
              id: skill.id,
              name: skill.name,
              summary: skill.description,
              resources: skill.resources,
              skill: skill.skill,
            })),
          }),
        };
      }

      const registeredTool = getTool(name);
      const requiresEditingSkill = name === "import_local_media"
        || registeredTool?.readOnly === false;
      if (requiresEditingSkill && !editingSkillRead) {
        return {
          ok: true,
          result: {
            ok: false,
            summary: "请先读取 Luna 剪辑 skill",
            error: {
              code: "SKILL_REQUIRED",
              message: "调用 get_editing_skill 后才能创建项目或修改项目",
            },
          } satisfies ToolResult,
        };
      }

      const localMediaResult = await handleLocalMediaTool(name, req.args ?? {});
      if (localMediaResult) return localMediaResult;

      const args = req.args ?? {};
      if (name === "confirm_media_deletion") {
        prunePendingMediaDeletions();
        const token = typeof args.confirmationToken === "string"
          ? args.confirmationToken
          : "";
        const pending = token ? pendingMediaDeletions.get(token) : undefined;
        if (!pending) {
          return {
            ok: true,
            result: {
              ok: false,
              summary: "删除确认已失效",
              error: {
                code: "CONFIRMATION_NOT_FOUND",
                message: "删除确认不存在或已过期，请重新发起删除请求",
              },
            } satisfies ToolResult,
          };
        }
        pendingMediaDeletions.delete(token);
        const result = await runExclusive(() =>
          Promise.resolve(executeTool(pending.toolName, pending.args, getLiveEditorHost())),
        );
        followMcpMotionResult(pending.toolName, pending.args, result);
        return { ok: true, result };
      }

      if (requiresUserConfirmation(name, args)) {
        prunePendingMediaDeletions();
        const confirmationToken = newConfirmationToken();
        pendingMediaDeletions.set(confirmationToken, {
          toolName: name,
          args: { ...args },
          expiresAt: Date.now() + MEDIA_DELETION_CONFIRMATION_TTL_MS,
        });
        const blocked: ToolResult = {
          ok: false,
          summary: "需要确认删除素材",
          data: { confirmationToken },
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: "请先取得用户确认，再调用 confirm_media_deletion 完成删除",
          },
        };
        return { ok: true, result: blocked };
      }

      const result = await runExclusive(() =>
        Promise.resolve(executeTool(name, args, getLiveEditorHost())),
      );
      followMcpMotionResult(name, args, result);
      return { ok: true, result };
    }
    return { ok: false, error: `Unknown MCP bridge kind: ${req.kind}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Installs the desktop MCP bridge listener. No-op off desktop. */
export function installMcpListener(): () => void {
  const mcp = window.openreel?.mcp;
  if (!mcp) return () => {};
  return mcp.onRequest(handleMcpBridgeRequest);
}
