import React, { useCallback } from "react";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl as TextInput } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { EDITING_FRAME_RATE_OPTIONS } from "../editing-frame-rate";
import { getServiceDisplayLabel } from "./localization";

const ASPECT_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: "横屏 16:9（1080p）", width: 1920, height: 1080 },
  { label: "竖屏 9:16（TikTok/Reels）", width: 1080, height: 1920 },
  { label: "方形 1:1", width: 1080, height: 1080 },
  { label: "竖幅 4:5", width: 1080, height: 1350 },
  { label: "标准 4:3", width: 1440, height: 1080 },
  { label: "电影 21:9", width: 2560, height: 1080 },
  { label: "4K 横屏", width: 3840, height: 2160 },
];

const BACKGROUND_SWATCHES = [
  "#000000",
  "#FFFFFF",
  "#1E1E1E",
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#F59E0B",
  "#9333EA",
  "#DB2777",
  "#0EA5E9",
];

export const GeneralPanel: React.FC = () => {
  const {
    autoSave,
    autoSaveInterval,
    defaultTtsProvider,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
    setAutoSave,
    setAutoSaveInterval,
    setDefaultTtsProvider,
    setDefaultLlmProvider,
    setLlmBaseUrl,
    setLlmModel,
  } = useSettingsStore();

  const projectWidth = useProjectStore((s) => s.project.settings.width);
  const projectHeight = useProjectStore((s) => s.project.settings.height);
  const projectFrameRate = useProjectStore(
    (s) => s.project.settings.frameRate,
  );
  const updateProjectSettings = useProjectStore((s) => s.updateSettings);
  const backgroundFillMode = useProjectStore(
    (s) => s.project.timeline.backgroundFillMode,
  );
  const layoutBackgroundColor = useProjectStore(
    (s) => s.project.timeline.layoutBackgroundColor,
  );
  const setCanvasBackground = useProjectStore((s) => s.setCanvasBackground);

  const [draftWidth, setDraftWidth] = React.useState(String(projectWidth));
  const [draftHeight, setDraftHeight] = React.useState(String(projectHeight));

  React.useEffect(() => {
    setDraftWidth(String(projectWidth));
    setDraftHeight(String(projectHeight));
  }, [projectWidth, projectHeight]);

  const applyDimensions = useCallback(
    async (width: number, height: number) => {
      const w = Math.max(16, Math.min(7680, Math.round(width)));
      const h = Math.max(16, Math.min(7680, Math.round(height)));
      await updateProjectSettings({ width: w, height: h });
    },
    [updateProjectSettings],
  );

  const handleApplyCustom = useCallback(() => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyDimensions(w, h);
    }
  }, [draftWidth, draftHeight, applyDimensions]);

  const ttsProviders = SERVICE_REGISTRY.filter((s) => s.id === "elevenlabs");

  const llmProviders = SERVICE_REGISTRY.filter(
    (s) => s.id === "openai-compatible" || s.id === "anthropic-compatible",
  );

  return (
    <div className="space-y-6 pb-4">
      {/* Project Composition */}
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            项目画布
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            设置项目画布尺寸。选择 TikTok、Reels、YouTube 预设，或输入自定义数值。
          </Text>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ASPECT_PRESETS.map((preset) => {
            const isActive =
                preset.width === projectWidth && preset.height === projectHeight;
            return (
              <ClickableCard
                key={preset.label}
                label={preset.label}
                onClick={() => applyDimensions(preset.width, preset.height)}
                padding={3}
                variant={isActive ? "green" : "muted"}
                className={`text-left text-xs border ${
                  isActive
                    ? "border-primary bg-primary/10 text-text-primary"
                    : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary hover:border-primary/40"
                }`}
              >
                <Text type="supporting" color="inherit" className="font-medium">
                  {preset.label}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 text-[10px]">
                  {preset.width} × {preset.height}
                </Text>
              </ClickableCard>
            );
          })}
        </div>

        <div className="flex items-end gap-2">
          <ToolcraftNumberInputControl
            label="宽度"
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftWidth)) ? Number(draftWidth) : null}
            onChange={(value) => setDraftWidth(String(value))}
          />
          <ToolcraftNumberInputControl
            label="高度"
            size="md"
            width="100%"
            min={16}
            max={7680}
            value={Number.isFinite(Number(draftHeight)) ? Number(draftHeight) : null}
            onChange={(value) => setDraftHeight(String(value))}
          />
          <Button
            label="应用"
            onClick={handleApplyCustom}
            variant="primary"
            size="md"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background-tertiary p-3">
          <div>
            <Text type="supporting" color="primary" className="text-sm font-medium">
              编辑帧率
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 block text-[11px]">
              控制预览播放、逐帧操作和默认导出帧率。现有片段的时间保持不变。
            </Text>
          </div>
          <Selector
            label="编辑帧率"
            isLabelHidden
            size="md"
            width={160}
            value={String(projectFrameRate)}
            onChange={(value) => {
              const frameRate = Number(value);
              if (Number.isFinite(frameRate) && frameRate > 0) {
                void updateProjectSettings({ frameRate });
              }
            }}
            options={EDITING_FRAME_RATE_OPTIONS.map((option) => ({
              label: option.label,
              value: String(option.value),
            }))}
          />
        </div>

        <div className="space-y-2">
          <Text type="supporting" color="secondary" className="text-xs font-medium">
            背景填充
          </Text>
          <Text type="supporting" color="secondary" className="text-[11px]">
            为与画面比例不一致的片段填充画布背景。
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <ClickableCard
              label="不填充背景"
              onClick={() => setCanvasBackground(undefined, undefined)}
              padding={2}
              variant={!backgroundFillMode ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                !backgroundFillMode
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              无
            </ClickableCard>
            <ClickableCard
              label="模糊背景填充"
              onClick={() =>
                setCanvasBackground("blur", layoutBackgroundColor)
              }
              padding={2}
              variant={backgroundFillMode === "blur" ? "green" : "muted"}
              className={`border px-3 py-1.5 text-xs ${
                backgroundFillMode === "blur"
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              模糊
            </ClickableCard>
            {BACKGROUND_SWATCHES.map((hex) => {
              const isActive =
                backgroundFillMode === "color" &&
                layoutBackgroundColor?.toLowerCase() === hex.toLowerCase();
              return (
                <ClickableCard
                  key={hex}
                  label={`背景颜色 ${hex}`}
                  onClick={() => setCanvasBackground("color", hex)}
                  padding={0}
                  variant="transparent"
                  style={{ backgroundColor: hex }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    isActive
                      ? "border-primary scale-110"
                      : "border-border hover:scale-105"
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Auto-save */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          自动保存
        </Text>

        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">
              启用自动保存
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
              按固定间隔自动保存项目
            </Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel="启用自动保存"
            checked={autoSave}
            onCheckedChange={setAutoSave}
            showLabel={false}
          />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Text type="supporting" color="secondary" className="whitespace-nowrap text-sm">
              每隔
            </Text>
            <Selector
              label="自动保存间隔"
              isLabelHidden
              size="md"
              width={150}
              value={String(autoSaveInterval)}
              onChange={(value) => setAutoSaveInterval(Number(value))}
              options={[
                { label: "1 分钟", value: "1" },
                { label: "2 分钟", value: "2" },
                { label: "5 分钟", value: "5" },
                { label: "10 分钟", value: "10" },
                { label: "15 分钟", value: "15" },
                { label: "30 分钟", value: "30" },
              ]}
            />
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* AI connections */}
      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          AI 连接
        </Text>
        <Text type="supporting" color="secondary" className="text-xs">
          连接你管理的兼容接口。OpenReel 不会替你选择服务商或模型。
        </Text>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              文本转语音/语音转语音/音效
            </Text>
            <Selector
              label="文本转语音服务"
              isLabelHidden
              size="md"
              width={180}
              value={defaultTtsProvider}
              onChange={(value) => setDefaultTtsProvider(value as TtsProvider)}
              options={ttsProviders.map((s) => ({ label: getServiceDisplayLabel(s), value: s.id }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-sm">
              AI 助手 API 格式
            </Text>
            <Selector
              label="AI 助手 API 格式"
              isLabelHidden
              size="md"
              width={180}
              value={defaultLlmProvider ?? ""}
              onChange={(value) =>
                setDefaultLlmProvider((value || null) as LlmProvider | null)
              }
              options={[
                { label: "选择 API 格式…", value: "" },
                ...llmProviders.map((s) => ({ label: getServiceDisplayLabel(s), value: s.id })),
              ]}
            />
          </div>

          {defaultLlmProvider ? (
            <div className="space-y-3 rounded-lg border border-border bg-background-tertiary p-3">
              <div>
                <Text type="supporting" color="secondary" className="text-sm font-medium">
                  {defaultLlmProvider === "anthropic-compatible"
                    ? "Anthropic 兼容接口"
                    : "OpenAI 兼容接口"}
                </Text>
                <Text type="supporting" color="secondary" className="mt-0.5 block text-xs">
                  输入 API 主机地址，以及该地址提供的可调用工具模型 ID。
                </Text>
              </div>
              <TextInput
                label="基础 URL"
                value={llmBaseUrl}
                onChange={setLlmBaseUrl}
                placeholder={
                  defaultLlmProvider === "anthropic-compatible"
                    ? "https://gateway.example/v1"
                    : "http://localhost:11434/v1"
                }
                width="100%"
              />
              <TextInput
                label="模型 ID"
                value={llmModel}
                onChange={setLlmModel}
                placeholder="输入接口提供的任意模型 ID"
                width="100%"
              />
              <Text type="supporting" color="secondary" className="block text-[11px] leading-relaxed">
                可从 AI 聊天设置加载可用模型；无法发现时也可手动输入 ID。API 密钥可选。
              </Text>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background-tertiary p-3">
              <Text type="supporting" color="secondary" className="block text-xs">
                选择 API 格式以配置主机地址和模型。
              </Text>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
