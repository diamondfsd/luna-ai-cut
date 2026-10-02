import {
analyzeMulticamActivity,
createOrmaArtifact,
planMulticamShots,
type MulticamDecisionStrategy,
type MulticamEditPolicy,
type MultiCamGroup
} from "@openreel/core";
import { useCallback } from "react";
import {
saveMulticamArtifact
} from "../../../services/multicam-analysis-store";
import { transcribeMulticamChannels } from "../../../services/multicam-transcription";
import { toast } from "../../../stores/notification-store";
import { useProjectStore } from "../../../stores/project-store";
import {
analyzeMulticamSyncInWorker,
buildMulticamManifest,
createMulticamApplyTracksAction,
getMulticamAnalysisDuration,
prepareMulticamAnalysisAudio,
resolveMulticamSources,
updateAlignedSourceOffsets
} from "./multicam-workflow";

interface MulticamAutoEditOptions {
  multiCamEngine: import("@openreel/core").MultiCamEngine | null;
  processingGroupId: string | null;
  setProcessingGroupId: (id: string | null) => void;
  setStatus: (id: string, message: string) => void;
  decodeGroupAudio: (group: MultiCamGroup) => Promise<{
    buffers: Map<string, AudioBuffer>;
    sources: ReturnType<typeof resolveMulticamSources>;
  }>;
  updateGroupSourceLayout: (id: string, sources: ReturnType<typeof resolveMulticamSources>) => MultiCamGroup;
  editPolicy: MulticamEditPolicy;
  includeTranscripts: boolean;
  overlapStrategy: MulticamDecisionStrategy;
  overlapEscalation: Exclude<MulticamDecisionStrategy, "hold">;
}

export function useMulticamAutoEdit({ decodeGroupAudio, updateGroupSourceLayout, editPolicy, includeTranscripts, multiCamEngine, overlapEscalation, overlapStrategy, processingGroupId, setStatus, setProcessingGroupId }: MulticamAutoEditOptions) {
  const handleAutoEdit = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine || processingGroupId) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group) return;
      setProcessingGroupId(groupId);
      try {
        const { buffers, sources } = await decodeGroupAudio(group);
        updateGroupSourceLayout(groupId, sources);
        setStatus(groupId, "Synchronizing camera audio…");
        const { results: syncResults, drift } = await analyzeMulticamSyncInWorker(
          buffers,
          group.angles[0]?.id ?? "",
        );

        const liveGroup = multiCamEngine.getGroup(groupId);
        if (!liveGroup) throw new Error("Camera group is no longer available.");
        updateAlignedSourceOffsets(liveGroup, sources, syncResults);
        for (const angle of liveGroup.angles) {
          angle.driftSecondsPerSecond = drift[angle.id]?.secondsPerSecond ?? 0;
        }
        const alignedSources = sources.map((source) => ({
          ...source,
          angle:
            liveGroup.angles.find((angle) => angle.id === source.angle.id) ?? source.angle,
        }));
        const duration = getMulticamAnalysisDuration(alignedSources, buffers);
        if (!Number.isFinite(duration) || duration <= 0.1) {
          throw new Error("The camera recordings do not have enough overlapping audio.");
        }

        setStatus(groupId, "Analyzing speakers and microphone bleed…");
        const activity = analyzeMulticamActivity(
          alignedSources.map((source) => {
            const buffer = buffers.get(source.angle.id);
            if (!buffer) throw new Error(`Missing decoded audio for ${source.angle.name}.`);
            const analysisAudio = prepareMulticamAnalysisAudio(buffer);
            return {
              angleId: source.angle.id,
              samples: analysisAudio.samples,
              sampleRate: analysisAudio.sampleRate,
              offsetSeconds: source.clip.inPoint + source.angle.offset,
            };
          }),
          { durationSeconds: duration },
        );
        const currentProject = useProjectStore.getState().project;
        const manifest = liveGroup.manifest ?? buildMulticamManifest(
          currentProject,
          liveGroup,
          alignedSources,
          {
            min_shot_ms: editPolicy.minShotMs,
            max_shot_ms: Math.max(editPolicy.minShotMs, editPolicy.maxShotMs),
            cut_lead_ms: editPolicy.cutLeadMs,
            reaction_shot_after_ms: editPolicy.reactionShotAfterMs,
            forbid_jump_cut_same_subject: editPolicy.forbidJumpCutSameSubject,
          },
        );
        liveGroup.manifest = manifest;
        const shotPlan = planMulticamShots(activity, manifest, {
          strategy: overlapStrategy,
          escalateTo: overlapEscalation,
        });
        if (shotPlan.shots.length === 0) {
          throw new Error("No usable speaker activity was detected.");
        }
        liveGroup.shotPlan = shotPlan;
        multiCamEngine.applyAutomaticEdit(
          groupId,
          {
            duration: shotPlan.durationMs / 1_000,
            segments: shotPlan.shots.map((shot) => ({
              angleId: shot.layout.panels[0]?.cameraId ?? manifest.sync.reference,
              startTime: shot.startMs / 1_000,
              endTime: shot.endMs / 1_000,
              reason: shot.reason,
              confidence: shot.confidence,
            })),
          },
          editPolicy,
          activity.windowMs,
        );
        const artifact = createOrmaArtifact({
          manifest,
          media: alignedSources.map((source) => ({
            id: source.media.id,
            name: source.media.sourceFile?.name ?? source.media.name,
            size: source.media.sourceFile?.size ?? source.media.blob?.size ?? 0,
            lastModified: source.media.sourceFile?.lastModified ?? 0,
          })),
          activity,
          drift,
          transcripts: includeTranscripts
            ? await transcribeMulticamChannels(buffers, {
                onStatus: (angleId, message) => {
                  const angle = liveGroup.angles.find((entry) => entry.id === angleId);
                  setStatus(groupId, `${angle?.name ?? angleId}: ${message}`);
                },
              })
            : undefined,
        });
        liveGroup.analysisArtifactId = await saveMulticamArtifact(
          currentProject.id,
          groupId,
          artifact,
        );

        const outputTrackId = liveGroup.outputTrackId ?? `multicam-output-${groupId}`;
        const sourceClips = new Map(
          alignedSources.map((source) => [source.clip.id, source.clip]),
        );
        const outputTracks = multiCamEngine.buildShotPlanTracks(
          groupId,
          outputTrackId,
          sourceClips,
          currentProject.settings,
        );
        if (outputTracks.length === 0 || outputTracks.every((track) => track.clips.length === 0)) {
          throw new Error("The detected cuts could not be mapped to source clips.");
        }
        multiCamEngine.setOutputTracks(groupId, outputTracks.map((track) => track.id));

        setStatus(groupId, `Applying ${Math.max(0, shotPlan.shots.length - 1)} cuts…`);
        const updatedGroup = multiCamEngine.getGroup(groupId);
        if (!updatedGroup) throw new Error("Camera group is no longer available.");
        const applyAction = createMulticamApplyTracksAction({
          project: currentProject,
          group: updatedGroup,
          groups: multiCamEngine.getAllGroups(),
          outputTracks,
        });
        const result = await useProjectStore.getState().executeAction(applyAction);
        if (!result.success) {
          throw new Error(result.error?.message ?? "Could not apply the automatic edit.");
        }
        setStatus(
          groupId,
          `${shotPlan.shots.length} shots created on “${group.name} Auto Edit”`,
        );
        toast.success(
          "Automatic multicam edit created",
          `${Math.max(0, shotPlan.shots.length - 1)} cuts · one undo step`,
        );
      } catch (error) {
        multiCamEngine.loadGroups(
          useProjectStore.getState().project.multicamGroups ?? [],
        );
        const message = error instanceof Error ? error.message : "Automatic edit failed.";
        setStatus(groupId, message);
        toast.error("Automatic edit failed", message);
      } finally {
        setProcessingGroupId(null);
      }
    },
    [
      decodeGroupAudio,
      editPolicy,
      includeTranscripts,
      multiCamEngine,
      overlapEscalation,
      overlapStrategy,
      processingGroupId,
      setStatus,
      setProcessingGroupId,
      updateGroupSourceLayout,
    ],
  );

  return handleAutoEdit;
}
