import React from "react";
import { Zap, Loader2, Upload } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { AutoReframeSection } from "../";
import { AutoCaptionPanel } from "../AutoCaptionPanel";
import { CaptionEditorPanel } from "../CaptionEditorPanel";
import { AutoEditPanel } from "../../panels/AutoEditPanel";
import { HighlightExtractorPanel } from "../../panels/HighlightExtractorPanel";
import { InspectorSection } from "../shell/InspectorSection";

export interface AiTabProps {
  clipId: string;
  clipType: string | null;
  showVideoControls: boolean;
  showAudioEffects: boolean;
  showVideoEffects: boolean;
  handleSRTImport: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  srtInputRef: React.RefObject<HTMLInputElement | null>;
  handleRemoveBackground: () => void;
  handleEnhanceAudio: () => Promise<void>;
  handleAutoColor: () => Promise<void>;
  isEnhancingAudio: boolean;
  audioEnhanced: boolean;
  isApplyingSelectedClipEffect: boolean;
  captionWordsPerLine: number;
  onCaptionWordsPerLineChange: (value: number) => void;
}

export const AiTab: React.FC<AiTabProps> = ({
  clipId,
  clipType,
  showVideoControls,
  showAudioEffects,
  showVideoEffects,
  handleSRTImport,
  srtInputRef,
  handleRemoveBackground,
  handleEnhanceAudio,
  handleAutoColor,
  isEnhancingAudio,
  audioEnhanced,
  isApplyingSelectedClipEffect,
  captionWordsPerLine,
  onCaptionWordsPerLineChange,
}) => {
  return (
    <>
      {clipType === "video" && (
        <>
          <InspectorSection
            title="本地自动字幕"
            sectionId="auto-captions"
            defaultOpen={false}
          >
            <div className="space-y-3">
              <AutoCaptionPanel
                clipId={clipId}
                maxWordsPerLine={captionWordsPerLine}
              />
              <FileInput
                ref={srtInputRef}
                label="导入 SRT 或 VTT 文件"
                isLabelHidden
                value={null}
                accept=".srt,.vtt,text/srt,text/vtt,text/plain"
                onChange={(files) => {
                  const file = Array.isArray(files) ? files[0] : files;
                  if (!file) return;
                  void handleSRTImport({
                    target: { files: [file] },
                  } as unknown as React.ChangeEvent<HTMLInputElement>);
                }}
                className="hidden"
              />
              <Button
                label="作为文字导入 SRT / VTT"
                onClick={() => srtInputRef.current?.click()}
                variant="secondary"
                size="sm"
                icon={<Upload size={13} aria-hidden />}
                className="w-full justify-center"
              />
            </div>
          </InspectorSection>
        </>
      )}

      {clipType === "video" && (
        <InspectorSection
          title="可编辑字幕"
          sectionId="editable-captions"
          defaultOpen={false}
        >
          <CaptionEditorPanel
            maxWordsPerLine={captionWordsPerLine}
            onMaxWordsPerLineChange={onCaptionWordsPerLineChange}
          />
        </InspectorSection>
      )}

      {clipType === "video" && (
        <InspectorSection
          title="自动重构图"
          sectionId="auto-reframe"
          defaultOpen={false}
        >
          <AutoReframeSection clipId={clipId} />
        </InspectorSection>
      )}

      {showAudioEffects && (
        <InspectorSection
          title="节拍同步自动剪辑"
          sectionId="auto-edit"
          defaultOpen={false}
        >
          <AutoEditPanel onClose={() => {}} />
        </InspectorSection>
      )}

      {showAudioEffects && (
        <InspectorSection
          title="本地精彩片段"
          sectionId="ai-highlights"
          defaultOpen={false}
        >
          <HighlightExtractorPanel clipId={clipId} />
        </InspectorSection>
      )}

      {(showVideoControls || showAudioEffects || showVideoEffects) && (
        <Card
          variant="green"
          padding={4}
          className="relative overflow-hidden border border-primary/30 bg-primary/5"
        >
          <div className="flex items-center gap-2 text-primary mb-3">
            <Zap size={14} />
            <Text type="supporting" color="active" className="text-xs font-bold">
              快速操作
            </Text>
          </div>
          <div className="space-y-2">
            {showVideoControls && (
              <Button
                label="移除背景"
                onClick={handleRemoveBackground}
                isDisabled={isApplyingSelectedClipEffect}
                variant="secondary"
                size="sm"
                className={`w-full justify-center ${
                  isApplyingSelectedClipEffect
                    ? "bg-bg-2 border-border text-fg-3"
                    : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`}
              />
            )}
            {showAudioEffects && (
              <Button
                label={
                  isEnhancingAudio
                    ? "清理中..."
                    : audioEnhanced
                      ? "已降噪"
                      : "快速对白清理"
                }
                onClick={handleEnhanceAudio}
                isDisabled={isEnhancingAudio || isApplyingSelectedClipEffect}
                variant="secondary"
                size="sm"
                icon={isEnhancingAudio ? <Loader2 size={12} className="animate-spin" aria-hidden /> : undefined}
                className={`w-full justify-center ${
                  audioEnhanced
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : isEnhancingAudio || isApplyingSelectedClipEffect
                      ? "bg-bg-2 border-border text-fg-3"
                      : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`}
              />
            )}
            {showVideoEffects && (
              <Button
                label={isApplyingSelectedClipEffect ? "应用中..." : "自动调色"}
                onClick={handleAutoColor}
                isDisabled={isApplyingSelectedClipEffect}
                variant="secondary"
                size="sm"
                className={`w-full justify-center ${
                  isApplyingSelectedClipEffect
                    ? "bg-bg-2 border-border text-fg-3"
                    : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`}
              />
            )}
          </div>
        </Card>
      )}
    </>
  );
};
