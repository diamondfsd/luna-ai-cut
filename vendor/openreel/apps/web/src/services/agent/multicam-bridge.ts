import type { JobResult, MulticamHostBridge } from "@openreel/agent";
import {
  DEFAULT_MULTICAM_SHOT_POLICY,
  incorporateMulticamReactionCues,
  planMulticamShots,
  type MultiCamGroup,
  type MulticamShotPolicy,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { loadMulticamArtifact } from "../multicam-analysis-store";
import {
  createMulticamApplyTracksAction,
  resolveMulticamSources,
} from "../../components/editor/inspector/multicam-workflow";
import { extractMulticamSocialClips } from "@openreel/core";

function selectGroup(groupId?: string): MultiCamGroup {
  const groups = useProjectStore.getState().project.multicamGroups ?? [];
  const group = groupId
    ? groups.find((entry) => entry.id === groupId)
    : groups[0];
  if (!group) throw new Error(groupId ? `Multicam group not found: ${groupId}` : "No multicam group exists");
  return structuredClone(group);
}

async function artifact(groupId?: string) {
  const project = useProjectStore.getState().project;
  const group = selectGroup(groupId);
  const value = await loadMulticamArtifact(project.id, group.id);
  if (!value) throw new Error(`Reusable activity artifact is unavailable for ${group.name}`);
  return { project, group, artifact: value };
}

async function liveEngine() {
  const engine = await useEngineStore.getState().getMultiCamEngine();
  engine.loadGroups(useProjectStore.getState().project.multicamGroups ?? []);
  return engine;
}

async function applyEngineGroup(
  groupId: string,
  existingEngine?: Awaited<ReturnType<typeof liveEngine>>,
): Promise<Record<string, unknown>> {
  const project = useProjectStore.getState().project;
  const engine = existingEngine ?? await liveEngine();
  const group = engine.getGroup(groupId);
  if (!group?.outputTrackId) throw new Error("The multicam group has no generated output track");
  const sources = resolveMulticamSources(project, group);
  const outputTracks = engine.buildShotPlanTracks(
    groupId,
    group.outputTrackId,
    new Map(sources.map((source) => [source.clip.id, source.clip])),
    project.settings,
  );
  if (!outputTracks.length) throw new Error("The multicam shot plan produced no timeline tracks");
  engine.setOutputTracks(groupId, outputTracks.map((track) => track.id));
  const updated = engine.getGroup(groupId)!;
  const result = await useProjectStore.getState().executeAction(
    createMulticamApplyTracksAction({
      project,
      group: updated,
      groups: engine.getAllGroups(),
      outputTracks,
    }),
  );
  if (!result.success) throw new Error(result.error?.message ?? "Could not apply multicam edit");
  return {
    groupId,
    shots: updated.shotPlan?.shots.length ?? 0,
    cuts: Math.max(0, (updated.switches?.length ?? 1) - 1),
    outputTrackIds: updated.outputTrackIds ?? [updated.outputTrackId],
  };
}

export function createMulticamHostBridge(
  preview: (timeMs: number) => Promise<JobResult>,
): MulticamHostBridge {
  return {
    async getManifest(groupId) {
      const group = selectGroup(groupId);
      if (!group.manifest) throw new Error(`Manifest is unavailable for ${group.name}`);
      return { groupId: group.id, manifest: group.manifest };
    },

    async getActivityMap(groupId, range = {}) {
      const value = await artifact(groupId);
      const points = value.artifact.activity.points.filter(
        (point) =>
          point.endTime * 1_000 > (range.startMs ?? 0) &&
          point.startTime * 1_000 < (range.endMs ?? value.artifact.durationMs),
      );
      const stride = Math.max(1, Math.ceil(points.length / 2_000));
      return {
        groupId: value.group.id,
        activity: {
          ...value.artifact.activity,
          points: points.filter((_point, index) => index % stride === 0),
        },
        sampled: stride > 1,
      };
    },

    async getTranscript(groupId, range = {}) {
      const value = await artifact(groupId);
      const startMs = range.startMs ?? 0;
      const endMs = range.endMs ?? value.artifact.durationMs;
      return {
        groupId: value.group.id,
        transcripts: Object.fromEntries(
          Object.entries(value.artifact.transcripts ?? {}).map(([id, segments]) => [
            id,
            segments.filter((segment) => segment.endMs > startMs && segment.startMs < endMs),
          ]),
        ),
      };
    },

    async setEditPolicy(groupId, updates) {
      const value = await artifact(groupId);
      const engine = await liveEngine();
      const group = engine.getGroup(value.group.id);
      if (!group?.manifest) throw new Error("The multicam manifest is unavailable");
      const policy: MulticamShotPolicy = {
        ...DEFAULT_MULTICAM_SHOT_POLICY,
        ...group.editPolicy,
        ...updates,
      };
      const participantIds = new Set(group.manifest.participants.map((entry) => entry.id));
      const unknownPriority = policy.priorityParticipantIds.find((id) => !participantIds.has(id));
      if (unknownPriority) throw new Error(`Unknown priority participant: ${unknownPriority}`);
      group.editPolicy = policy;
      group.shotPlan = incorporateMulticamReactionCues(
        planMulticamShots(value.artifact.activity, group.manifest, policy),
        group.manifest,
        value.artifact.reactions ?? [],
      );
      engine.applyAutomaticEdit(
        group.id,
        {
          duration: group.shotPlan.durationMs / 1_000,
          segments: group.shotPlan.shots.map((shot) => ({
            angleId: shot.layout.panels[0]?.cameraId ?? group.manifest!.sync.reference,
            startTime: shot.startMs / 1_000,
            endTime: shot.endMs / 1_000,
            reason: shot.reason,
            confidence: shot.confidence,
          })),
        },
        group.automaticEdit?.policy ?? {
          overlapStrategy: "hold",
          minShotMs: group.manifest.constraints.min_shot_ms,
          maxShotMs: group.manifest.constraints.max_shot_ms,
          reactionShotMs: 1_800,
          cutLeadMs: group.manifest.constraints.cut_lead_ms,
          backchannelMaxMs: 700,
          reactionShotAfterMs: group.manifest.constraints.reaction_shot_after_ms,
          forbidJumpCutSameSubject: group.manifest.constraints.forbid_jump_cut_same_subject,
        },
        value.artifact.activity.windowMs,
      );
      return { ...(await applyEngineGroup(group.id, engine)), policy };
    },

    async annotateSegment(input) {
      const project = useProjectStore.getState().project;
      const groups = structuredClone(project.multicamGroups ?? []);
      const group = groups.find((entry) => entry.id === input.groupId);
      if (!group) throw new Error(`Multicam group not found: ${input.groupId}`);
      if (input.startMs < 0 || input.endMs <= input.startMs || input.endMs > group.duration * 1_000) {
        throw new Error(`Annotation range must be inside 0-${Math.round(group.duration * 1_000)} ms`);
      }
      group.annotations = [
        ...(group.annotations ?? []),
        {
          id: crypto.randomUUID(),
          startMs: input.startMs,
          endMs: input.endMs,
          note: input.note,
          createdAt: Date.now(),
        },
      ];
      const result = await useProjectStore.getState().executeAction({
        type: "multicam/setAll",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { groups },
      });
      if (!result.success) throw new Error(result.error?.message ?? "Could not annotate segment");
      return { groupId: group.id, annotation: group.annotations.at(-1) };
    },

    async getEditSummary(groupId) {
      const value = await artifact(groupId);
      const group = selectGroup(value.group.id);
      return {
        groupId: group.id,
        name: group.name,
        durationMs: value.artifact.durationMs,
        participants: group.manifest?.participants.length ?? 0,
        cameras: group.manifest?.cameras.length ?? group.angles.length,
        shots: group.shotPlan?.shots.length ?? 0,
        cuts: Math.max(0, (group.switches?.length ?? 1) - 1),
        pendingReview: (group.switches ?? []).filter((entry) => entry.reviewStatus === "pending").length,
        layouts: group.shotPlan?.shots.reduce<Record<string, number>>((counts, shot) => {
          counts[shot.layout.template] = (counts[shot.layout.template] ?? 0) + 1;
          return counts;
        }, {}) ?? {},
        annotations: group.annotations ?? [],
        socialCandidates: extractMulticamSocialClips(value.artifact),
      };
    },

    async overrideCut(input) {
      const engine = await liveEngine();
      const group = engine.getGroup(input.groupId);
      if (!group) throw new Error(`Multicam group not found: ${input.groupId}`);
      let changed = false;
      if (input.operation === "accept") {
        changed = engine.acceptSwitch(group.id, input.switchId);
      } else if (input.operation === "reject") {
        changed = engine.removeSwitch(group.id, input.switchId);
      } else if (input.operation === "nudge") {
        changed = engine.nudgeSwitch(group.id, input.switchId, (input.deltaMs ?? 0) / 1_000);
      } else if (input.operation === "set-camera") {
        const camera = group.manifest?.cameras.find((entry) => entry.id === input.cameraId);
        const switchItem = group.switches?.find((entry) => entry.id === input.switchId);
        if (camera && switchItem && group.angles.some((entry) => entry.id === camera.id)) {
          switchItem.angleId = camera.id;
          const shot = group.shotPlan?.shots.find(
            (entry) => Math.abs(entry.startMs / 1_000 - switchItem.time) < 0.001,
          );
          if (shot?.layout.panels[0]) {
            shot.layout = {
              template: camera.type === "wide" ? "wide" : "solo",
              panels: [{
                cameraId: camera.id,
                subject: camera.subject,
                rect: { x: 0, y: 0, width: 1, height: 1 },
              }],
            };
          }
          changed = true;
        }
      }
      if (!changed) throw new Error(`Cut override could not be applied: ${input.switchId}`);
      return applyEngineGroup(group.id, engine);
    },

    async previewFrame(groupId, timeMs) {
      const group = selectGroup(groupId);
      if (timeMs < 0 || timeMs > group.duration * 1_000) {
        throw new Error(`Preview time must be inside 0-${Math.round(group.duration * 1_000)} ms`);
      }
      return preview(timeMs);
    },
  };
}
