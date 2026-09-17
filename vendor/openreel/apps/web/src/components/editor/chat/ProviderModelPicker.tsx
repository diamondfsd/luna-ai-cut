import type { JSX } from "react";
import { useState } from "react";
import {
  ToolcraftButton as Button,
  ToolcraftIconButton as IconButton,
  ToolcraftPopover as Popover,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
  ToolcraftTextInputControl as TextInput,
} from "@openreel/ui";
import { Settings2 } from "@/icons/lucide-compat";
import {
  useSettingsStore,
  type LlmProvider,
} from "../../../stores/settings-store";
import { discoverCompatibleModels } from "../../../services/agent/model-discovery";
import {
  getSecret,
  isSessionUnlocked,
} from "../../../services/secure-storage";

const PROVIDERS: ReadonlyArray<{ id: LlmProvider; label: string }> = [
  { id: "openai-compatible", label: "OpenAI 兼容" },
  { id: "anthropic-compatible", label: "Anthropic 兼容" },
];

interface ProviderModelPickerProps {
  readonly disabled?: boolean;
}

export function ProviderModelPicker({
  disabled = false,
}: ProviderModelPickerProps): JSX.Element {
  const provider = useSettingsStore((s) => s.defaultLlmProvider);
  const baseUrl = useSettingsStore((s) => s.llmBaseUrl);
  const model = useSettingsStore((s) => s.llmModel);
  const configuredServices = useSettingsStore((s) => s.configuredServices);
  const setProvider = useSettingsStore((s) => s.setDefaultLlmProvider);
  const setBaseUrl = useSettingsStore((s) => s.setLlmBaseUrl);
  const setModel = useSettingsStore((s) => s.setLlmModel);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [open, setOpen] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [discoveryMessage, setDiscoveryMessage] = useState("");

  const providerLabel =
    PROVIDERS.find((item) => item.id === provider)?.label ?? "未配置";
  const currentModel = model.trim();

  const discoverModels = async (): Promise<void> => {
    if (!provider) {
      setDiscoveryStatus("error");
      setDiscoveryMessage("请先选择 API 格式。");
      return;
    }
    if (!baseUrl.trim()) {
      setDiscoveryStatus("error");
      setDiscoveryMessage("请先输入服务基础 URL。");
      return;
    }
    if (configuredServices.includes(provider) && !isSessionUnlocked()) {
      setDiscoveryStatus("error");
      setDiscoveryMessage("请先解锁 API 密钥，再加载模型。");
      return;
    }

    setDiscoveryStatus("loading");
    setDiscoveryMessage("");
    try {
      const apiKey = isSessionUnlocked() ? ((await getSecret(provider)) ?? "") : "";
      const models = await discoverCompatibleModels({
        provider,
        baseUrl,
        apiKey,
      });
      setDiscoveredModels(models);
      setDiscoveryStatus(models.length > 0 ? "ready" : "error");
      setDiscoveryMessage(
        models.length > 0
          ? `找到 ${models.length} 个模型。`
          : "服务未返回模型，请手动输入模型 ID。",
      );
    } catch (error) {
      setDiscoveredModels([]);
      setDiscoveryStatus("error");
      setDiscoveryMessage(
        error instanceof Error
          ? error.message
          : "无法从服务加载模型。",
      );
    }
  };

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="below"
      alignment="end"
      width={360}
      label="AI 服务和模型"
      content={
        <div className="space-y-3 p-3">
          <div>
            <Text type="body" color="primary" className="text-[12px] font-medium">
              连接任意兼容模型
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 block text-[10px] leading-relaxed">
              选择 API 格式，然后使用自己的服务地址和模型。OpenReel 不会替你选择服务商或模型。
            </Text>
          </div>

          <Selector
            label="API 格式"
            size="sm"
            width="100%"
            value={provider ?? ""}
            options={[
              { value: "", label: "选择 API 格式…" },
              ...PROVIDERS.map((item) => ({ value: item.id, label: item.label })),
            ]}
            onChange={(value) => {
              setProvider((value || null) as LlmProvider | null);
              setDiscoveredModels([]);
              setDiscoveryStatus("idle");
              setDiscoveryMessage("");
            }}
          />

          <TextInput
            label="基础 URL"
            value={baseUrl}
            onChange={(value) => {
              setBaseUrl(value);
              setDiscoveredModels([]);
              setDiscoveryStatus("idle");
            }}
            placeholder={
              provider === "anthropic-compatible"
                ? "https://gateway.example/v1"
                : "http://localhost:11434/v1"
            }
            width="100%"
          />

          <div className="space-y-2 rounded-md border border-border bg-bg-2 p-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextInput
                  label="模型 ID"
                  value={model}
                  onChange={setModel}
                  placeholder="输入支持工具调用的模型 ID"
                  width="100%"
                />
              </div>
              <Button
                label={discoveryStatus === "loading" ? "加载中…" : "加载模型"}
                size="sm"
                variant="secondary"
                isDisabled={discoveryStatus === "loading" || !provider || !baseUrl.trim()}
                onClick={() => void discoverModels()}
              />
            </div>

            {discoveredModels.length > 0 && (
              <Selector
                label="服务中的模型"
                size="sm"
                width="100%"
                value={
                  discoveredModels.some((item) => item.id === currentModel)
                    ? currentModel
                    : ""
                }
                options={[
                  { value: "", label: "选择已发现的模型…" },
                  ...discoveredModels.map((item) => ({
                    value: item.id,
                    label: item.label === item.id ? item.id : `${item.label} · ${item.id}`,
                  })),
                ]}
                onChange={(value) => {
                  if (value) setModel(value);
                }}
              />
            )}

            {discoveryStatus !== "idle" && discoveryStatus !== "loading" && (
              <Text
                type="supporting"
                color={discoveryStatus === "error" ? "danger" : "secondary"}
                className="block text-[10px] leading-relaxed"
              >
                {discoveryMessage}
              </Text>
            )}
          </div>

          <Text type="supporting" color="secondary" className="block text-[10px] leading-relaxed">
            模型列表通过 GET /models 获取。若服务未提供该接口，请手动输入模型 ID。浏览器中的服务还需允许 CORS。
          </Text>

          <Button
            label="管理可选 API 密钥"
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              openSettings("api-keys");
            }}
            className="w-full"
          />
        </div>
      }
    >
      <IconButton
        label={`AI 设置：${providerLabel}，${currentModel || "未选择模型"}`}
        icon={<Settings2 size={14} aria-hidden />}
        size="sm"
        variant="ghost"
        isDisabled={disabled}
        className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
      />
    </Popover>
  );
}
