import {
DEFAULT_MULTICAM_EDIT_POLICY,
extractMulticamSocialClips,
parseMulticamManifest,
serializeMulticamManifest,
serializeMulticamOtio,
serializeOrma,
type MulticamDecisionStrategy,
type MulticamEditPolicy,
type MultiCamGroup
} from "@openreel/core";
import { useCallback,useEffect,useMemo,useState } from "react";
import {
loadMulticamArtifact
} from "../../../services/multicam-analysis-store";
import { useEngineStore } from "../../../stores/engine-store";
import { toast } from "../../../stores/notification-store";
import { useProjectStore } from "../../../stores/project-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import {
analyzeMulticamSyncInWorker,
createMulticamApplyEditAction,
createMulticamApplyTracksAction,
getMulticamAnalysisDuration,
resolveMulticamSources,
updateAlignedSourceOffsets
} from "./multicam-workflow";

import { useMulticamAutoEdit } from "./use-multicam-auto-edit";

export function useMulticamController() {
  const project = useProjectStore((state) => state.project);
  const getMultiCamEngine = useEngineStore((state) => state.getMultiCamEngine);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [processingGroupId, setProcessingGroupId] = useState<string | null>(null);
  const [groupStatus, setGroupStatus] = useState<Record<string, string>>({});
  const [overlapStrategy, setOverlapStrategy] =
    useState<MulticamDecisionStrategy>("hold");
  const [overlapEscalation, setOverlapEscalation] =
    useState<Exclude<MulticamDecisionStrategy, "hold">>("wide");
  const [minShotSeconds, setMinShotSeconds] = useState(1.8);
  const [maxShotSeconds, setMaxShotSeconds] = useState(30);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);
  const [policyPreset, setPolicyPreset] = useState("custom");
  const [multiCamEngine, setMultiCamEngine] =
    useState<import("@openreel/core").MultiCamEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadEngine = async () => {
      const engine = await getMultiCamEngine();
      if (!cancelled) {
        setMultiCamEngine(engine);
      }
    };
    loadEngine();
    return () => {
      cancelled = true;
    };
  }, [getMultiCamEngine]);

  const groups = multiCamEngine?.getAllGroups() || [];

  const editPolicy = useMemo<MulticamEditPolicy>(
    () => ({
      ...DEFAULT_MULTICAM_EDIT_POLICY,
      overlapStrategy: overlapStrategy === "hold" ? "hold" : "winner",
      minShotMs: Math.max(0, minShotSeconds) * 1_000,
      maxShotMs: Math.max(0, maxShotSeconds) * 1_000,
    }),
    [maxShotSeconds, minShotSeconds, overlapStrategy],
  );

  const availableClips = useMemo(() => {
    const clips: { id: string; name: string; trackName: string }[] = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const media = project.mediaLibrary.items.find(
          (item) => item.id === clip.mediaId,
        );
        if (media?.type === "video") {
          clips.push({
            id: clip.id,
            name: `Clip ${clip.id.slice(-6)}`,
            trackName: track.name || `Track ${track.id.slice(-4)}`,
          });
        }
      }
    }
    return clips;
  }, [project]);

  const setStatus = useCallback((groupId: string, status: string) => {
    setGroupStatus((current) => ({ ...current, [groupId]: status }));
  }, []);

  const persistGroups = useCallback(async () => {
    if (!multiCamEngine) return;
    const result = await useProjectStore.getState().executeAction({
      type: "multicam/setAll",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { groups: multiCamEngine.getAllGroups() },
    });
    if (!result.success) {
      throw new Error(result.error?.message ?? "Could not save the camera group.");
    }
  }, [multiCamEngine]);

  const decodeGroupAudio = useCallback(
    async (group: MultiCamGroup) => {
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const unsupportedSource = sources.find(
        (source) => source.clip.reversed || (source.clip.speed ?? 1) !== 1,
      );
      if (unsupportedSource) {
        throw new Error(
          `${unsupportedSource.angle.name} must use normal-speed, forward playback for audio analysis.`,
        );
      }
      const buffers = new Map<string, AudioBuffer>();
      const audioContext = new AudioContext();
      try {
        for (const source of sources) {
          if (!source.media.blob) {
            throw new Error(`${source.angle.name} needs its source media relinked.`);
          }
          setStatus(group.id, `Decoding ${source.angle.name}…`);
          const buffer = await loadAudioBuffer(audioContext, source.media.blob, {
            audioTrackIndex: source.clip.audioTrackIndex,
            onProgress: ({ message }) => setStatus(group.id, `${source.angle.name}: ${message}`),
          });
          if (!buffer) {
            throw new Error(`Could not decode audio for ${source.angle.name}.`);
          }
          buffers.set(source.angle.id, buffer);
        }
      } finally {
        await audioContext.close();
      }
      return { buffers, sources };
    },
    [setStatus],
  );

  const updateGroupSourceLayout = useCallback(
    (
      groupId: string,
      sources: ReturnType<typeof resolveMulticamSources>,
    ) => {
      const liveGroup = multiCamEngine?.getGroup(groupId);
      if (!liveGroup) throw new Error("Camera group is no longer available.");
      for (const source of sources) {
        const angle = liveGroup.angles.find((item) => item.id === source.angle.id);
        if (angle) angle.trackId = source.track.id;
      }
      liveGroup.syncPoint = Math.min(...sources.map((source) => source.clip.startTime));
      return liveGroup;
    },
    [multiCamEngine],
  );

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleCreateGroup = useCallback(async () => {
    if (!multiCamEngine || selectedClips.length < 2) return;

    const group = multiCamEngine.createGroup(
      `Multi-Cam ${groups.length + 1}`,
      selectedClips,
    );
    try {
      const sources = resolveMulticamSources(project, group);
      updateGroupSourceLayout(group.id, sources);
      group.duration = Math.min(...sources.map((source) => source.clip.duration));
      await persistGroups();
    } catch (error) {
      multiCamEngine.deleteGroup(group.id);
      toast.error(
        "Camera group failed",
        error instanceof Error ? error.message : "Could not create the camera group.",
      );
      return;
    }

    setExpandedGroups((prev) => new Set([...prev, group.id]));
    setSelectedClips([]);
  }, [
    groups.length,
    multiCamEngine,
    persistGroups,
    project,
    selectedClips,
    updateGroupSourceLayout,
  ]);

  const handleSelectAngle = useCallback(
    (groupId: string, angleId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.setActiveAngle(groupId, angleId);
      void persistGroups().catch((error) =>
        toast.error("Could not save angle", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleRemoveAngle = useCallback(
    (groupId: string, angleId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.removeAngle(groupId, angleId);
      void persistGroups().catch((error) =>
        toast.error("Could not remove angle", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleRenameAngle = useCallback(
    (groupId: string, angleId: string, name: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.renameAngle(groupId, angleId, name);
      void persistGroups().catch((error) =>
        toast.error("Could not rename angle", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleOffsetChange = useCallback(
    (groupId: string, angleId: string, offset: number) => {
      if (!multiCamEngine) return;
      multiCamEngine.setAngleOffset(groupId, angleId, offset);
      void persistGroups().catch((error) =>
        toast.error("Could not save offset", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const handleSyncAudio = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group || processingGroupId) return;
      setProcessingGroupId(groupId);
      try {
        const { buffers, sources } = await decodeGroupAudio(group);
        updateGroupSourceLayout(groupId, sources);
        setStatus(groupId, "Synchronizing camera audio…");
        const { results } = await analyzeMulticamSyncInWorker(
          buffers,
          group.angles[0]?.id ?? "",
        );
        const liveGroup = multiCamEngine.getGroup(groupId);
        if (!liveGroup) throw new Error("Camera group is no longer available.");
        updateAlignedSourceOffsets(liveGroup, sources, results);
        const alignedSources = sources.map((source) => ({
          ...source,
          angle:
            liveGroup.angles.find((angle) => angle.id === source.angle.id) ?? source.angle,
        }));
        liveGroup.duration = getMulticamAnalysisDuration(alignedSources, buffers);
        await persistGroups();
        const confidences = [...results.values()].map((result) => result.confidence);
        const confidence = confidences.length
          ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
          : 0;
        setStatus(groupId, `Audio synchronized · ${Math.round(confidence * 100)}% confidence`);
        toast.success("Camera audio synchronized", group.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Audio sync failed.";
        setStatus(groupId, message);
        toast.error("Audio sync failed", message);
      } finally {
        setProcessingGroupId(null);
      }
    },
    [
      decodeGroupAudio,
      multiCamEngine,
      persistGroups,
      processingGroupId,
      setStatus,
      updateGroupSourceLayout,
    ],
  );

  const handleAutoEdit = useMulticamAutoEdit({ decodeGroupAudio, updateGroupSourceLayout, editPolicy, includeTranscripts, multiCamEngine, overlapEscalation, overlapStrategy, processingGroupId, setStatus, setProcessingGroupId });

  const downloadText = useCallback((filename: string, contents: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportOtio = useCallback((groupId: string) => {
    const group = multiCamEngine?.getGroup(groupId);
    if (!group?.manifest || !group.shotPlan) return;
    downloadText(
      `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.otio`,
      serializeMulticamOtio(group.shotPlan, group.manifest, group.name),
      "application/json",
    );
  }, [downloadText, multiCamEngine]);

  const handleExportOrma = useCallback(async (groupId: string) => {
    const group = multiCamEngine?.getGroup(groupId);
    if (!group) return;
    const artifact = await loadMulticamArtifact(
      useProjectStore.getState().project.id,
      groupId,
    );
    if (!artifact) {
      toast.error("Analysis unavailable", "Run Auto Edit before exporting the .orma artifact.");
      return;
    }
    downloadText(
      `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.orma`,
      serializeOrma(artifact),
      "application/vnd.openreel.activity+json",
    );
  }, [downloadText, multiCamEngine]);

  const handleImportManifest = useCallback(async (groupId: string, file: File) => {
    if (!multiCamEngine) return;
    try {
      const parsed = parseMulticamManifest(await file.text());
      const group = multiCamEngine.getGroup(groupId);
      if (!group) throw new Error("Camera group is no longer available.");
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const unusedAngles = [...group.angles];
      const cameras = parsed.cameras.map((camera) => {
        const matched = unusedAngles.find((angle) => {
          const source = sources.find((entry) => entry.angle.id === angle.id);
          return (
            camera.angleId === angle.id ||
            camera.id === angle.id ||
            camera.clipId === angle.clipId ||
            camera.file === source?.media.sourceFile?.name ||
            camera.file === source?.media.name
          );
        }) ?? unusedAngles[0];
        if (!matched) throw new Error(`Could not map camera ${camera.id} (${camera.file}) to a selected angle.`);
        unusedAngles.splice(unusedAngles.indexOf(matched), 1);
        return { ...camera, clipId: matched.clipId, angleId: matched.id };
      });
      group.manifest = { ...parsed, cameras };
      await persistGroups();
      toast.success("Multicam manifest imported", `${parsed.participants.length} participants · ${parsed.cameras.length} cameras`);
    } catch (error) {
      toast.error("Manifest import failed", error instanceof Error ? error.message : undefined);
    }
  }, [multiCamEngine, persistGroups]);

  const handleExportManifest = useCallback((groupId: string) => {
    const group = multiCamEngine?.getGroup(groupId);
    if (!group?.manifest) return;
    downloadText(
      `${group.name.replace(/[^a-z0-9-_]+/gi, "-")}.multicam.json`,
      serializeMulticamManifest(group.manifest),
      "application/json",
    );
  }, [downloadText, multiCamEngine]);

  const handleFindSocialClips = useCallback(async (groupId: string) => {
    const artifact = await loadMulticamArtifact(
      useProjectStore.getState().project.id,
      groupId,
    );
    if (!artifact) {
      toast.error("Analysis unavailable", "Run Auto Edit before finding social clips.");
      return;
    }
    const candidates = extractMulticamSocialClips(artifact);
    const store = useProjectStore.getState();
    store.beginHistoryGroup("Add multicam social clip candidates");
    try {
      for (const candidate of candidates) {
        await useProjectStore.getState().executeAction({
          type: "marker/add",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: {
            time: candidate.startMs / 1_000,
            label: `Social · ${candidate.title ?? candidate.reason}`,
            color: "#f59e0b",
          },
        });
      }
    } finally {
      useProjectStore.getState().endHistoryGroup();
    }
    toast.success("Social clip candidates added", `${candidates.length} timeline markers`);
  }, []);

  const applyReviewedEdit = useCallback(
    async (groupId: string) => {
      if (!multiCamEngine) return;
      const group = multiCamEngine.getGroup(groupId);
      if (!group?.outputTrackId) return;
      const currentProject = useProjectStore.getState().project;
      const sources = resolveMulticamSources(currentProject, group);
      const sourceClips = new Map(sources.map((source) => [source.clip.id, source.clip]));
      const outputTracks = group.shotPlan
        ? multiCamEngine.buildShotPlanTracks(
            groupId,
            group.outputTrackId,
            sourceClips,
            currentProject.settings,
          )
        : [];
      const action = outputTracks.length
        ? createMulticamApplyTracksAction({
            project: currentProject,
            group,
            groups: multiCamEngine.getAllGroups(),
            outputTracks,
          })
        : createMulticamApplyEditAction({
            project: currentProject,
            group,
            groups: multiCamEngine.getAllGroups(),
            outputTrackId: group.outputTrackId,
            sequence: multiCamEngine.buildSequenceClips(
              groupId,
              group.outputTrackId,
              sourceClips,
            ),
          });
      const result = await useProjectStore.getState().executeAction(action);
      if (!result.success) throw new Error(result.error?.message ?? "Could not update cut review.");
    },
    [multiCamEngine],
  );

  const handleAcceptCut = useCallback(async (groupId: string, switchId: string) => {
    if (!multiCamEngine?.acceptSwitch(groupId, switchId)) return;
    try {
      await applyReviewedEdit(groupId);
    } catch (error) {
      toast.error("Could not accept cut", error instanceof Error ? error.message : undefined);
    }
  }, [applyReviewedEdit, multiCamEngine]);

  const handleRejectCut = useCallback(async (groupId: string, switchId: string) => {
    if (!multiCamEngine?.removeSwitch(groupId, switchId)) return;
    try {
      await applyReviewedEdit(groupId);
    } catch (error) {
      toast.error("Could not reject cut", error instanceof Error ? error.message : undefined);
    }
  }, [applyReviewedEdit, multiCamEngine]);

  const handleNudgeCut = useCallback(async (
    groupId: string,
    switchId: string,
    deltaSeconds: number,
  ) => {
    if (!multiCamEngine?.nudgeSwitch(groupId, switchId, deltaSeconds)) return;
    try {
      await applyReviewedEdit(groupId);
    } catch (error) {
      toast.error("Could not nudge cut", error instanceof Error ? error.message : undefined);
    }
  }, [applyReviewedEdit, multiCamEngine]);

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      if (!multiCamEngine) return;
      multiCamEngine.deleteGroup(groupId);
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      void persistGroups().catch((error) =>
        toast.error("Could not delete group", error instanceof Error ? error.message : undefined),
      );
    },
    [multiCamEngine, persistGroups],
  );

  const toggleClipSelection = (clipId: string) => {
    setSelectedClips((prev) =>
      prev.includes(clipId)
        ? prev.filter((id) => id !== clipId)
        : [...prev, clipId],
    );
  };

  return {
    groups,
    expandedGroups,
    selectedClips,
    processingGroupId,
    groupStatus,
    overlapStrategy,
    setOverlapStrategy,
    overlapEscalation,
    setOverlapEscalation,
    minShotSeconds,
    setMinShotSeconds,
    maxShotSeconds,
    setMaxShotSeconds,
    includeTranscripts,
    setIncludeTranscripts,
    policyPreset,
    setPolicyPreset,
    availableClips,
    toggleGroup,
    handleCreateGroup,
    handleSelectAngle,
    handleRemoveAngle,
    handleRenameAngle,
    handleOffsetChange,
    handleSyncAudio,
    handleAutoEdit,
    handleAcceptCut,
    handleRejectCut,
    handleNudgeCut,
    handleExportOtio,
    handleExportOrma,
    handleFindSocialClips,
    handleImportManifest,
    handleExportManifest,
    handleDeleteGroup,
    toggleClipSelection
  };
}
