import React from "react";
import { Maximize2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

interface AspectRatioMatchDialogProps {
  isOpen: boolean;
  videoWidth: number;
  videoHeight: number;
  currentWidth: number;
  currentHeight: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AspectRatioMatchDialog: React.FC<AspectRatioMatchDialogProps> = ({
  isOpen,
  videoWidth,
  videoHeight,
  currentWidth,
  currentHeight,
  onConfirm,
  onCancel,
}) => {
  const videoAspect = (videoWidth / videoHeight).toFixed(2);
  const currentAspect = (currentWidth / currentHeight).toFixed(2);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onCancel()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="匹配视频尺寸？"
            subtitle="正在添加的视频尺寸与当前项目设置不同。"
            onOpenChange={(open) => !open && onCancel()}
            startContent={<Maximize2 size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <div className="space-y-4">
          <div className="space-y-3">
            <Card variant="muted" padding={3}>
              <div>
                <Text type="supporting" color="secondary" display="block" className="mb-1">
                  视频尺寸
                </Text>
                <Text type="label" weight="bold" display="block">
                  {videoWidth} x {videoHeight}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-0.5">
                  宽高比：{videoAspect}
                </Text>
              </div>
            </Card>

            <Card variant="default" padding={3} className="border border-border/50">
              <div>
                <Text type="supporting" color="secondary" display="block" className="mb-1">
                  当前项目
                </Text>
                <Text type="label" weight="bold" display="block">
                  {currentWidth} x {currentHeight}
                </Text>
                <Text type="supporting" color="secondary" display="block" className="mt-0.5">
                  宽高比：{currentAspect}
                </Text>
              </div>
            </Card>
          </div>

          <Text type="supporting" color="secondary" display="block">
            将项目尺寸匹配为视频尺寸以获得整洁的画面，或保留当前画布。视频会以原始尺寸放置，之后仍可自由调整大小。
          </Text>
        </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex gap-3">
              <Button
                label="保留当前设置"
                variant="secondary"
                className="flex-1"
                onClick={onCancel}
              />
              <Button
                label="匹配视频尺寸"
                variant="primary"
                className="flex-1"
                onClick={onConfirm}
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
