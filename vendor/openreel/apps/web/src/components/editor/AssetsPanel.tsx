import React, { useCallback, useRef, useState } from "react";
import {
  Image as ImageIcon, Film, Music, Plus, Upload, Trash2,
  Square, Circle, Triangle, Star, ArrowRight, Hexagon, FileCode, AlertTriangle,
  RefreshCw, Palette, Sparkles, Video,
  Type, Shapes, Wand2, LayoutTemplate, Zap, Shuffle,
} from "@/icons/lucide-compat";
import {
  BACKGROUND_PRESETS,
  generateBackgroundBlob,
  type BackgroundPreset,
} from "../../services/background-generator";
import type { ShapeType, TextStyle } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import type { MediaItem } from "@openreel/core";
import { AspectRatioMatchDialog } from "./dialogs/AspectRatioMatchDialog";
import { AIGenTab } from "./AIGenTab";
import { RecipesTab } from "./panels/RecipesTab";
import { TemplatesTab } from "./panels/TemplatesTab";
import {
  EffectsPanel,
  TransitionsPanel,
} from "./panels/EffectsTransitionsPanel";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import { saveFileHandle, saveDirectoryHandle } from "../../services/media-storage";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { StickerPickerPanel } from "./inspector/StickerPickerPanel";
import { insertTimelineOverlay } from "../../stores/project/insert-timeline-overlay";

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

/**
 * Media Item Thumbnail Component
 * Shows thumbnail with metadata below (not overlaid)
 */
type MediaViewMode = "large" | "small" | "list";
type AssetsTab =
  | "media"
  | "text"
  | "graphics"
  | "effects"
  | "transitions"
  | "ai"
  | "recipes"
  | "templates";

const ASSETS_TABS: ReadonlyArray<{
  value: AssetsTab;
  label: string;
  description: string;
}> = [
  {
    value: "media",
    label: "素材",
    description: "导入视频、音频和图片素材。",
  },
  {
    value: "text",
    label: "文字",
    description: "添加标题预设和字幕元素。",
  },
  {
    value: "graphics",
    label: "图形",
    description: "创建形状、箭头和 SVG 叠加层。",
  },
  {
    value: "effects",
    label: "效果",
    description: "将效果拖到片段上即可应用。",
  },
  {
    value: "transitions",
    label: "转场",
    description: "将转场拖到片段边缘即可应用。",
  },
  {
    value: "ai",
    label: "AI 工具",
    description: "使用字幕、语音和智能剪辑工具。",
  },
  {
    value: "recipes",
    label: "配方",
    description: "应用片段效果、叠加层和文字组合。",
  },
  {
    value: "templates",
    label: "项目模板",
    description: "加载完整项目布局和预设。",
  },
] as const;

export const DEFAULT_TITLE_STYLE: Partial<TextStyle> = {
  fontSize: 96,
  fontWeight: 800,
  letterSpacing: -1,
};

export const TEXT_STYLE_PRESETS: ReadonlyArray<{
  name: string;
  text: string;
  style: Partial<TextStyle>;
}> = [
  { name: "标题", text: "标题", style: { fontSize: 72, fontWeight: 700 } },
  { name: "副标题", text: "副标题文字", style: { fontSize: 36, fontWeight: 400 } },
  {
    name: "下三分之一字幕",
    text: "姓名",
    style: {
      fontSize: 32,
      fontWeight: 600,
      textAlign: "left",
      verticalAlign: "bottom",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
    },
  },
  {
    name: "字幕",
    text: "字幕文字",
    style: {
      fontSize: 24,
      fontWeight: 400,
      verticalAlign: "bottom",
      shadowColor: "rgba(0, 0, 0, 0.8)",
      shadowBlur: 4,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
    },
  },
  {
    name: "主标题",
    text: "让画面动起来",
    style: {
      fontSize: 112,
      fontWeight: 900,
      letterSpacing: -2,
      lineHeight: 0.95,
      strokeWidth: 3,
    },
  },
  {
    name: "引用",
    text: "讲好一个故事。",
    style: {
      fontSize: 54,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1.25,
      shadowColor: "rgba(0, 0, 0, 0.65)",
      shadowBlur: 10,
      shadowOffsetY: 4,
    },
  },
  {
    name: "描边",
    text: "描边文字",
    style: {
      fontSize: 80,
      fontWeight: 900,
      letterSpacing: 2,
      strokeColor: "#111827",
      strokeWidth: 5,
    },
  },
  {
    name: "徽章",
    text: "全新发布",
    style: {
      fontSize: 28,
      fontWeight: 800,
      letterSpacing: 3,
      backgroundColor: "rgba(17, 24, 39, 0.88)",
    },
  },
];

const TAB_ICONS: Record<AssetsTab, React.ElementType> = {
  media: Video,
  text: Type,
  graphics: Shapes,
  effects: Zap,
  transitions: Shuffle,
  ai: Sparkles,
  recipes: Wand2,
  templates: LayoutTemplate,
};

const BACKGROUND_CATEGORY_LABELS = {
  all: "全部",
  solid: "纯色",
  gradient: "渐变",
  pattern: "图案",
  mesh: "网格渐变",
} as const;

const BACKGROUND_PRESET_LABELS: Record<string, string> = {
  "solid-black": "黑色",
  "solid-white": "白色",
  "solid-slate": "板岩灰",
  "solid-zinc": "锌灰",
  "solid-red": "红色",
  "solid-blue": "蓝色",
  "solid-green": "绿色",
  "solid-purple": "紫色",
  "gradient-sunset": "日落",
  "gradient-ocean": "海洋",
  "gradient-forest": "森林",
  "gradient-lavender": "薰衣草",
  "gradient-midnight": "午夜",
  "gradient-rose": "玫瑰",
  "gradient-gold": "金色",
  "gradient-noir": "黑色电影",
  "radial-spotlight": "聚光灯",
  "radial-glow": "光晕",
  "mesh-aurora": "极光",
  "mesh-nebula": "星云",
  "mesh-candy": "糖果",
  "mesh-sunset-beach": "海滩",
  "pattern-grid-dark": "深色网格",
  "pattern-grid-light": "浅色网格",
  "pattern-dots-dark": "深色点阵",
  "pattern-dots-light": "浅色点阵",
  "pattern-noise-dark": "胶片颗粒",
  "waves-ocean": "海浪",
  "waves-sunset": "日落海浪",
  "aurora-borealis": "北极光",
};

const getBackgroundPresetLabel = (preset: BackgroundPreset): string =>
  BACKGROUND_PRESET_LABELS[preset.id] ?? preset.name;

const PanelIconButton: React.FC<{
  label: string;
  icon: React.ComponentProps<typeof IconButton>["icon"];
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}> = ({ label, icon, onClick, className }) => (
  <IconButton
    label={label}
    icon={icon}
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={className}
  />
);

const PanelButton: React.FC<{
  label: string;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
  isDisabled?: boolean;
  children?: React.ReactNode;
}> = ({ label, onClick, className, isDisabled, children }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={isDisabled}
    className={className}
  >
    {children ?? label}
  </button>
);






const MediaThumbnail: React.FC<{
  item: MediaItem;
  isSelected: boolean;
  viewMode: MediaViewMode;
  onSelect: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAddToTimeline: () => void;
}> = ({
  item,
  isSelected,
  viewMode,
  onSelect,
  onDelete,
  onReplace,
  onDragStart,
  onAddToTimeline,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getIcon = () => {
    switch (item.type) {
      case "video":
        return Film;
      case "audio":
        return Music;
      case "image":
        return ImageIcon;
      default:
        return Film;
    }
  };

  const Icon = getIcon();

  const formatResolution = () => {
    if (item.metadata?.width && item.metadata?.height) {
      return `${item.metadata.width}×${item.metadata.height}`;
    }
    return null;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const iconColor = item.type === "audio"
    ? "text-primary/50"
    : item.type === "image"
      ? "text-primary/50"
      : "text-status-info/50";

  const borderClass = item.isPlaceholder
      ? "border-yellow-500 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]"
      : isSelected
        ? "border-accent ring-1 ring-accent/40 shadow-sm"
        : "border-border hover:border-border-strong";

  const hoverOverlay = (
    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center gap-2 animate-in fade-in duration-200">
      {item.isPlaceholder ? (
        <>
          <PanelIconButton
            label="替换素材"
            icon={<RefreshCw size={14} className="text-yellow-500" />}
            onClick={(e) => { e.stopPropagation(); onReplace(); }}
            className="p-2 bg-yellow-500/20 rounded-full hover:bg-yellow-500/40 backdrop-blur-sm transition-colors"
          />
          <PanelIconButton
            label="删除"
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          />
        </>
      ) : (
        <>
          <PanelIconButton
            label="添加到时间线"
            icon={<Plus size={14} className="text-primary" />}
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
            className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
          />
          <PanelIconButton
            label="删除"
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          />
        </>
      )}
    </div>
  );

  // --- List view ---
  if (viewMode === "list") {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 cursor-pointer transition-all group ${borderClass}`}
      >
        {/* Small thumbnail */}
        <div className="w-12 h-8 rounded-md bg-bg-2 relative overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon size={14} className={iconColor} />
            </div>
          )}
          {item.isPlaceholder && (
            <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
              <AlertTriangle size={12} className="text-yellow-500/70" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[12px] truncate font-medium ${isSelected ? "text-accent" : "text-fg-2"}`}
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-fg-muted">
            {item.metadata?.duration && <span>{formatDuration(item.metadata.duration)}</span>}
            {item.metadata?.duration && formatResolution() && <span>•</span>}
            {formatResolution() && <span>{formatResolution()}</span>}
            {(item.metadata?.duration || formatResolution()) && formatFileSize(item.metadata?.fileSize) && <span>•</span>}
            {formatFileSize(item.metadata?.fileSize) && <span>{formatFileSize(item.metadata?.fileSize)}</span>}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.isPlaceholder ? (
              <>
                <PanelIconButton
                  label="替换素材"
                  icon={<RefreshCw size={12} className="text-yellow-500" />}
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  className="p-1 bg-yellow-500/20 rounded hover:bg-yellow-500/40 transition-colors"
                />
                <PanelIconButton
                  label="删除"
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            ) : (
              <>
                <PanelIconButton
                  label="添加到时间线"
                  icon={<Plus size={12} className="text-primary" />}
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                  className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                />
                <PanelIconButton
                  label="删除"
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            )}
          </div>
        )}

        {isSelected && (
          <div className="w-2 h-2 bg-accent rounded-full shadow-sm flex-shrink-0" />
        )}
      </div>
    );
  }

  // --- Grid view (large & small) ---
  const thumbnailIconSize = viewMode === "small" ? 16 : 24;

  return (
    <div className="flex flex-col">
      {/* Thumbnail container */}
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAddToTimeline();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`h-[78px] bg-bg-2 rounded-lg border relative group cursor-pointer transition-all overflow-hidden ${borderClass}`}
      >
        {/* Thumbnail or placeholder */}
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-2">
            <Icon size={thumbnailIconSize} className={iconColor} />
          </div>
        )}

        {/* Audio waveform placeholder */}
        {item.type === "audio" && (
          <div className="absolute top-1/2 left-0 right-0 h-4 flex items-center gap-px px-2 -translate-y-1/2">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* Missing Asset Badge */}
        {item.isPlaceholder && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] text-black font-bold flex items-center gap-1">
            <AlertTriangle size={10} />
            缺失
          </div>
        )}

        {/* Duration badge on thumbnail */}
        {item.metadata?.duration && (
          <div className="absolute bottom-1.5 right-1.5 px-[5px] py-[2px] bg-black/60 rounded text-[10px] font-semibold text-white tabular-nums">
            {formatDuration(item.metadata.duration)}
          </div>
        )}

        {/* Warning icon overlay for placeholders */}
        {item.isPlaceholder && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-yellow-500/50" />
          </div>
        )}

        {/* Hover overlay with actions */}
        {isHovered && hoverOverlay}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full shadow-sm" />
        )}
      </div>

      {/* Filename below thumbnail */}
      <div
        className="text-[12px] truncate font-medium text-fg-2 mt-1.5"
        title={item.name}
      >
        {item.name}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ onImport: () => void }> = ({ onImport }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
    <div className="w-16 h-16 rounded-2xl bg-bg-2 border border-border flex items-center justify-center mb-4 shadow-inner">
      <Upload size={24} className="text-fg-muted" />
    </div>
    <Text type="body" color="secondary" weight="bold" display="block" className="mb-2 text-sm text-fg">
      尚未导入素材
    </Text>
    <Text type="supporting" color="secondary" display="block" className="mb-6 text-xs text-fg-3">
      将文件拖到这里，或点击导入
    </Text>
    <Button
      label="导入素材"
      variant="ghost"
      onClick={onImport}
      className="px-4 py-2 bg-bg-2 hover:bg-bg-3 border border-border text-fg-2 text-xs font-medium rounded-lg transition-all hover:border-accent/50"
    />
  </div>
);

const LoadingIndicator: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-bg-1/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
    <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
    <Text type="body" color="secondary" display="block" className="text-sm text-fg-2">{message}</Text>
  </div>
);

export const AssetsPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTabRaw] = useState<AssetsTab>("media");
  const ttsHasUnsaved = useTtsAudioStore((s) => s.generatedAudio !== null && !s.isAudioSaved);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);

  const setActiveTab = useCallback((tab: AssetsTab) => {
    if (activeTab === "ai" && tab !== "ai" && ttsHasUnsaved) {
      toast.warning("未保存的音频已丢弃", "请先保存到素材库或下载。");
    }
    setActiveTabRaw(tab);
  }, [activeTab, ttsHasUnsaved]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showAspectRatioDialog, setShowAspectRatioDialog] = useState(false);
  const [aspectRatioDialogData, setAspectRatioDialogData] = useState<{
    videoWidth: number;
    videoHeight: number;
    itemToAdd: MediaItem;
  } | null>(null);
  const [sortOrder, setSortOrder] = useState<"none" | "asc" | "desc">("none");
  const [generatingBackground, setGeneratingBackground] = useState<
    string | null
  >(null);
  const [backgroundCategory, setBackgroundCategory] = useState<
    "all" | "solid" | "gradient" | "pattern" | "mesh"
  >("all");

  // Project store
  const {
    project,
    importMedia,
    importWorkspaceAsset,
    deleteMedia,
    replaceMediaAsset,
    updateSettings,
  } = useProjectStore();
  const mediaItems = project.mediaLibrary.items;

  // UI store
  const { select, isSelected, startDrag, openModal } = useUIStore();

  // Count missing assets
  const missingAssetsCount = mediaItems.filter(
    (item) => item.isPlaceholder,
  ).length;

  // Filter media items by the missing-assets toggle, then optional sort
  const baseFilteredItems = mediaItems.filter((item) =>
    showOnlyMissing ? item.isPlaceholder : true,
  );
  const filteredItems =
    sortOrder === "none"
      ? baseFilteredItems
      : [...baseFilteredItems].sort((a, b) => {
          const comparison = a.name.localeCompare(b.name);
          return sortOrder === "desc" ? -comparison : comparison;
        });

  // Handle file import with loading state
  const handleFileImport = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setIsImporting(true);
      const fileArray = Array.from(files);

      try {
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          setImportProgress(
          `正在导入 ${file.name}（${i + 1}/${fileArray.length}）...`,
          );

          const result = await importMedia(file);

          // If it's a video with audio, extract audio to separate track
          if (result.success && file.type.startsWith("video/")) {
            setImportProgress(`正在从 ${file.name} 提取音频...`);
            // Audio extraction is handled by the importMedia function
            // The audio track is created automatically when adding to timeline
          }
        }
      } catch (error) {
        console.error("Import failed:", error);
      } finally {
        setIsImporting(false);
        setImportProgress("");
      }
    },
    [importMedia],
  );

  // Handle drag and drop import — capture FileSystemFileHandle for each dropped file
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Snapshot dataTransfer synchronously — it becomes inert after the first await.
      const droppedFiles = e.dataTransfer.files;
      const handlePromises =
        "getAsFileSystemHandle" in DataTransferItem.prototype
          ? Array.from(e.dataTransfer.items)
              .filter((item) => item.kind === "file")
              .map(async (item) => {
                try {
                  const handle = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }).getAsFileSystemHandle();
                  if (handle.kind === "file") {
                    const fileHandle = handle as FileSystemFileHandle;
                    const file = await fileHandle.getFile();
                    await saveFileHandle(file.name, file.size, fileHandle);
                  }
                } catch {
                  // Ignore — handle capture is best-effort
                }
              })
          : [];

      await Promise.all(handlePromises);
      handleFileImport(droppedFiles);
    },
    [handleFileImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Handle media item selection
  const handleSelectItem = useCallback(
    (itemId: string) => {
      select({ type: "clip", id: itemId });
    },
    [select],
  );

  // Handle media item deletion
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      await deleteMedia(itemId);
    },
    [deleteMedia],
  );

  // Handle asset replacement
  const handleReplaceAsset = useCallback(
    async (itemId: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,audio/*,image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          setIsImporting(true);
          setImportProgress(`正在替换素材...`);
          try {
            await replaceMediaAsset(itemId, file);
          } catch (error) {
            console.error("Asset replacement failed:", error);
          } finally {
            setIsImporting(false);
            setImportProgress("");
          }
        }
      };
      input.click();
    },
    [replaceMediaAsset],
  );

  const handleRelinkFromFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      toast.error("不支持选择文件夹", "请使用缺失素材旁的刷新按钮逐个重新关联。");
      return;
    }
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    } catch {
      return; // user cancelled
    }

    const { project } = useProjectStore.getState();
    const placeholders = project.mediaLibrary.items.filter((item) => item.isPlaceholder);
    if (placeholders.length === 0) return;

    // Persist the directory handle for future auto-restore
    try { await saveDirectoryHandle(project.id, dirHandle); } catch { /* best-effort */ }

    // Build a name:size → {File, handle} map for reliable matching
    const fileMap = new Map<string, { file: File; handle: FileSystemFileHandle }>();
    const entries = (dirHandle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
    for await (const [, fh] of entries) {
      if ((fh as FileSystemHandle).kind === "file") {
        const fileHandle = fh as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        fileMap.set(`${file.name.toLowerCase()}:${file.size}`, { file, handle: fileHandle });
      }
    }

    setIsImporting(true);
    let linked = 0;
    for (const item of placeholders) {
      // Match on original source file name + size (same strategy as auto-restore)
      const key = item.sourceFile
        ? `${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`
        : null;
      const entry = key ? fileMap.get(key) : null;
      if (entry) {
        setImportProgress(`正在重新关联 ${item.name}…`);
        try {
          // Save individual file handle for future auto-restore
          try { await saveFileHandle(entry.file.name, entry.file.size, entry.handle); } catch { /* best-effort */ }
          await replaceMediaAsset(item.id, entry.file, dirHandle.name);
          linked++;
        } catch (err) {
          console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
        }
      }
    }
    setIsImporting(false);
    setImportProgress("");

    if (linked > 0) {
      toast.success(`已重新关联 ${linked}/${placeholders.length} 个素材`);
    } else {
      toast.error("未找到匹配项", "所选文件夹中没有按文件名匹配到缺失素材的文件。");
    }
  }, [replaceMediaAsset]);

  // Handle drag start for timeline placement
  const handleItemDragStart = useCallback(
    (e: React.DragEvent, item: MediaItem) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({ mediaId: item.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      startDrag("media", { mediaId: item.id, mediaType: item.type });
    },
    [startDrag],
  );

  const addMediaToTimeline = useCallback(async (item: MediaItem) => {
    const { addClipToNewTrack } = useProjectStore.getState();
    await addClipToNewTrack(item.id, playheadPosition);
  }, [playheadPosition]);

  const handleConfirmAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    await updateSettings({
      width: aspectRatioDialogData.videoWidth,
      height: aspectRatioDialogData.videoHeight,
    });

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, updateSettings, addMediaToTimeline]);

  const handleCancelAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, addMediaToTimeline]);

  const handleAddToTimeline = useCallback(
    async (item: MediaItem) => {
      const { project: currentProject } = useProjectStore.getState();
      const tracks = currentProject.timeline.tracks;
      const hasClips = tracks.some((track) => track.clips.length > 0);

      if (
        !hasClips &&
        item.type === "video" &&
        item.metadata?.width &&
        item.metadata?.height
      ) {
        const videoWidth = item.metadata.width;
        const videoHeight = item.metadata.height;
        const projectWidth = currentProject.settings.width;
        const projectHeight = currentProject.settings.height;

        if (videoWidth !== projectWidth || videoHeight !== projectHeight) {
          setAspectRatioDialogData({ videoWidth, videoHeight, itemToAdd: item });
          setShowAspectRatioDialog(true);
          return;
        }
      }

      await addMediaToTimeline(item);
    },
    [addMediaToTimeline],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleWorkspaceImport = useCallback(async () => {
    const chooseAssets = window.openreel?.lunaProject?.chooseAssets;
    if (!chooseAssets) {
      triggerFileInput();
      return;
    }

    setIsImporting(true);
    setImportProgress("正在打开素材选择器...");
    try {
      const existingPaths = project.mediaLibrary.items
        .map((item) => item.sourcePath)
        .filter((path): path is string => Boolean(path));
      const assets = await chooseAssets(project.id, existingPaths);
      for (const asset of assets) {
        const result = await importWorkspaceAsset(asset);
        if (!result.success) {
          throw new Error(result.error?.message || "素材导入失败");
        }
      }
    } catch (error) {
      console.error("Workspace asset import failed:", error);
      toast.error(error instanceof Error ? error.message : "素材导入失败");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  }, [importWorkspaceAsset, project, triggerFileInput]);

  const handleImportBackground = useCallback(
    async (preset: BackgroundPreset) => {
      setGeneratingBackground(preset.id);
      try {
        const { width, height } = project.settings;
        const blob = await generateBackgroundBlob(preset, width, height);
        const file = new File([blob], `${preset.name}_${width}x${height}.png`, {
          type: "image/png",
        });
        const result = await importMedia(file);
        if (result.success && result.actionId) {
          const { addClipToNewTrack } = useProjectStore.getState();
          await addClipToNewTrack(result.actionId);
        }
      } catch (error) {
        console.error("Failed to generate background:", error);
      } finally {
        setGeneratingBackground(null);
      }
    },
    [importMedia, project.settings],
  );

  const filteredBackgrounds = BACKGROUND_PRESETS.filter(
    (preset) =>
      backgroundCategory === "all" || preset.category === backgroundCategory,
  );

  const renderSectionContent = (tab: AssetsTab): React.ReactNode => {
    switch (tab) {
      case "media":
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-[18px] shrink-0">
              <div className="font-bold text-[18px] text-fg mb-[14px]">素材</div>
              <div className="flex gap-2 mb-[18px]">
                <button
                  type="button"
                  aria-label="导入素材"
                  onClick={handleWorkspaceImport}
                  className="flex-1 flex items-center justify-center gap-[7px] bg-bg border border-border rounded-[9px] p-[10px] font-medium text-[13px] text-fg-2"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-3)"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 16V4M7 9l5-5 5 5" />
                    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
                  </svg>
                  导入
                </button>
                <button
                  type="button"
                  aria-label="录制"
                  onClick={() => openModal("recorder")}
                  className="flex-1 flex items-center justify-center gap-[7px] bg-bg border border-border rounded-[9px] p-[10px] font-medium text-[13px] text-fg-2"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-3)"
                    strokeWidth="1.9"
                  >
                    <circle cx="12" cy="12" r="8" />
                    <circle cx="12" cy="12" r="3" fill="var(--fg-3)" stroke="none" />
                  </svg>
                  录制
                </button>
                <button
                  type="button"
                  aria-label="排序素材"
                  onClick={() =>
                    setSortOrder((prev) =>
                      prev === "none" ? "asc" : prev === "asc" ? "desc" : "none",
                    )
                  }
                  className="w-[42px] flex items-center justify-center bg-bg border border-border rounded-[9px]"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-3)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M3 7h13M3 7l3-3M3 7l3 3M21 17H8M21 17l-3-3M21 17l-3 3" />
                  </svg>
                </button>
              </div>
            </div>

            {missingAssetsCount > 0 && (
              <div className="px-4 pb-3 space-y-2">
                <PanelButton
                  label="仅显示缺失素材"
                  onClick={() => setShowOnlyMissing(!showOnlyMissing)}
                  className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-between ${
                    showOnlyMissing
                      ? "bg-yellow-500/10 border-yellow-500 text-yellow-500"
                      : "bg-background-tertiary border-border text-text-secondary hover:border-yellow-500/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span>仅显示缺失素材</span>
                  </div>
                  <div className="px-2 py-0.5 rounded-full bg-yellow-500 text-black text-[10px] font-bold">
                    {missingAssetsCount}
                  </div>
                </PanelButton>
                <PanelButton
                  label="从文件夹重新关联"
                  onClick={handleRelinkFromFolder}
                  className="w-full px-3 py-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 text-yellow-500 text-xs font-medium transition-all hover:bg-yellow-500/15 flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  <span>从文件夹重新关联…</span>
                </PanelButton>
              </div>
            )}

            <div
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar ${isDragOver ? "bg-accent-soft" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="px-4 pb-[18px] relative">
                {filteredItems.length > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13px] font-semibold text-fg-2">项目素材</span>
                    <span className="text-[12px] font-medium text-fg-muted">{filteredItems.length}</span>
                  </div>
                )}
                {filteredItems.length === 0 ? (
                  <EmptyState onImport={handleWorkspaceImport} />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredItems.map((item) => (
                      <MediaThumbnail
                        key={item.id}
                        item={item}
                        isSelected={isSelected(item.id)}
                        viewMode="large"
                        onSelect={() => handleSelectItem(item.id)}
                        onDelete={() => handleDeleteItem(item.id)}
                        onReplace={() => handleReplaceAsset(item.id)}
                        onDragStart={(e) => handleItemDragStart(e, item)}
                        onAddToTimeline={() => handleAddToTimeline(item)}
                      />
                    ))}
                    <div className="flex flex-col">
                      <PanelButton
                        label="添加素材"
                        onClick={handleWorkspaceImport}
                        className="h-[78px] bg-bg-2 rounded-lg border border-dashed border-border hover:border-accent/50 hover:bg-accent-soft relative flex items-center justify-center cursor-pointer transition-all overflow-hidden group"
                      >
                        <div className="flex flex-col items-center gap-1.5">
                          <Upload size={20} className="text-fg-muted group-hover:text-accent transition-colors" />
                          <span className="text-[10px] text-fg-muted group-hover:text-accent transition-colors font-medium">添加素材</span>
                        </div>
                      </PanelButton>
                    </div>
                  </div>
                )}

                {isDragOver && (
                  <div className="absolute inset-4 border-2 border-dashed border-accent rounded-xl flex items-center justify-center bg-accent-soft pointer-events-none z-50 backdrop-blur-sm">
                    <div className="text-accent text-sm font-bold bg-bg-1 px-4 py-2 rounded-full shadow-lg">
                      将文件拖到这里导入
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      case "graphics":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="px-4 py-4">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                      <Text type="label" color="secondary" weight="bold" display="block" className="flex items-center gap-1.5 text-xs">
                      <Palette size={12} />
                      背景
                    </Text>
                  </div>
                  <div className="flex gap-1.5 mb-3 flex-wrap">
                    {(["all", "solid", "gradient", "mesh", "pattern"] as const).map(
                      (cat) => (
                        <SelectableCard
                          key={cat}
                          label={BACKGROUND_CATEGORY_LABELS[cat]}
                          isSelected={backgroundCategory === cat}
                          onChange={() => setBackgroundCategory(cat)}
                          onClick={() => setBackgroundCategory(cat)}
                          padding={1}
                          variant={backgroundCategory === cat ? "green" : "muted"}
                          className={`px-2.5 py-1 text-[10px] rounded-md transition-all ${
                            backgroundCategory === cat
                              ? "bg-primary text-white"
                              : "bg-background-tertiary text-text-muted hover:text-text-secondary"
                          }`}
                        >
                          {BACKGROUND_CATEGORY_LABELS[cat]}
                        </SelectableCard>
                      ),
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {filteredBackgrounds.map((preset) => (
                      <PanelButton
                        key={preset.id}
                        label={getBackgroundPresetLabel(preset)}
                        onClick={() => handleImportBackground(preset)}
                        isDisabled={generatingBackground !== null}
                        className="aspect-square rounded-lg border border-border hover:border-primary/50 transition-all overflow-hidden relative group disabled:opacity-50"
                      >
                        <span className="absolute inset-0" style={{ background: preset.thumbnail }} />
                        {generatingBackground === preset.id && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Plus size={16} className="text-white" />
                        </div>
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white bg-black/60 py-0.5 px-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                          {getBackgroundPresetLabel(preset)}
                        </span>
                      </PanelButton>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">
                    形状
                  </Text>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        type: "rectangle" as ShapeType,
                        icon: Square,
                        label: "矩形",
                      },
                      { type: "circle" as ShapeType, icon: Circle, label: "圆形" },
                      {
                        type: "triangle" as ShapeType,
                        icon: Triangle,
                        label: "三角形",
                      },
                      { type: "star" as ShapeType, icon: Star, label: "星形" },
                      {
                        type: "arrow" as ShapeType,
                        icon: ArrowRight,
                        label: "箭头",
                      },
                      {
                        type: "polygon" as ShapeType,
                        icon: Hexagon,
                        label: "多边形",
                      },
                    ].map((shape) => (
                      <PanelButton
                        key={shape.type}
                        label={shape.label}
                        onClick={async () => {
                          const created = await insertTimelineOverlay(
                            playheadPosition,
                            5,
                            (trackId) =>
                              useProjectStore
                                .getState()
                                .createShapeClip(
                                  trackId,
                                  playheadPosition,
                                  shape.type,
                                ),
                          );
                          if (created) {
                            select({
                              type: "shape-clip",
                              id: created.id,
                              trackId: created.trackId,
                            });
                          }
                        }}
                        className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                      >
                        <shape.icon
                          size={20}
                          className="text-text-secondary group-hover:text-primary transition-colors"
                        />
                        <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                          {shape.label}
                        </span>
                      </PanelButton>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">
                    3D 对象
                  </Text>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { type: "mesh-cube" as ShapeType, label: "立方体", icon: "□" },
                      { type: "mesh-sphere" as ShapeType, label: "球体", icon: "○" },
                      { type: "mesh-torus" as ShapeType, label: "圆环", icon: "◯" },
                      { type: "mesh-cone" as ShapeType, label: "圆锥", icon: "△" },
                      { type: "mesh-cylinder" as ShapeType, label: "圆柱", icon: "▯" },
                      { type: "mesh-icosahedron" as ShapeType, label: "二十面体", icon: "◆" },
                    ]).map((mesh) => (
                      <PanelButton
                        key={mesh.type}
                        label={mesh.label}
                        onClick={async () => {
                          const created = await insertTimelineOverlay(
                            playheadPosition,
                            5,
                            (trackId) =>
                              useProjectStore
                                .getState()
                                .createShapeClip(
                                  trackId,
                                  playheadPosition,
                                  mesh.type,
                                ),
                          );
                          // Nudge the rotation so the 3D depth is visible from
                          // the get-go (otherwise a head-on cube looks flat).
                          if (created) {
                            useProjectStore.getState().updateClipRotate3D(
                              created.id,
                              { x: -18, y: 28, z: 0 },
                            );
                            select({
                              type: "shape-clip",
                              id: created.id,
                              trackId: created.trackId,
                            });
                          }
                        }}
                        className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                      >
                        <span className="text-2xl text-text-secondary group-hover:text-primary transition-colors leading-none">
                          {mesh.icon}
                        </span>
                        <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                          {mesh.label}
                        </span>
                      </PanelButton>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">
                    SVG 导入
                  </Text>
                  <PanelButton
                    label="导入 SVG 文件"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".svg";
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                          const content = await file.text();
                          const created = await insertTimelineOverlay(
                            playheadPosition,
                            5,
                            (trackId) =>
                              useProjectStore
                                .getState()
                                .importSVG(content, trackId, playheadPosition),
                          );
                          if (created) {
                            select({
                              type: "shape-clip",
                              id: created.id,
                              trackId: created.trackId,
                            });
                          }
                        }
                      };
                      input.click();
                    }}
                    className="w-full py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 group"
                  >
                    <FileCode
                      size={16}
                      className="text-text-secondary group-hover:text-primary transition-colors"
                    />
                    <span className="text-xs text-text-secondary group-hover:text-text-primary">
                      导入 SVG 文件
                    </span>
                  </PanelButton>
                </div>

                <div className="mb-6">
                  <StickerPickerPanel />
                </div>
              </div>
            </div>
          </div>
        );
      case "text":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-0 px-4 py-4 space-y-3">
                <PanelButton
                  label="添加标题"
                  onClick={async () => {
                    const created = await insertTimelineOverlay(
                      playheadPosition,
                      5,
                      (trackId) =>
                        useProjectStore
                          .getState()
                          .createTextClip(
                            trackId,
                            playheadPosition,
                            "新标题",
                            5,
                            DEFAULT_TITLE_STYLE,
                          ),
                      undefined,
                      "text",
                    );
                    if (created) {
                      select({
                        type: "text-clip",
                        id: created.id,
                        trackId: created.trackId,
                      });
                    }
                  }}
                  className="flex min-h-[72px] w-full min-w-0 flex-col items-center justify-center rounded-lg border border-border bg-background-tertiary px-3 py-3 text-center transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <span className="block max-w-full truncate text-base font-bold leading-tight text-text-primary">
                    添加标题
                  </span>
                  <Text
                    type="supporting"
                    color="secondary"
                    display="block"
                    maxLines={1}
                    className="mt-1 max-w-full text-[11px] leading-tight"
                  >
                    点击将文字添加到时间线
                  </Text>
                </PanelButton>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  {TEXT_STYLE_PRESETS.map((preset) => (
                    <PanelButton
                      key={preset.name}
                      label={preset.name}
                      onClick={async () => {
                        const created = await insertTimelineOverlay(
                          playheadPosition,
                          5,
                          (trackId) =>
                            useProjectStore
                              .getState()
                              .createTextClip(
                                trackId,
                                playheadPosition,
                                preset.text,
                                5,
                                preset.style,
                              ),
                          undefined,
                          "text",
                        );
                        if (created) {
                          select({
                            type: "text-clip",
                            id: created.id,
                            trackId: created.trackId,
                          });
                        }
                      }}
                      className="flex min-h-[44px] min-w-0 items-center justify-center rounded-lg border border-border bg-background-tertiary px-2 py-2 text-center text-xs font-medium leading-tight text-text-secondary transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-text-primary"
                    >
                      <span className="block max-w-full truncate">
                        {preset.name}
                      </span>
                    </PanelButton>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      case "effects":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <EffectsPanel />
          </div>
        );
      case "transitions":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <TransitionsPanel />
          </div>
        );
      case "ai":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <AIGenTab />
          </div>
        );
      case "recipes":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <RecipesTab />
          </div>
        );
      case "templates":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <TemplatesTab />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-tour="assets"
      className="w-full h-full bg-bg-1 overflow-hidden flex flex-row relative"
    >
      {/* ── Vertical tool rail (icon + label, left) ───────────── */}
      <div className="flex flex-col items-center gap-1 px-0 py-[14px] border-r border-border bg-bg-1 overflow-y-auto scrollbar-none shrink-0 w-[92px]">
        {ASSETS_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.value];
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-label={tab.label}
              aria-pressed={isActive}
              title={tab.label}
              onClick={() => setActiveTab(tab.value)}
              className={`group flex h-16 w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] px-1 py-2 text-[10px] leading-tight tracking-tight transition-colors ${
                isActive
                  ? "bg-selected text-accent font-semibold"
                  : "text-fg-muted font-medium"
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 1.8 : 1.7} />
              <span className="block max-w-full text-center leading-[11px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Body: section content fills the remaining space ──── */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-bg-1 relative">
        {isImporting && (
          <LoadingIndicator message={importProgress || "Importing media..."} />
        )}

        <input
          ref={fileInputRef}
          type="file"
              aria-label="导入素材"
          accept="video/*,audio/*,image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFileImport(event.target.files);
            event.target.value = "";
          }}
        />

        {/* Dynamic Section Content */}
        <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
          {activeTab !== "media" && (
            <div className="min-w-0 px-4 pt-[18px] pb-0 shrink-0">
              <div
                className="truncate font-bold text-[18px] text-fg"
                title={ASSETS_TABS.find((t) => t.value === activeTab)?.label}
              >
                {ASSETS_TABS.find((t) => t.value === activeTab)?.label}
              </div>
            </div>
          )}
          {renderSectionContent(activeTab)}
        </div>
      </div>

      {aspectRatioDialogData && (
        <AspectRatioMatchDialog
          isOpen={showAspectRatioDialog}
          videoWidth={aspectRatioDialogData.videoWidth}
          videoHeight={aspectRatioDialogData.videoHeight}
          currentWidth={project.settings.width}
          currentHeight={project.settings.height}
          onConfirm={handleConfirmAspectRatioMatch}
          onCancel={handleCancelAspectRatioMatch}
        />
      )}

    </div>
  );
};

export default AssetsPanel;
