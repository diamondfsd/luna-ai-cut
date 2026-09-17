import type {
  MulticamFaceSignal,
  MulticamManifest,
  MulticamReactionCue,
} from "@openreel/core";
import { detectMulticamReactionCues } from "@openreel/core";
import type { ResolvedMulticamSource } from "../components/editor/inspector/multicam-workflow";

const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const VISION_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, complete);
      video.removeEventListener("error", failed);
    };
    const complete = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Could not decode a camera for face reaction analysis."));
    };
    video.addEventListener(event, complete, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

/** Samples close-up cameras locally with MediaPipe Face Landmarker. */
export async function analyzeMulticamFaceReactions(
  sources: readonly ResolvedMulticamSource[],
  manifest: MulticamManifest,
  durationSeconds: number,
  options: { intervalMs?: number; onProgress?: (message: string) => void } = {},
): Promise<MulticamReactionCue[]> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(VISION_WASM);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
  const intervalMs = Math.max(250, options.intervalMs ?? 1_000);
  const signals: MulticamFaceSignal[] = [];
  let detectorTimestamp = 0;
  try {
    for (const camera of manifest.cameras) {
      if (camera.subject === "all" || camera.subject.includes("+")) continue;
      const source = sources.find(
        (entry) => entry.angle.id === camera.id || entry.clip.id === camera.clipId,
      );
      if (!source?.media.blob) continue;
      const url = URL.createObjectURL(source.media.blob);
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.src = url;
      try {
        await waitFor(video, "loadedmetadata");
        let previousNose: { x: number; y: number } | undefined;
        for (let timelineMs = 0; timelineMs < durationSeconds * 1_000; timelineMs += intervalMs) {
          const sourceTime =
            source.clip.inPoint +
            source.angle.offset +
            (timelineMs / 1_000) * Math.max(0.01, source.clip.speed ?? 1);
          if (sourceTime < 0 || sourceTime >= video.duration) continue;
          video.currentTime = sourceTime;
          await waitFor(video, "seeked");
          detectorTimestamp += intervalMs;
          const result = landmarker.detectForVideo(video, detectorTimestamp);
          const face = result.faceLandmarks[0];
          const categories = result.faceBlendshapes[0]?.categories ?? [];
          if (!face) continue;
          const score = (name: string) =>
            categories.find((entry) => entry.categoryName === name)?.score ?? 0;
          const nose = face[1] ? { x: face[1].x, y: face[1].y } : undefined;
          const headMotion = nose && previousNose
            ? Math.min(1, Math.hypot(nose.x - previousNose.x, nose.y - previousNose.y) * 8)
            : 0;
          previousNose = nose;
          signals.push({
            participantId: camera.subject,
            timeMs: timelineMs,
            smile: (score("mouthSmileLeft") + score("mouthSmileRight")) / 2,
            surprise: Math.max(score("browInnerUp"), score("jawOpen")),
            headMotion,
          });
          options.onProgress?.(
            `${camera.id} face cues · ${Math.round((timelineMs / (durationSeconds * 1_000)) * 100)}%`,
          );
        }
      } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
    }
  } finally {
    landmarker.close();
  }
  return detectMulticamReactionCues(signals);
}
