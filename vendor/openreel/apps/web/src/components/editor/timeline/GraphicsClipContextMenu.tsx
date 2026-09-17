import React from "react";
import type { ToolcraftContextMenuOption as ContextMenuOption } from "@openreel/ui";
import {
  Layers,
  Trash2,
  Shapes,
  Type,
  ListChecks,
} from "@/icons/lucide-compat";
import type { ShapeClip, SVGClip, StickerClip, TextClip } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineTrackSelection } from "../../../utils/timeline-item-actions";

type GraphicsClipType = ShapeClip | SVGClip | StickerClip | TextClip;

interface GraphicsClipContextMenuProps {
  clip: GraphicsClipType;
  clipType: "shape" | "svg" | "sticker" | "emoji" | "text";
  onClose?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

export function useGraphicsClipContextMenuItems({
  clip,
  clipType,
  onClose,
  onDelete,
  onDuplicate,
}: GraphicsClipContextMenuProps): ContextMenuOption[] {
  const {
    deleteShapeClip,
    deleteSVGClip,
    deleteStickerClip,
    deleteTextClip,
  } = useProjectStore();
  const selectMultiple = useUIStore((state) => state.selectMultiple);
  const project = useProjectStore((state) => state.project);
  const isCaption =
    clipType === "text" &&
    (project.timeline.tracks.some(
      (track) =>
        track.id === clip.trackId &&
        (track.role === "captions" ||
          track.name.trim().toLowerCase() === "captions"),
    ) ||
      ("metadata" in clip &&
        typeof clip.metadata?.captionSource === "string"));

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
    } else {
      switch (clipType) {
        case "shape":
          deleteShapeClip(clip.id);
          break;
        case "svg":
          deleteSVGClip(clip.id);
          break;
        case "sticker":
        case "emoji":
          deleteStickerClip(clip.id);
          break;
        case "text":
          deleteTextClip(clip.id);
          break;
      }
    }
    onClose?.();
  };

  const handleDuplicate = () => {
    onDuplicate?.();
    onClose?.();
  };

  const handleSelectTrackClips = () => {
    const project = useProjectStore.getState().getFullProject();
    selectMultiple(getTimelineTrackSelection(project, clip.trackId));
    onClose?.();
  };

  const getClipTypeLabel = () => {
    switch (clipType) {
      case "shape":
        return "形状";
      case "svg":
        return "SVG";
      case "sticker":
        return "贴纸";
      case "emoji":
        return "表情";
      case "text":
        return "文字";
      default:
        return "图形";
    }
  };

  const getClipTypeIcon = () => {
    switch (clipType) {
      case "text":
        return <Type size={14} className="text-amber-400" aria-hidden />;
      default:
        return <Shapes size={14} className="text-green-400" aria-hidden />;
    }
  };

  const items: ContextMenuOption[] = [
    {
      type: "section",
      title: `${getClipTypeLabel()}片段`,
      items: [
        {
          label: `${getClipTypeLabel()}片段`,
          icon: getClipTypeIcon(),
          isDisabled: true,
        },
      ],
    },
    { type: "divider" },
  ];

  if (onDuplicate) {
    items.push(
      {
        label: "创建副本",
        icon: <Layers size={14} aria-hidden />,
        onClick: handleDuplicate,
      },
      { type: "divider" },
    );
  }

  items.push(
    {
    label: isCaption ? "选择所有字幕" : "选择轨道上的所有片段",
      icon: <ListChecks size={14} aria-hidden />,
      onClick: handleSelectTrackClips,
    },
    { type: "divider" },
  );

  items.push({
    label: "删除",
    icon: <Trash2 size={14} aria-hidden />,
    onClick: handleDelete,
  });

  return items;
}

export const GraphicsClipContextMenu: React.FC<GraphicsClipContextMenuProps> = (props) => {
  useGraphicsClipContextMenuItems(props);
  return null;
};
