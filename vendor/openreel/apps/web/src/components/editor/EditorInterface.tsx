import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  ToolcraftText as Text,
} from "@openreel/ui";

import { Toolbar } from "./Toolbar";
import { EditorActionRail } from "./EditorActionRail";
import { AssetsPanel } from "./AssetsPanel";
import { Preview } from "./Preview";
import { InspectorPanel } from "./InspectorPanel";
import { Timeline } from "./Timeline";
import { KeyframeEditorPanel } from "./KeyframeEditorPanel";
import { AudioMixer } from "../audio-mixer";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";
import { PanelErrorBoundary } from "../ErrorBoundary";
import { SpotlightTour, MoGraphTour } from "./tour";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useLunaProjectPersistence } from "../../hooks/useLunaProjectPersistence";
import {
  initializePlaybackBridge,
  disposePlaybackBridge,
} from "../../bridges/playback-bridge";
import {
  initializeMediaBridge,
  disposeMediaBridge,
} from "../../bridges/media-bridge";
import {
  initializeRenderBridge,
  disposeRenderBridge,
} from "../../bridges/render-bridge";
import {
  initializeEffectsBridge,
  disposeEffectsBridge,
} from "../../bridges/effects-bridge";
import {
  initializeTransitionBridge,
  disposeTransitionBridge,
} from "../../bridges/transition-bridge";

const ChatPanel = React.lazy(() =>
  import("./chat/ChatPanel").then((module) => ({ default: module.ChatPanel })),
);

// Timeline area (bottom band) is sized as a vh fraction so the
// top workspace (media | stage | inspector) gets the rest. The grid
// from the mockup is `1fr var(--tl-height)` rows — by default
// timeline is 58vh which leaves the top row with ~38–42vh of stage.
const DEFAULT_TIMELINE_VH = 42;
const MIN_TIMELINE_VH = 22;
const MAX_TIMELINE_VH = 70;
// Compact mode: timeline takes most of the height, leaving a small preview.
const COMPACT_TIMELINE_VH = 80;

const DEFAULT_MEDIA_W = 460;
const MIN_MEDIA_W = 320;
const MAX_MEDIA_W = 640;

const DEFAULT_RIGHT_DOCK_W = 380;
const MIN_RIGHT_DOCK_W = 320;
const MAX_RIGHT_DOCK_W = 560;

const MIN_STAGE_W = 380;
const RESIZE_HANDLE = 10;

type ResizeTarget = "timeline" | "media" | "rightDock";
type RightDockTab = "inspector" | "chat";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Auto-save initialization hook
 */
const useAutoSave = () => {
  const { initializeAutoSave } = useProjectStore();

  useEffect(() => {
    initializeAutoSave().catch(console.error);
  }, [initializeAutoSave]);
};

/**
 * Engine and bridge initialization hook
 * Ensures all engines and bridges are fully initialized before rendering editor
 */
const useEngineInitialization = () => {
  const { initialize, initialized, initializing, initError } = useEngineStore();
  const [bridgesReady, setBridgesReady] = useState(false);
  const [initStatus, setInitStatus] = useState("Starting...");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initAll = async () => {
      try {
        const currentState = useEngineStore.getState();
        if (!currentState.initialized && !currentState.initializing) {
          setInitStatus("Initializing video engine...");
          await initialize();
        } else if (currentState.initializing) {
          await new Promise<void>((resolve) => {
            const unsubscribe = useEngineStore.subscribe((state) => {
              if (state.initialized || state.initError) {
                unsubscribe();
                resolve();
              }
            });
          });
        }

        if (!isMounted) return;

        const engineState = useEngineStore.getState();
        if (!engineState.initialized) {
          throw new Error(
            engineState.initError || "Engine initialization failed",
          );
        }

        setInitStatus("Initializing media bridge...");
        await initializeMediaBridge();
        if (!isMounted) return;

        setInitStatus("Initializing playback bridge...");
        await initializePlaybackBridge();
        if (!isMounted) return;

        setInitStatus("Initializing render bridge...");
        await initializeRenderBridge();
        if (!isMounted) return;

        setInitStatus("Initializing effects bridge...");
        const projectState = useProjectStore.getState();
        const { width, height } = projectState.project.settings;
        try {
          await initializeEffectsBridge(width, height);
        } catch (effectsError) {
          console.error(
            "[EditorInterface] EffectsBridge initialization failed:",
            effectsError,
          );
        }
        if (!isMounted) return;

        setInitStatus("Initializing transition bridge...");
        try {
          initializeTransitionBridge(width, height);
        } catch (transitionError) {
          console.error(
            "[EditorInterface] TransitionBridge initialization failed:",
            transitionError,
          );
        }
        if (!isMounted) return;

        setBridgesReady(true);
      } catch (error) {
        console.error("Failed to initialize engines/bridges:", error);
        if (isMounted) {
          setLocalError(
            error instanceof Error ? error.message : "Unknown error",
          );
          setInitStatus(
            `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    };

    initAll();

    return () => {
      isMounted = false;
      disposePlaybackBridge();
      disposeMediaBridge();
      disposeRenderBridge();
      disposeEffectsBridge();
      disposeTransitionBridge();
    };
  }, [initialize, initialized, initializing]);

  return {
    initialized: initialized && bridgesReady,
    initializing: initializing || (!bridgesReady && initialized),
    initError: initError || localError,
    initStatus,
  };
};

/**
 * Main Editor Interface — v2 cinematic layout.
 *
 * Grid (per mockup):
 *
 *   ┌─────────────── topbar ───────────────┐
 *   │                                      │
 *   │  media │   stage   │   inspector     │  ← top row (auto-fit)
 *   │   460  │   1fr     │      360        │
 *   ├──────────────────────────────────────┤
 *   │             timeline                 │  ← `tl-height` (vh)
 *   └──────────────────────────────────────┘
 *
 * Column widths and timeline height are user-resizable via the
 * dividers between panels. Values are persisted to CSS custom
 * properties on the root grid so panels can pick them up.
 */
export const EditorInterface: React.FC = () => {
  const { initialized, initializing, initError, initStatus } =
    useEngineInitialization();

  const { showShortcutsOverlay, setShowShortcutsOverlay } =
    useKeyboardShortcuts();
  useAutoSave();
  useLunaProjectPersistence();

  const {
    keyframeEditorOpen,
    setKeyframeEditorOpen,
    getSelectedClipIds,
    panels,
    setPanelVisible,
    timelineMaximized,
  } = useUIStore();
  const { project, updateClipKeyframes } = useProjectStore();
  const tracks = project.timeline.tracks;

  const [selectedKeyframeIds, setSelectedKeyframeIds] = React.useState<string[]>([]);
  const [copiedKeyframes, setCopiedKeyframes] = React.useState<
    import("@openreel/core").Keyframe[]
  >([]);

  const selectedClip = React.useMemo(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 0) return null;
    const clipId = selectedIds[0];
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }, [getSelectedClipIds, tracks]);

  const handleUpdateKeyframe = React.useCallback(
    (
      keyframeId: string,
      updates: Partial<import("@openreel/core").Keyframe>,
    ) => {
      if (!selectedClip?.keyframes) return;
      const keyframes = selectedClip.keyframes.map((kf) =>
        kf.id === keyframeId ? { ...kf, ...updates } : kf,
      );
      updateClipKeyframes(selectedClip.id, keyframes);
    },
    [selectedClip, updateClipKeyframes],
  );

  const handleDeleteKeyframe = React.useCallback(
    (keyframeId: string) => {
      if (!selectedClip?.keyframes) return;
      const keyframes = selectedClip.keyframes.filter(
        (kf) => kf.id !== keyframeId,
      );
      updateClipKeyframes(selectedClip.id, keyframes);
      setSelectedKeyframeIds((prev) => prev.filter((id) => id !== keyframeId));
    },
    [selectedClip, updateClipKeyframes],
  );

  const handleCopyKeyframes = React.useCallback(
    (keyframeIds: string[]) => {
      if (!selectedClip?.keyframes) return;
      const toCopy = selectedClip.keyframes.filter((kf) =>
        keyframeIds.includes(kf.id),
      );
      setCopiedKeyframes(toCopy);
    },
    [selectedClip],
  );

  const handlePasteKeyframes = React.useCallback(
    (clipId: string, time: number) => {
      const targetClip = tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!targetClip) return;
      const newKeyframes = copiedKeyframes.map((kf) => ({
        ...kf,
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        time: kf.time + time,
      }));
      updateClipKeyframes(clipId, [
        ...(targetClip.keyframes || []),
        ...newKeyframes,
      ]);
    },
    [copiedKeyframes, tracks, updateClipKeyframes],
  );

  const handleSelectKeyframe = React.useCallback(
    (keyframeId: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedKeyframeIds((prev) =>
          prev.includes(keyframeId)
            ? prev.filter((id) => id !== keyframeId)
            : [...prev, keyframeId],
        );
      } else {
        setSelectedKeyframeIds([keyframeId]);
      }
    },
    [],
  );

  // ── Layout state (resizable columns and timeline band) ──────────
  const rootRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<ResizeTarget | null>(null);
  const [mediaWidth, setMediaWidth] = useState(DEFAULT_MEDIA_W);
  const [rightDockWidth, setRightDockWidth] = useState(DEFAULT_RIGHT_DOCK_W);
  const [timelineVh, setTimelineVh] = useState(DEFAULT_TIMELINE_VH);

  const chatVisible = panels.agentChat?.visible ?? false;
  const [rightDockTab, setRightDockTab] = useState<RightDockTab>(
    chatVisible ? "chat" : "inspector",
  );

  useEffect(() => {
    setRightDockTab(chatVisible ? "chat" : "inspector");
  }, [chatVisible]);

  const mediaRef = useRef(mediaWidth);
  const rightDockRef = useRef(rightDockWidth);
  useEffect(() => {
    mediaRef.current = mediaWidth;
  }, [mediaWidth]);
  useEffect(() => {
    rightDockRef.current = rightDockWidth;
  }, [rightDockWidth]);

  const beginResize = useCallback(
    (target: ResizeTarget) => (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = target;
      document.body.style.cursor =
        target === "timeline" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const root = rootRef.current;
      const target = resizeRef.current;
      if (!root || !target) return;
      const rect = root.getBoundingClientRect();
      if (target === "media") {
        const maxByStage =
          rect.width - rightDockRef.current - 2 * RESIZE_HANDLE - MIN_STAGE_W;
        setMediaWidth(
          clamp(e.clientX - rect.left, MIN_MEDIA_W, Math.min(MAX_MEDIA_W, maxByStage)),
        );
        return;
      }
      if (target === "rightDock") {
        const maxByStage =
          rect.width - mediaRef.current - 2 * RESIZE_HANDLE - MIN_STAGE_W;
        setRightDockWidth(
          clamp(
            rect.right - e.clientX,
            MIN_RIGHT_DOCK_W,
            Math.min(MAX_RIGHT_DOCK_W, maxByStage),
          ),
        );
        return;
      }
      // timeline: vh based on the distance from bottom of the viewport
      const vh = ((window.innerHeight - e.clientY) / window.innerHeight) * 100;
      setTimelineVh(clamp(vh, MIN_TIMELINE_VH, MAX_TIMELINE_VH));
    };

    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Reflect resized panel sizes back into CSS variables so child styles
  // (timeline header padding, etc.) can react.
  useEffect(() => {
    const r = rootRef.current;
    if (!r) return;
    const tlVh = timelineMaximized ? COMPACT_TIMELINE_VH : timelineVh;
    r.style.setProperty("--media-w", `${mediaWidth}px`);
    r.style.setProperty("--inspector-w", `${rightDockWidth}px`);
    r.style.setProperty("--chat-w", `${rightDockWidth}px`);
    r.style.setProperty("--tl-height", `${tlVh}vh`);
  }, [mediaWidth, rightDockWidth, timelineVh, timelineMaximized]);

  if (initializing || !initialized) {
    return (
      <div className="w-full h-full bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <Text type="supporting" color="primary" className="text-fg-2 text-sm">Initializing editor…</Text>
          <Text type="supporting" color="secondary" className="text-fg-muted text-xs mt-2">{initStatus}</Text>
          {initError && (
            <Text type="supporting" className="text-status-error text-xs mt-2">{initError}</Text>
          )}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  // Grid template uses inline CSS for the resizable columns. The CSS
  // variables `--media-w`, `--inspector-w`, `--tl-height` are kept in
  // sync via the effect above so other components can use them too.
  const effectiveTimelineVh = timelineMaximized
    ? COMPACT_TIMELINE_VH
    : timelineVh;
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${mediaWidth}px ${RESIZE_HANDLE}px 1fr ${RESIZE_HANDLE}px ${rightDockWidth}px`,
    gridTemplateRows: `1fr ${RESIZE_HANDLE}px ${effectiveTimelineVh}vh`,
    gridTemplateAreas:
      "'media mh stage ih inspector' 'th th th th th' 'timeline timeline timeline timeline timeline'",
  };

  return (
    <div
      ref={rootRef}
      className="w-full h-full bg-bg text-fg overflow-hidden font-sans select-none relative z-20 flex flex-col"
    >
      <Toolbar />

      <div className="flex-1 min-h-0 flex">
        <EditorActionRail />
        <div
          className="flex-1 min-h-0 grid gap-0 bg-bg p-2.5"
          style={gridStyle}
        >
        <div
          className="bg-bg-1 min-w-0 min-h-0 overflow-hidden rounded-xl border border-border shadow-sm"
          style={{ gridArea: "media" }}
        >
          <PanelErrorBoundary name="Media">
            <AssetsPanel />
          </PanelErrorBoundary>
        </div>

        <div
          className="grid place-items-center cursor-col-resize group/h"
          style={{ gridArea: "mh" }}
          onMouseDown={beginResize("media")}
        >
          <span className="h-10 w-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          className="bg-stage-bg min-w-0 min-h-0 overflow-hidden rounded-xl border border-border shadow-sm"
          style={{ gridArea: "stage" }}
        >
          <PanelErrorBoundary name="Stage">
            <Preview />
          </PanelErrorBoundary>
        </div>

        <div
          className="grid place-items-center cursor-col-resize group/h"
          style={{ gridArea: "ih" }}
          onMouseDown={beginResize("rightDock")}
        >
          <span className="h-10 w-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          className="bg-bg-1 min-w-0 min-h-0 overflow-hidden rounded-xl border border-border shadow-sm flex flex-col"
          style={{ gridArea: "inspector" }}
        >
          <Tabs
            value={rightDockTab}
            onValueChange={(value) => {
              const next: RightDockTab = value === "chat" ? "chat" : "inspector";
              if (next === "chat") setPanelVisible("agentChat", true);
              setRightDockTab(next);
            }}
            className="shrink-0"
          >
            <TabsList
              aria-label="编辑面板标签"
              className="grid h-9 w-full grid-cols-2 gap-1 rounded-none border-b border-border bg-bg-1 p-1"
            >
              <TabsTrigger
                value="inspector"
                onClick={() => setRightDockTab("inspector")}
                className="h-7 rounded-[6px] text-[12px] text-fg-3 data-[state=active]:bg-bg-2 data-[state=active]:text-fg"
              >
                素材详情
              </TabsTrigger>
              <TabsTrigger
                value="chat"
                onClick={() => {
                  setPanelVisible("agentChat", true);
                  setRightDockTab("chat");
                }}
                className="h-7 rounded-[6px] text-[12px] text-fg-3 data-[state=active]:bg-bg-2 data-[state=active]:text-fg"
              >
                AI 编辑器
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="min-h-0 flex-1 overflow-hidden">
            {rightDockTab === "chat" && chatVisible ? (
              <PanelErrorBoundary name="AI Editor">
                <React.Suspense
                  fallback={
                    <div className="grid h-full place-items-center text-xs text-fg-muted">
                      Loading AI Editor…
                    </div>
                  }
                >
                  <ChatPanel
                    onClose={() => setPanelVisible("agentChat", false)}
                  />
                </React.Suspense>
              </PanelErrorBoundary>
            ) : (
              <PanelErrorBoundary name="Inspector">
                <InspectorPanel />
              </PanelErrorBoundary>
            )}
          </div>
        </div>

        <div
          className="grid place-items-center cursor-row-resize group/h"
          style={{ gridArea: "th" }}
          onMouseDown={beginResize("timeline")}
        >
          <span className="w-10 h-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          className="bg-tl-bg min-w-0 min-h-0 overflow-hidden flex flex-col rounded-xl border border-border shadow-sm"
          style={{ gridArea: "timeline" }}
        >
          {panels.audioMixer?.visible && (
            <div className="shrink-0 border-b border-border">
              <PanelErrorBoundary name="Audio Mixer">
                <AudioMixer
                  visible
                  onClose={() => setPanelVisible("audioMixer", false)}
                />
              </PanelErrorBoundary>
            </div>
          )}

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 min-h-0">
              <PanelErrorBoundary name="Timeline">
                <Timeline />
              </PanelErrorBoundary>
            </div>

            {keyframeEditorOpen && (
              <div className="shrink-0 min-w-0 border-l border-border">
                <PanelErrorBoundary name="Keyframe Editor">
                  <KeyframeEditorPanel
                    clip={selectedClip}
                    onClose={() => setKeyframeEditorOpen(false)}
                    onUpdateKeyframe={handleUpdateKeyframe}
                    onDeleteKeyframe={handleDeleteKeyframe}
                    onCopyKeyframes={handleCopyKeyframes}
                    onPasteKeyframes={handlePasteKeyframes}
                    selectedKeyframeIds={selectedKeyframeIds}
                    onSelectKeyframe={handleSelectKeyframe}
                    copiedKeyframes={copiedKeyframes}
                  />
                </PanelErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      <KeyboardShortcutsOverlay
        isOpen={showShortcutsOverlay}
        onClose={() => setShowShortcutsOverlay(false)}
      />

      <SpotlightTour />
      <MoGraphTour />
    </div>
  );
};

export default EditorInterface;
