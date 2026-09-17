import React, { useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "@/icons/lucide-compat";
import type { Transform } from "@openreel/core";

interface AlignmentSectionProps {
  clipType: string | null;
  transform: Transform;
  canvasWidth: number;
  canvasHeight: number;
  onTransformChange: (changes: Partial<Transform>) => void;
}

export const AlignmentSection: React.FC<AlignmentSectionProps> = ({
  clipType,
  transform,
  canvasWidth,
  canvasHeight,
  onTransformChange,
}) => {
  const usesNormalizedPosition =
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  const handleAlign = useCallback(
    (axis: "x" | "y", normalizedValue: 0 | 0.5 | 1) => {
      const dimension = axis === "x" ? canvasWidth : canvasHeight;
      const value = usesNormalizedPosition
        ? normalizedValue
        : (normalizedValue - 0.5) * dimension;
      onTransformChange({
        position: { ...transform.position, [axis]: value },
      });
    },
    [
      canvasHeight,
      canvasWidth,
      onTransformChange,
      transform.position,
      usesNormalizedPosition,
    ],
  );

  const handleCenterBoth = useCallback(() => {
    onTransformChange({
      position: usesNormalizedPosition ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 },
    });
  }, [onTransformChange, usesNormalizedPosition]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Text type="supporting" color="secondary" className="w-16">
          水平
        </Text>
        <div className="flex gap-1">
          <IconButton
            label="左对齐"
            icon={<AlignHorizontalJustifyStart size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 0)}
          />
          <IconButton
            label="水平居中"
            icon={<AlignHorizontalJustifyCenter size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 0.5)}
          />
          <IconButton
            label="右对齐"
            icon={<AlignHorizontalJustifyEnd size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 1)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Text type="supporting" color="secondary" className="w-16">
          垂直
        </Text>
        <div className="flex gap-1">
          <IconButton
            label="顶部对齐"
            icon={<AlignVerticalJustifyStart size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 0)}
          />
          <IconButton
            label="垂直居中"
            icon={<AlignVerticalJustifyCenter size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 0.5)}
          />
          <IconButton
            label="底部对齐"
            icon={<AlignVerticalJustifyEnd size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 1)}
          />
        </div>
      </div>
      <Button
        label="在画布中居中"
        variant="secondary"
        size="sm"
        onClick={handleCenterBoth}
        className="w-full"
      />
      <Text type="supporting" color="secondary" className="block text-center text-[9px] text-fg-muted">
        {usesNormalizedPosition
          ? "按画布坐标对齐叠加内容锚点"
          : "按相对中心的像素偏移对齐素材锚点"}
      </Text>
    </div>
  );
};
