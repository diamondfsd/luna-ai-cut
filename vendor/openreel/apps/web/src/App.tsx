import { useEffect, useCallback, useRef, useState, lazy, Suspense } from "react";
import { ToastContainer } from "./components/Toast";
import { ScriptViewDialog } from "./components/editor/ScriptViewDialog";
import { SearchModal } from "./components/editor/SearchModal";
import { MobileBlocker } from "./components/MobileBlocker";
import { WelcomeScreen } from "./components/welcome";
import { RecoveryDialog } from "./components/welcome/RecoveryDialog";
import { ProjectListScreen } from "./components/projects/ProjectListScreen";
import { SharePage } from "./pages/SharePage";
import { useUIStore } from "./stores/ui-store";
import { useProjectStore } from "./stores/project-store";
import { useRouter } from "./hooks/use-router";
import { useProjectRecovery } from "./hooks/useProjectRecovery";
import { projectManager } from "./services/project-manager";
import { installMcpListener } from "./services/agent/mcp-listener";
import { getLiveEditorHost } from "./services/agent/host-singleton";
import { createExportJobRunner } from "./services/agent/export-job-runner";
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core";
import { ToolcraftText as Text } from "@openreel/ui";

const EditorInterface = lazy(() =>
  import("./components/editor/EditorInterface").then((m) => ({
    default: m.EditorInterface,
  }))
);
const MotionCreatorApp = lazy(() =>
  import("./motion/MotionCreatorApp").then((module) => ({
    default: module.MotionCreatorApp,
  }))
);

const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
  <div className="h-screen w-screen bg-background flex flex-col items-center justify-center">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <Text type="supporting" color="secondary" className="text-sm text-text-secondary">{message}</Text>
  </div>
);

const PRESET_DIMENSIONS: Record<string, SocialMediaCategory> = {
  "1080x1920": "tiktok",
  "1920x1080": "youtube-video",
  "1080x1080": "instagram-post",
  "720x1280": "instagram-stories",
  "1280x720": "youtube-video",
};

const PRESET_PROJECT_NAMES: Record<SocialMediaCategory, string> = {
  tiktok: "TikTok",
  "instagram-reels": "Instagram Reels",
  "instagram-stories": "Instagram 快拍",
  "instagram-post": "Instagram 帖子",
  "youtube-shorts": "YouTube Shorts",
  "youtube-video": "YouTube 视频",
  facebook: "Facebook",
  twitter: "Twitter",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  intro: "片头",
  outro: "片尾",
  promo: "宣传片",
  "lower-third": "下三分之一字幕",
  slideshow: "幻灯片",
  custom: "自定义",
};

function App() {
  const { activeModal, closeModal, skipWelcomeScreen } = useUIStore();
  const { openModal: openSearchModal } = useUIStore();
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const { showDialog, availableSaves, recover, dismiss, clearAll } = useProjectRecovery();

  const { route, params, navigate, parsedDimensions, fps } = useRouter();
  const hasHandledInitialRoute = useRef(false);
  const [lunaProjectReady, setLunaProjectReady] = useState(false);
  const [lunaProjectError, setLunaProjectError] = useState(false);
  const isMotionHost =
    typeof window !== "undefined" &&
    window.location.hostname.startsWith("motion.");
  const isMotionSurface = isMotionHost || route === "motion";
  const isLunaEditor = route === "luna-editor";

  useEffect(() => {
    // The Luna iframe uses App rather than DesktopApp, so initialize the same
    // local job runner here for MCP export tools.
    getLiveEditorHost().setJobRunner(createExportJobRunner());
    return installMcpListener();
  }, []);

  useEffect(() => {
    const agent = window.openreel?.lunaAgent;
    if (!agent) return;
    return agent.onActivate(() => {
      useUIStore.getState().setPanelVisible("agentChat", true);
    });
  }, []);

  useEffect(() => {
    if (!isLunaEditor) {
      setLunaProjectReady(false);
      setLunaProjectError(false);
      return;
    }

    const projectId = params.projectId?.trim();
    if (!projectId) {
      setLunaProjectReady(false);
      setLunaProjectError(true);
      return;
    }

    let cancelled = false;
    setLunaProjectReady(false);
    setLunaProjectError(false);

    projectManager
      .loadLunaProject(projectId)
      .then((project) => {
        if (cancelled) return;
        useProjectStore.getState().loadProject(project);
        setLunaProjectReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[App] Failed to load Luna project:", error);
        setLunaProjectError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isLunaEditor, params.projectId]);

  useEffect(() => {
    if (hasHandledInitialRoute.current) return;

    if (isMotionSurface) {
      hasHandledInitialRoute.current = true;
    } else if (route === "luna-editor") {
      hasHandledInitialRoute.current = true;
    } else if (route === "new") {
      hasHandledInitialRoute.current = true;

      let projectName = "新建项目";
      let width = 1920;
      let height = 1080;
      let frameRate = fps;

      if (params.preset) {
        const presetKey = params.preset as SocialMediaCategory;
        const preset = SOCIAL_MEDIA_PRESETS[presetKey];
        if (preset) {
          width = preset.width;
          height = preset.height;
          frameRate = preset.frameRate || fps;
          projectName = `新建${PRESET_PROJECT_NAMES[presetKey]}项目`;
        }
      } else if (parsedDimensions) {
        width = parsedDimensions.width;
        height = parsedDimensions.height;

        const dimensionKey = `${width}x${height}`;
        const matchingPreset = PRESET_DIMENSIONS[dimensionKey];
        if (matchingPreset) {
          const preset = SOCIAL_MEDIA_PRESETS[matchingPreset];
          frameRate = preset.frameRate || fps;
        }

        const aspectRatio = width / height;
        if (aspectRatio < 1) {
          projectName = "新建竖屏视频";
        } else if (aspectRatio > 1) {
          projectName = "新建横屏视频";
        } else {
          projectName = "新建方形视频";
        }
      }

      createNewProject(projectName, { width, height, frameRate });
      navigate("editor");
    } else if (route === "editor" && skipWelcomeScreen) {
      hasHandledInitialRoute.current = true;
    } else if (["welcome", "projects", "templates", "recent"].includes(route)) {
      hasHandledInitialRoute.current = true;
    }
  }, [
    route,
    isMotionSurface,
    params,
    parsedDimensions,
    fps,
    createNewProject,
    navigate,
    skipWelcomeScreen,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && route !== "editor" && route !== "luna-editor") {
        navigate("editor");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearchModal("search");
      }
    },
    [route, navigate, openSearchModal],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const showWelcome =
    ["welcome", "templates", "recent"].includes(route) && !skipWelcomeScreen;
  const showProjectList = route === "projects";
  const initialTab =
    route === "templates"
      ? "templates"
      : route === "recent"
        ? "recent"
        : undefined;
  const isSharePage = route === "share" && params.shareId;

  return (
    <div className="h-screen w-screen bg-background text-text-primary overflow-hidden">
      <MobileBlocker />
      {isMotionSurface ? (
        <Suspense fallback={<LoadingSpinner message="正在加载动效编辑器..." />}>
          <MotionCreatorApp />
        </Suspense>
      ) : isSharePage ? (
        <SharePage shareId={params.shareId!} />
      ) : isLunaEditor ? (
        lunaProjectError ? (
          <LoadingSpinner message="项目打开失败" />
        ) : lunaProjectReady ? (
          <Suspense fallback={<LoadingSpinner message="正在加载编辑器..." />}>
            <EditorInterface />
          </Suspense>
        ) : (
          <LoadingSpinner message="正在打开项目..." />
        )
      ) : showProjectList ? (
        <ProjectListScreen />
      ) : showWelcome ? (
        <WelcomeScreen initialTab={initialTab} />
      ) : (
        <Suspense fallback={<LoadingSpinner message="正在加载编辑器..." />}>
          <EditorInterface />
        </Suspense>
      )}
      <ToastContainer />
      <ScriptViewDialog
        isOpen={activeModal === "scriptView"}
        onClose={closeModal}
      />
      <SearchModal isOpen={activeModal === "search"} onClose={closeModal} />
      {showDialog && availableSaves.length > 0 && (
        <RecoveryDialog
          saves={availableSaves}
          onRecover={async (saveId) => {
            const success = await recover(saveId);
            if (success) navigate("editor");
          }}
          onDismiss={dismiss}
          onClearAll={clearAll}
        />
      )}
    </div>
  );
}

export default App;
