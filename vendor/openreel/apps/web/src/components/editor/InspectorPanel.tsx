import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Captions, Shuffle } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import type { Transform, EditingTemplatePrimitive } from "@openreel/core";
import {
  ChromaKeyEngine,
  getMediaItemCapabilities,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
} from "@openreel/core";
import { mergeEditingTemplateControlValues } from "./panels/EditingTemplateControls";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  DEFAULT_NOISE_REDUCTION,
} from "../../bridges/audio-bridge-effects";
import { toast } from "../../stores/notification-store";
import {
  FONT_CATEGORIES,
  FONT_FILE_ACCEPT,
  registerCustomFont,
  useCustomFonts,
} from "./inspector/font-options";
import { getNoiseReductionPreset } from "./inspector/noise-reduction-presets";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ColorSelector } from "../../motion/components/primitives";
import {
  getTabIdsForClipType,
  type InspectorClipType,
} from "./inspector/clip-tabs.config";
import { InspectorClipHeader } from "./inspector/shell/InspectorClipHeader";
import { InspectorTabErrorBoundary } from "./inspector/shell/InspectorTabErrorBoundary";
import { InspectorSection } from "./inspector/shell/InspectorSection";
import { ColorTab } from "./inspector/tabs/ColorTab";
import { AudioTab } from "./inspector/tabs/AudioTab";
import { TransformTab } from "./inspector/tabs/TransformTab";
import { SpeedTab } from "./inspector/tabs/SpeedTab";
import { AnimateTab } from "./inspector/tabs/AnimateTab";
import { StyleTab } from "./inspector/tabs/StyleTab";
import { EffectsTab } from "./inspector/tabs/EffectsTab";
import { AiTab } from "./inspector/tabs/AiTab";
import { TransitionInspector } from "./inspector/TransitionInspector";
import { MultiClipInspector } from "./inspector/MultiClipInspector";

// Initialize engines as singletons
const chromaKeyEngine = new ChromaKeyEngine({ width: 1920, height: 1080 });

const Section = InspectorSection;

const CLIP_TYPE_LABELS: Record<InspectorClipType, string> = {
  video: "视频",
  image: "图片",
  audio: "音频",
  text: "文字",
  shape: "图形",
  svg: "SVG",
  sticker: "贴纸",
};

const SUBTITLE_POSITION_LABELS = {
  top: "顶部",
  center: "居中",
  bottom: "底部",
} as const;

const CAPTION_ANIMATION_LABELS: Record<CaptionAnimationStyle, string> = {
  none: "静态",
  "word-highlight": "逐词高亮",
  "word-by-word": "逐词显示",
  karaoke: "卡拉 OK",
  bounce: "弹跳",
  typewriter: "打字机",
};

const FONT_CATEGORY_LABELS: Record<string, string> = {
  Popular: "热门",
  "Display & Headlines": "展示与标题",
  "Elegant & Serif": "优雅与衬线",
  "Modern & Clean": "现代与简洁",
  "Handwritten & Script": "手写与书法",
  "Fun & Creative": "趣味与创意",
  Monospace: "等宽",
  System: "系统",
};

const componentToHex = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

const cssColorToHex = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const [, r, g, b] = trimmed;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (!rgba) return fallback;

  return `#${componentToHex(Number(rgba[1]))}${componentToHex(
    Number(rgba[2]),
  )}${componentToHex(Number(rgba[3]))}`;
};

const cssColorAlpha = (
  value: string | undefined,
  fallback: "0" | "0.5" | "0.7" | "1" = "0.7",
): "0" | "0.5" | "0.7" | "1" => {
  const alpha = value?.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i)?.[1];
  if (alpha === "0" || alpha === "0.5" || alpha === "0.7" || alpha === "1") {
    return alpha;
  }
  return fallback;
};

const rgbaFromHex = (hex: string, alpha: string): string => {
  const value = cssColorToHex(hex, "#000000");
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const EmptyState: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
    <Text type="body" weight="semibold" display="block" className="mb-1.5 text-sm text-fg">
      未选择内容
    </Text>
    <Text type="supporting" display="block" className="text-xs text-fg-muted">
      选择一个片段以查看属性
    </Text>
  </div>
);

export const InspectorPanel: React.FC = () => {
  // Stores
  const {
    getClip,
    getClipTransition,
    updateClipTransition,
    removeClipTransition,
    importSRT,
    updateSubtitle,
    getSubtitle,
    getEditingTemplate,
    updateEditingTemplateApplication,
    removeEditingTemplateApplication,
  } = useProjectStore();
  const project = useProjectStore((state) => state.project);
  const { getSelectedClipIds, clearSelection } = useUIStore();
  const selectedItems = useUIStore((state) => state.selectedItems);
  const effectApplicationClipId = useUIStore(
    (state) => state.effectApplicationClipId,
  );
  const startEffectApplication = useUIStore(
    (state) => state.startEffectApplication,
  );
  const finishEffectApplication = useUIStore(
    (state) => state.finishEffectApplication,
  );
  const selectedClipIds = getSelectedClipIds();
  const pausePlayback = useTimelineStore((state) => state.pause);
  const lockPlayback = useTimelineStore((state) => state.lockPlayback);
  const unlockPlayback = useTimelineStore((state) => state.unlockPlayback);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const [expandedRecipeApplicationId, setExpandedRecipeApplicationId] =
    useState<string | null>(null);
  const [captionWordsPerLine, setCaptionWordsPerLine] = useState(5);
  const [recipeControlValues, setRecipeControlValues] = useState<
    Record<string, Record<string, EditingTemplatePrimitive>>
  >({});
  const srtInputRef = useRef<HTMLInputElement>(null);
  const customFonts = useCustomFonts();

  useEffect(() => {
    setExpandedRecipeApplicationId(null);
  }, [selectedClipIds.join("|")]);

  // Check if a subtitle is selected
  const selectedSubtitleId = useMemo(() => {
    const subtitleSelection = selectedItems.find(
      (item) => item.type === "subtitle",
    );
    return subtitleSelection?.id || null;
  }, [selectedItems]);

  const selectedSubtitle = useMemo(() => {
    if (!selectedSubtitleId) return null;
    return getSubtitle(selectedSubtitleId) || null;
  }, [selectedSubtitleId, getSubtitle, project.timeline.subtitles]);

  const selectedTransitionId = useMemo(() => {
    return selectedItems.find((item) => item.type === "transition")?.id ?? null;
  }, [selectedItems]);

  const selectedTransition = useMemo(() => {
    if (!selectedTransitionId) return null;
    return getClipTransition(selectedTransitionId) ?? null;
  }, [selectedTransitionId, getClipTransition, project.modifiedAt]);

  const transitionClipA = useMemo(
    () => (selectedTransition ? getClip(selectedTransition.clipAId) ?? null : null),
    [selectedTransition, getClip, project.modifiedAt],
  );
  const transitionClipB = useMemo(
    () =>
      selectedTransition?.clipBId
        ? getClip(selectedTransition.clipBId) ?? null
        : null,
    [selectedTransition, getClip, project.modifiedAt],
  );

  const selectedTimelineClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    return getClip(selectedClipIds[0]) || null;
  }, [getClip, project.modifiedAt, selectedClipIds]);

  // Get selected clip (check regular clips, text clips, and shape clips)
  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) {
      return {
        id: textClip.id,
        mediaId: `text-${textClip.id}`,
        startTime: textClip.startTime,
        duration: textClip.duration,
        inPoint: 0,
        outPoint: textClip.duration,
        transform: textClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        text: textClip.text,
        trackId: textClip.trackId,
      };
    }
    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) {
      return {
        id: shapeClip.id,
        mediaId: `shape-${shapeClip.id}`,
        startTime: shapeClip.startTime,
        duration: shapeClip.duration,
        inPoint: 0,
        outPoint: shapeClip.duration,
        transform: shapeClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        shapeType: shapeClip.shapeType,
        trackId: shapeClip.trackId,
      };
    }
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) {
      return {
        id: svgClip.id,
        mediaId: `svg-${svgClip.id}`,
        startTime: svgClip.startTime,
        duration: svgClip.duration,
        inPoint: 0,
        outPoint: svgClip.duration,
        transform: svgClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        svgContent: svgClip.svgContent,
        trackId: svgClip.trackId,
      };
    }
    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) {
      return {
        id: stickerClip.id,
        mediaId: `sticker-${stickerClip.id}`,
        startTime: stickerClip.startTime,
        duration: stickerClip.duration,
        inPoint: 0,
        outPoint: stickerClip.duration,
        transform: stickerClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        imageUrl: stickerClip.imageUrl,
        trackId: stickerClip.trackId,
      };
    }
    return getClip(clipId) ?? null;
  }, [
    selectedClipIds,
    getClip,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  // Force re-render trigger - increment to force recalculation of engine values
  const [updateCounter, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // Get current values from engines - recalculate when updateCounter changes
  const clipId = selectedClip?.id || "";

  const chromaKeySettings = useMemo(() => {
    return clipId ? chromaKeyEngine.getSettings(clipId) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, updateCounter]);

  // Get updateClipTransform from store
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );

  // Transform handlers
  const handleTransformChange = useCallback(
    (changes: Partial<Transform>) => {
      if (!selectedClip) return;
      const titleEngine = getTitleEngine();
      const graphicsEngine = getGraphicsEngine();
      if (titleEngine?.getTextClip(selectedClip.id)) {
        updateTextTransform(selectedClip.id, changes);
        return;
      }
      if (
        graphicsEngine?.getShapeClip(selectedClip.id) ||
        graphicsEngine?.getSVGClip(selectedClip.id) ||
        graphicsEngine?.getStickerClip(selectedClip.id)
      ) {
        updateShapeTransform(selectedClip.id, changes);
        return;
      }
      void updateClipTransform(selectedClip.id, changes);
    },
    [
      getGraphicsEngine,
      getTitleEngine,
      selectedClip,
      updateClipTransform,
      updateShapeTransform,
      updateTextTransform,
    ],
  );

  // Chroma Key handlers using ChromaKeyEngine
  const handleChromaKeyToggle = useCallback(
    (enabled: boolean) => {
      if (!selectedClip) return;
      if (enabled) {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
      } else {
        chromaKeyEngine.disableChromaKey(selectedClip.id);
      }
      forceUpdate();
    },
    [selectedClip],
  );

  const handleKeyColorChange = useCallback(
    (hexColor: string) => {
      if (!selectedClip) return;
      const hex = hexColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      chromaKeyEngine.setKeyColor(selectedClip.id, { r, g, b });
      forceUpdate();
    },
    [selectedClip],
  );

  const handleToleranceChange = useCallback(
    (tolerance: number) => {
      if (!selectedClip) return;
      chromaKeyEngine.setTolerance(selectedClip.id, tolerance / 100);
      forceUpdate();
    },
    [selectedClip],
  );

  const {
    addVideoEffect,
    updateVideoEffect,
    getAudioEffects,
    updateAudioEffect,
    toggleAudioEffect,
  } = useProjectStore();

  const [isEnhancingAudio, setIsEnhancingAudio] = useState(false);
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  const isApplyingSelectedClipEffect =
    effectApplicationClipId !== null && effectApplicationClipId === selectedClip?.id;

  const waitForEffectApplicationPaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
    [],
  );

  const applyClipEffectWithPlaybackLock = useCallback(
    async (
      clipId: string,
      label: string,
      apply: () => void | Promise<void>,
    ) => {
      pausePlayback();
      lockPlayback(label);
      startEffectApplication(clipId, label);

      try {
        await waitForEffectApplicationPaint();
        await apply();
        window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
        await waitForEffectApplicationPaint();
      } finally {
        finishEffectApplication();
        unlockPlayback();
      }
    },
    [
      finishEffectApplication,
      lockPlayback,
      pausePlayback,
      startEffectApplication,
      unlockPlayback,
      waitForEffectApplicationPaint,
    ],
  );

  const handleRemoveBackground = useCallback(() => {
    if (!selectedClip) return;
    void applyClipEffectWithPlaybackLock(
      selectedClip.id,
      "正在移除背景",
      () => {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
        chromaKeyEngine.setKeyColor(selectedClip.id, { r: 0, g: 1, b: 0 });
        chromaKeyEngine.setTolerance(selectedClip.id, 0.35);
        forceUpdate();
      },
    );
  }, [applyClipEffectWithPlaybackLock, forceUpdate, selectedClip]);

  const handleEnhanceAudio = useCallback(async () => {
    if (!selectedClip) return;
    setIsEnhancingAudio(true);
    try {
      await applyClipEffectWithPlaybackLock(
        selectedClip.id,
        "正在清理音频",
        async () => {
          await initializeAudioBridgeEffects();
          const bridge = getAudioBridgeEffects();
          const noiseCleanupConfig = {
            ...DEFAULT_NOISE_REDUCTION,
            ...getNoiseReductionPreset("speech").config,
          };

          const existingNoiseReduction = getAudioEffects(selectedClip.id).find(
            (effect) => effect.type === "noiseReduction",
          );

          if (existingNoiseReduction) {
            await updateAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              noiseCleanupConfig as unknown as Record<string, unknown>,
            );
            await toggleAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              true,
            );
          } else {
            const result = bridge.applyNoiseReduction(
              selectedClip.id,
              noiseCleanupConfig,
            );

            if (!result.success) {
              throw new Error(result.error ?? "Failed to apply noise cleanup");
            }
          }

          setAudioEnhanced(true);
          setTimeout(() => setAudioEnhanced(false), 2000);
          toast.success(
            "音频降噪已应用",
            "可在背景降噪中微调或切换预设。",
          );

          forceUpdate();
        },
      );
    } catch (error) {
      console.error("Failed to enhance audio:", error);
      toast.error(
        "音频清理失败",
        error instanceof Error
          ? error.message
          : "无法对该片段应用音频降噪。",
      );
    } finally {
      setIsEnhancingAudio(false);
    }
  }, [
    applyClipEffectWithPlaybackLock,
    selectedClip,
    forceUpdate,
    getAudioEffects,
    toggleAudioEffect,
    updateAudioEffect,
  ]);

  const handleAutoColor = useCallback(async () => {
    if (!selectedClip) return;
    await applyClipEffectWithPlaybackLock(
      selectedClip.id,
      "正在自动调色",
      async () => {
        const satEffect = await addVideoEffect(selectedClip.id, "saturation");
        const contEffect = await addVideoEffect(selectedClip.id, "contrast");
        const brightEffect = await addVideoEffect(
          selectedClip.id,
          "brightness",
        );
        if (satEffect) {
          await updateVideoEffect(selectedClip.id, satEffect.id, {
            value: 1.15,
          });
        }
        if (contEffect) {
          await updateVideoEffect(selectedClip.id, contEffect.id, {
            value: 1.1,
          });
        }
        if (brightEffect) {
          await updateVideoEffect(selectedClip.id, brightEffect.id, {
            value: 5,
          });
        }
      },
    );
  }, [
    addVideoEffect,
    applyClipEffectWithPlaybackLock,
    selectedClip,
    updateVideoEffect,
  ]);

  const handleSRTImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const srtContent = await file.text();
        const result = await importSRT(srtContent, {
          sourceClipId: selectedTimelineClip?.id,
          maxWordsPerLine: captionWordsPerLine,
        });

        if (result.success) {
          if (result.errors.length > 0) {
            toast.warning(
              "字幕导入完成，但有警告",
              `已跳过 ${result.errors.length} 个字幕片段。`,
            );
          } else {
            toast.success(
              "字幕已导入",
              "每条字幕已作为可编辑文字片段添加到字幕轨道。",
            );
          }
        } else {
          toast.error("字幕导入失败", result.errors[0] || "未找到有效字幕。");
        }
      } catch {
        toast.error("字幕导入失败", "无法读取所选字幕文件。");
      } finally {
        event.target.value = "";
      }
    },
    [captionWordsPerLine, importSRT, selectedTimelineClip?.id],
  );

  const handleSubtitleFontUpload = useCallback(
    async (file: File) => {
      if (!file || !selectedSubtitle) return;

      const result = await registerCustomFont(file);
      if (!result.success) {
        toast.error("字体上传失败", result.error ?? "未知错误。");
      } else {
        updateSubtitle(selectedSubtitle.id, {
          style: {
            ...(selectedSubtitle.style || {}),
            fontFamily: result.fontFamily,
          } as typeof selectedSubtitle.style,
        });
        toast.success("自定义字体已上传", `${result.fontFamily} 已可使用。`);
      }
    },
    [selectedSubtitle, updateSubtitle],
  );

  // Default transform
  const defaultTransform: Transform = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
    borderRadius: 0,
  };
  const transform = selectedClip?.transform || defaultTransform;

  // Derive UI state from engines
  const chromaKeyEnabled = chromaKeySettings?.enabled || false;
  const keyColor = chromaKeySettings
    ? `#${Math.round(chromaKeySettings.keyColor.r * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.g * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.b * 255)
        .toString(16)
        .padStart(2, "0")}`
    : "#00ff00";
  const tolerance = (chromaKeySettings?.tolerance || 0.3) * 100;

  /** Detect clip type from the selected item itself, not its owning track. */
  const clipType = useMemo(() => {
    if (!selectedClip) return null;

    // Check mediaId prefix first for text, shape, and SVG clips (they may not be in timeline tracks)
    if (selectedClip.mediaId.startsWith("text-")) {
      return "text";
    }

    if (selectedClip.mediaId.startsWith("shape-")) {
      return "shape";
    }

    if (selectedClip.mediaId.startsWith("svg-")) {
      return "svg";
    }

    if (
      selectedClip.mediaId.startsWith("sticker-") ||
      selectedClip.mediaId.startsWith("emoji-")
    ) {
      return "sticker";
    }

    const mediaItem = project.mediaLibrary.items.find(
      (item) => item.id === selectedClip.mediaId,
    );

    if (mediaItem?.type === "audio") {
      return "audio";
    }

    if (mediaItem?.type === "image") {
      return "image";
    }

    return "video";
  }, [selectedClip, project.mediaLibrary.items]);

  /**
   * Determine which sections to show based on clip type
   */
  const showVideoEffects =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";
  const showColorGrading = clipType === "video" || clipType === "image";
  const selectedMediaCapabilities = getMediaItemCapabilities(
    selectedTimelineClip
      ? project.mediaLibrary.items.find(
          (item) => item.id === selectedTimelineClip.mediaId,
        )
      : undefined,
  );
  const showAudioEffects =
    clipType === "audio" || selectedMediaCapabilities.audio;
  const showTextSection = clipType === "text";
  const showShapeSection = clipType === "shape";
  const showSVGSection = clipType === "svg";
  const selectedNoiseReductionEffect = selectedTimelineClip?.audioEffects?.find(
    (effect) => effect.type === "noiseReduction",
  );
  const noiseReductionSectionTitle = selectedNoiseReductionEffect
    ? selectedNoiseReductionEffect.enabled
      ? "背景降噪（已启用）"
      : "背景降噪（已配置）"
    : "背景降噪";
  const appliedEditingTemplates =
    selectedTimelineClip?.metadata?.appliedTemplates || [];
  const handleRecipeControlChange = useCallback(
    (
      applicationId: string,
      controlId: string,
      value: EditingTemplatePrimitive,
    ) => {
      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: {
          ...(current[applicationId] || {}),
          [controlId]: value,
        },
      }));
    },
    [],
  );
  const handleToggleRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template || !template.controls || template.controls.length === 0) {
        return;
      }

      setExpandedRecipeApplicationId((current) =>
        current === applicationId ? null : applicationId,
      );
      setRecipeControlValues((current) =>
        current[applicationId]
          ? current
          : {
              ...current,
              [applicationId]: mergeEditingTemplateControlValues(
                template,
                controlValues,
              ),
            },
      );
    },
    [getEditingTemplate],
  );
  const handleResetRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template) {
        return;
      }

      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: mergeEditingTemplateControlValues(template, controlValues),
      }));
    },
    [getEditingTemplate],
  );
  const handleUpdateRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      if (!selectedTimelineClip) {
        return;
      }

      const template = getEditingTemplate(templateId);
      if (!template) {
        toast.error("配方不可用", "此配方定义已不可用。");
        return;
      }

      const nextControlValues =
        recipeControlValues[applicationId] ||
        mergeEditingTemplateControlValues(template, controlValues);
      const updated = updateEditingTemplateApplication(
        selectedTimelineClip.id,
        applicationId,
        nextControlValues,
      );

      if (!updated) {
        toast.error("无法更新配方", "配方控件无法保存到此片段。");
        return;
      }

      toast.success("配方已更新", `${template.name} 已更新到此片段。`);
    },
    [
      getEditingTemplate,
      recipeControlValues,
      selectedTimelineClip,
      updateEditingTemplateApplication,
    ],
  );
  const showVideoControls = clipType === "video" || clipType === "image";
  const showTransformControls =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  const tabIds = useMemo(
    () => getTabIdsForClipType(clipType as InspectorClipType | null),
    [clipType],
  );

  return (
    <div
      data-tour="inspector"
      className="w-full min-w-0 bg-bg-1 flex flex-col h-full overflow-hidden"
    >
      {selectedClip && tabIds.length > 0 && (
        <InspectorClipHeader
          name={
            project.mediaLibrary.items.find(
              (m) => m.id === selectedClip.mediaId,
            )?.name ??
            (clipType
              ? CLIP_TYPE_LABELS[clipType]
              : "片段")
          }
          durationSeconds={selectedClip.duration}
          typeLabel={clipType ? CLIP_TYPE_LABELS[clipType] : "片段"}
        />
      )}

      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
      <div className="py-[18px] px-5">
        {selectedClipIds.length > 1 ? (
          <MultiClipInspector clipIds={selectedClipIds} />
        ) : selectedClip ? (
          <InspectorTabErrorBoundary key={clipId}>
            <div className="space-y-4">
              {tabIds.includes("transform") && (
                <TransformTab
                  clipId={clipId}
                  clipType={clipType}
                  selectedClip={selectedClip}
                  showTransformControls={showTransformControls}
                  showVideoControls={showVideoControls}
                  transform={transform}
                  canvasWidth={project.settings.width}
                  canvasHeight={project.settings.height}
                  handleTransformChange={handleTransformChange}
                />
              )}

              {tabIds.includes("style") && (
                <StyleTab
                  clipId={clipId}
                  showTextSection={showTextSection}
                  showShapeSection={showShapeSection}
                  showSVGSection={showSVGSection}
                />
              )}

              {tabIds.includes("color") && (
                <ColorTab clipId={clipId} showColorGrading={showColorGrading} />
              )}

              {tabIds.includes("effects") && (
                <EffectsTab
                  clipId={clipId}
                  clipType={clipType}
                  selectedClip={selectedClip}
                  selectedTimelineClip={selectedTimelineClip}
                  showVideoControls={showVideoControls}
                  showVideoEffects={showVideoEffects}
                  showTextSection={showTextSection}
                  appliedEditingTemplates={appliedEditingTemplates}
                  getEditingTemplate={getEditingTemplate}
                  removeEditingTemplateApplication={removeEditingTemplateApplication}
                  expandedRecipeApplicationId={expandedRecipeApplicationId}
                  setExpandedRecipeApplicationId={setExpandedRecipeApplicationId}
                  recipeControlValues={recipeControlValues}
                  setRecipeControlValues={setRecipeControlValues}
                  handleRecipeControlChange={handleRecipeControlChange}
                  handleToggleRecipeControls={handleToggleRecipeControls}
                  handleResetRecipeControls={handleResetRecipeControls}
                  handleUpdateRecipeControls={handleUpdateRecipeControls}
                  chromaKeyEnabled={chromaKeyEnabled}
                  keyColor={keyColor}
                  tolerance={tolerance}
                  handleChromaKeyToggle={handleChromaKeyToggle}
                  handleKeyColorChange={handleKeyColorChange}
                  handleToleranceChange={handleToleranceChange}
                />
              )}

              {tabIds.includes("audio") && (
                <AudioTab
                  clipId={clipId}
                  clipType={clipType}
                  showAudioEffects={showAudioEffects}
                  noiseReductionSectionTitle={noiseReductionSectionTitle}
                  selectedNoiseReductionEffect={selectedNoiseReductionEffect}
                />
              )}

              {tabIds.includes("speed") && (
                <SpeedTab
                  showVideoControls={showVideoControls}
                  selectedClip={selectedClip}
                />
              )}

              {tabIds.includes("animate") && (
                <AnimateTab
                  clipId={clipId}
                  clipType={clipType}
                  showTextSection={showTextSection}
                />
              )}

              {tabIds.includes("ai") && (
                <AiTab
                  clipId={clipId}
                  clipType={clipType}
                  showVideoControls={showVideoControls}
                  showAudioEffects={showAudioEffects}
                  showVideoEffects={showVideoEffects}
                  handleSRTImport={handleSRTImport}
                  srtInputRef={srtInputRef}
                  handleRemoveBackground={handleRemoveBackground}
                  handleEnhanceAudio={handleEnhanceAudio}
                  handleAutoColor={handleAutoColor}
                  isEnhancingAudio={isEnhancingAudio}
                  audioEnhanced={audioEnhanced}
                  isApplyingSelectedClipEffect={isApplyingSelectedClipEffect}
                  captionWordsPerLine={captionWordsPerLine}
                  onCaptionWordsPerLineChange={setCaptionWordsPerLine}
                />
              )}
            </div>
          </InspectorTabErrorBoundary>
        ) : selectedTransition && transitionClipA ? (
          <div className="space-y-3">
            <Card variant="green" padding={3} className="rounded-lg border border-accent/30 bg-accent-soft">
              <div className="flex items-center gap-2">
                <Shuffle size={14} className="text-accent" aria-hidden />
                <Text type="supporting" weight="bold" className="text-fg">
                  {selectedTransition.edge === "in"
                    ? "片头转场"
                    : selectedTransition.edge === "out"
                      ? "片尾转场"
                      : "转场"}
                </Text>
              </div>
              <Text type="supporting" display="block" className="mt-1 text-[10px] text-fg-3">
                {selectedTransition.edge === "in"
                  ? "从项目背景进入此片段"
                  : selectedTransition.edge === "out"
                    ? "从此片段进入项目背景"
                    : "位于两个片段之间，居中于剪辑点"}
              </Text>
            </Card>
            <TransitionInspector
              clipA={transitionClipA}
              clipB={transitionClipB ?? undefined}
              edge={selectedTransition.edge}
              transition={selectedTransition}
              onTransitionUpdate={(id, updates) => {
                void updateClipTransition(id, updates);
              }}
              onTransitionRemove={(id) => {
                void removeClipTransition(id);
                clearSelection();
              }}
            />
          </div>
        ) : selectedSubtitle ? (
          <>
            {/* Subtitle Info */}
            <Card variant="green" padding={3} className="mb-4 rounded-lg border border-accent/30 bg-accent-soft">
              <div className="flex items-center gap-2 mb-1">
                <Captions size={14} className="text-accent" aria-hidden />
                <Text type="supporting" weight="bold" className="text-accent">
                  字幕
                </Text>
              </div>
              <Text type="supporting" display="block" className="text-[10px] text-fg-3">
                {selectedSubtitle.startTime.toFixed(2)}s -{" "}
                {selectedSubtitle.endTime.toFixed(2)}s
              </Text>
            </Card>

            {/* Subtitle Text Editor */}
            <Section title="文字内容">
              <div className="space-y-3">
                <ToolcraftTextAreaControl
                  label="字幕文字"
                  isLabelHidden
                  value={selectedSubtitle.text}
                  onChange={(text) =>
                    updateSubtitle(selectedSubtitle.id, {
                      text,
                    })
                  }
                  rows={4}
                  placeholder="输入字幕文字..."
                  width="100%"
                />
              </div>
            </Section>

            {/* Subtitle Timing */}
            <Section title="时间">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    开始时间
                  </Text>
                  <ToolcraftNumberInputControl
                    label="开始时间"
                    isLabelHidden
                    step={0.1}
                    value={selectedSubtitle.startTime}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        startTime: value || 0,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    结束时间
                  </Text>
                  <ToolcraftNumberInputControl
                    label="结束时间"
                    isLabelHidden
                    step={0.1}
                    value={selectedSubtitle.endTime}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        endTime: value || 0,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Position */}
            <Section title="位置">
              <div className="grid grid-cols-3 gap-2">
                {(["top", "center", "bottom"] as const).map((pos) => (
                  <SelectableCard
                    key={pos}
                    label={SUBTITLE_POSITION_LABELS[pos]}
                    isSelected={(selectedSubtitle.style?.position || "bottom") === pos}
                    onChange={() =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          position: pos,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    padding={2}
                    variant={(selectedSubtitle.style?.position || "bottom") === pos ? "green" : "muted"}
                    className="text-center capitalize"
                  >
                    {SUBTITLE_POSITION_LABELS[pos]}
                  </SelectableCard>
                ))}
              </div>
            </Section>

            {/* Subtitle Animation Style */}
            <Section title="动画">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    样式
                  </Text>
                  <Selector
                    label="动画样式"
                    isLabelHidden
                    value={selectedSubtitle.animationStyle || "none"}
                    onChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        animationStyle: v as CaptionAnimationStyle,
                      })
                    }
                    options={CAPTION_ANIMATION_STYLES.map((style) => ({
                      value: style,
                      label: CAPTION_ANIMATION_LABELS[style],
                    }))}
                    size="sm"
                    width={140}
                  />
                </div>
                <Text type="supporting" color="secondary" display="block" className="text-[9px]">
                  {selectedSubtitle.animationStyle === "karaoke" &&
                    "单词随朗读逐渐填充颜色"}
                  {selectedSubtitle.animationStyle === "word-highlight" &&
                    "当前单词高亮并放大"}
                  {selectedSubtitle.animationStyle === "word-by-word" &&
                    "逐个显示单词"}
                  {selectedSubtitle.animationStyle === "bounce" &&
                    "单词出现时弹跳进入"}
                  {selectedSubtitle.animationStyle === "typewriter" &&
                    "单词像打字一样逐步出现"}
                  {(!selectedSubtitle.animationStyle ||
                    selectedSubtitle.animationStyle === "none") &&
                    "静态文字，无动画"}
                </Text>
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  !selectedSubtitle.words?.length && (
                    <Card variant="muted" padding={2} className="bg-amber-400/10">
                      <Text type="supporting" display="block" className="text-[9px] text-amber-400">
                      没有逐词时间信息。请重新生成字幕以启用动画。
                      </Text>
                    </Card>
                  )}
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  selectedSubtitle.animationStyle !== "typewriter" &&
                  selectedSubtitle.animationStyle !== "word-by-word" && (
                    <div className="pt-2 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <Text type="supporting" color="secondary" className="text-[10px]">
                          高亮颜色
                        </Text>
                        <div className="flex items-center gap-2">
                          <ColorSelector
                            value={
                              selectedSubtitle.style?.highlightColor ||
                              "#ffff00"
                            }
                            label="选择高亮颜色"
                            onChange={(highlightColor) =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {[
                          "#ffff00",
                          "#00ff00",
                          "#ff6b6b",
                          "#4ecdc4",
                          "#ff9f43",
                          "#a55eea",
                        ].map((color) => (
                          <Button
                            key={color}
                            label={color}
                            onClick={() =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor: color,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                            variant="ghost"
                            size="sm"
                            className={`h-6 w-6 rounded border-2 p-0 transition-transform hover:scale-110 ${
                              (selectedSubtitle.style?.highlightColor ||
                                "#ffff00") === color
                                ? "border-white"
                                : "border-transparent"
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </Section>

            {/* Subtitle Font Settings */}
            <Section title="字体">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    字体系列
                  </Text>
                  <Selector
                    label="字体系列"
                    isLabelHidden
                    value={selectedSubtitle.style?.fontFamily || "Inter"}
                    onChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontFamily: v,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    options={[
                      ...Object.entries(FONT_CATEGORIES).flatMap(([category, fonts]) =>
                        fonts.map((font) => ({
                          value: font,
                          label: `${font}（${FONT_CATEGORY_LABELS[category] ?? category}）`,
                        })),
                      ),
                      ...customFonts.map((font) => ({
                        value: font,
                        label: `${font}（自定义）`,
                      })),
                    ]}
                    size="sm"
                    width={160}
                  />
                </div>
                <FileInput
                  label="上传自定义字体"
                  isLabelHidden
                  value={null}
                  onChange={(picked) => {
                    if (picked instanceof File) {
                      void handleSubtitleFontUpload(picked);
                    }
                  }}
                  accept={FONT_FILE_ACCEPT}
                  mode="input"
                  placeholder="上传自定义字体"
                  width="100%"
                />
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    字体大小
                  </Text>
                  <ToolcraftNumberInputControl
                    label="字体大小"
                    isLabelHidden
                    min={12}
                    max={72}
                    value={selectedSubtitle.style?.fontSize || 24}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontSize: value || 24,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Colors */}
            <Section title="颜色">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    文字颜色
                  </Text>
                  <div className="flex items-center gap-2">
                    <ColorSelector
                      value={selectedSubtitle.style?.color || "#ffffff"}
                      label="选择字幕文字颜色"
                      onChange={(color) =>
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            color,
                          } as typeof selectedSubtitle.style,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    背景
                  </Text>
                  <div className="flex items-center gap-2">
                    <ColorSelector
                      value={cssColorToHex(
                        selectedSubtitle.style?.backgroundColor,
                        "#000000",
                      )}
                      label="选择字幕背景颜色"
                      onChange={(hex) => {
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: rgbaFromHex(
                              hex,
                              cssColorAlpha(
                                selectedSubtitle.style?.backgroundColor,
                              ),
                            ),
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                    />
                    <Selector
                      label="背景不透明度"
                      isLabelHidden
                      value={
                        cssColorAlpha(selectedSubtitle.style?.backgroundColor)
                      }
                      onChange={(v) => {
                        const nextAlpha = v as "0" | "0.5" | "0.7" | "1";
                        const newBg = rgbaFromHex(
                          cssColorToHex(
                            selectedSubtitle.style?.backgroundColor,
                            "#000000",
                          ),
                          nextAlpha,
                        );
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: newBg,
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                      options={[
                        { value: "0", label: "无" },
                        { value: "0.5", label: "50%" },
                        { value: "0.7", label: "70%" },
                        { value: "1", label: "100%" },
                      ]}
                      size="sm"
                      width={80}
                    />
                  </div>
                </div>
              </div>
            </Section>

            {/* Delete Subtitle */}
            <div className="pt-4 border-t border-border">
              <Button
                label="删除字幕"
                onClick={() => {
                  const { removeSubtitle } = useProjectStore.getState();
                  removeSubtitle(selectedSubtitle.id);
                }}
                variant="destructive"
                className="w-full border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30"
              />
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      </div>
    </div>
  );
};

export default InspectorPanel;
