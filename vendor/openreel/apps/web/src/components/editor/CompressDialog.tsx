import { useCallback, useRef, useState } from "react";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftProgressBar as ProgressBar } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Video, Loader2 } from "@/icons/lucide-compat";
import {
  computeCompressionPlan,
  estimateCompressedBytes,
  COMPRESSION_SIZE_PRESETS,
  downloadBlob,
  type CompressionSource,
  type CompressionTarget,
  type CompressionQuality,
} from "@openreel/core";
import {
  probeCompressionSource,
  runCompression,
  formatBytes,
} from "../../services/video-compressor";

interface CompressDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUALITY_TIERS: {
  value: CompressionQuality;
  label: string;
  hint: string;
}[] = [
  { value: "light", label: "轻度", hint: "画质最佳" },
  { value: "balanced", label: "均衡", hint: "约 720p" },
  { value: "strong", label: "强力", hint: "体积最小" },
];

const MB = 1024 * 1024;

export function CompressDialog({ isOpen, onClose }: CompressDialogProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<CompressionSource | null>(null);
  const [probing, setProbing] = useState(false);
  const [mode, setMode] = useState<"quality" | "size">("quality");
  const [quality, setQuality] = useState<CompressionQuality>("balanced");
  const [sizePresetId, setSizePresetId] = useState<string>("whatsapp");
  const [customMB, setCustomMB] = useState<string>("");
  const [compressing, setCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const resetSource = () => {
    setFile(null);
    setSource(null);
    setError(null);
    setProgress(0);
  };

  const handlePick = useCallback(async (picked: File) => {
    setFile(picked);
    setSource(null);
    setError(null);
    setProgress(0);
    setProbing(true);
    try {
      const probed = await probeCompressionSource(picked);
      if (!probed) {
        setError("无法读取该视频，请换一个文件。");
      }
      setSource(probed);
    } catch {
      setError("无法读取该视频，请换一个文件。");
    } finally {
      setProbing(false);
    }
  }, []);

  const targetBytes = (() => {
    if (sizePresetId === "custom") {
      const mb = parseFloat(customMB);
      return Number.isFinite(mb) && mb > 0 ? mb * MB : 16 * MB;
    }
    return (
      COMPRESSION_SIZE_PRESETS.find((p) => p.id === sizePresetId)?.bytes ??
      16 * MB
    );
  })();

  const target: CompressionTarget =
    mode === "quality"
      ? { mode: "quality", quality }
      : { mode: "size", targetBytes };

  const plan = source ? computeCompressionPlan(source, target) : null;
  const estimated =
    plan && source ? estimateCompressedBytes(plan, source.durationSec) : 0;
  const originalBytes = file?.size ?? 0;
  const savings =
    originalBytes > 0 && estimated > 0
      ? Math.round((1 - estimated / originalBytes) * 100)
      : 0;

  const handleCompress = useCallback(async () => {
    if (!file || !source || !plan) return;
    setCompressing(true);
    setProgress(0);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const blob = await runCompression(
        file,
        plan,
        (value) => setProgress(value),
        controller.signal,
      );
      const base = file.name.replace(/\.[^.]+$/, "") || "video";
      downloadBlob(blob, `${base}-compressed.mp4`);
      resetSource();
      onClose();
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError("压缩失败，请尝试较轻的设置。");
      }
    } finally {
      setCompressing(false);
      abortRef.current = null;
    }
  }, [file, source, plan, onClose]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !compressing) {
          resetSource();
          onClose();
        }
      }}
      width={512}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="压缩视频"
            onOpenChange={(open) => {
              if (!open && !compressing) {
                resetSource();
                onClose();
              }
            }}
            startContent={<Video size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <div className="space-y-4">
          <FileInput
            label="视频文件"
            isLabelHidden
            value={file}
            onChange={(picked) => {
              if (picked instanceof File) {
                void handlePick(picked);
              } else {
                resetSource();
              }
            }}
            accept="video/*"
            mode="dropzone"
            placeholder="选择要压缩的视频..."
            isDisabled={compressing}
            isLoading={probing}
            width="100%"
            description={
              file
                ? probing
                  ? "读取中..."
                  : source
                    ? `${source.width}x${source.height} - ${formatBytes(originalBytes)}`
                    : formatBytes(originalBytes)
                : undefined
            }
          />

          {source && !compressing && (
            <>
              <ToolcraftSegmentedControl<"quality" | "size">
                ariaLabel="压缩模式"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "quality", label: "画质" },
                  { value: "size", label: "目标大小" },
                ]}
              />

              {mode === "quality" ? (
                <div className="grid grid-cols-3 gap-2">
                  {QUALITY_TIERS.map((tier) => (
                    <SelectableCard
                      key={tier.value}
                      label={tier.label}
                      isSelected={quality === tier.value}
                      onChange={() => setQuality(tier.value)}
                      padding={2}
                      variant={quality === tier.value ? "green" : "default"}
                      className="text-center"
                    >
                      <Text type="label" weight="bold" display="block">
                        {tier.label}
                      </Text>
                      <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                        {tier.hint}
                      </Text>
                    </SelectableCard>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {COMPRESSION_SIZE_PRESETS.map((preset) => (
                      <SelectableCard
                        key={preset.id}
                        label={preset.label}
                        isSelected={sizePresetId === preset.id}
                        onChange={() => setSizePresetId(preset.id)}
                        padding={2}
                        variant={sizePresetId === preset.id ? "green" : "default"}
                        className="text-center"
                      >
                        <Text type="label" weight="bold">
                          {preset.label}
                        </Text>
                      </SelectableCard>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <SelectableCard
                      label="自定义目标大小"
                      isSelected={sizePresetId === "custom"}
                      onChange={() => setSizePresetId("custom")}
                      padding={2}
                      variant={sizePresetId === "custom" ? "green" : "default"}
                    >
                      <Text type="label" weight="bold">
                        自定义
                      </Text>
                    </SelectableCard>
                    {sizePresetId === "custom" && (
                      <div className="flex-1">
                        <ToolcraftNumberInputControl
                          label="自定义目标大小"
                          isLabelHidden
                          min={1}
                          value={customMB ? Number(customMB) : null}
                          onChange={(value) => setCustomMB(String(value))}
                          placeholder="MB"
                          units="MB"
                          width="100%"
                          size="sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {plan && (
                <Card variant="muted" padding={3} className="border border-border">
                  <div className="flex items-center justify-between">
                    <Text type="supporting" color="secondary">
                      预计输出
                    </Text>
                    <Text type="label" weight="bold">
                      {plan.width}x{plan.height} - ~{formatBytes(estimated)}
                    </Text>
                  </div>
                  {savings > 0 && originalBytes > 0 && (
                    <div className="mt-1 flex items-center justify-between">
                      <Text type="supporting" color="secondary">
                        原始大小 {formatBytes(originalBytes)}
                      </Text>
                      <Text type="supporting" color="active" weight="bold">
                        体积减少 {savings}%
                      </Text>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}

          {compressing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-primary" aria-hidden />
                <Text type="body" weight="bold">
                正在压缩... {Math.round(progress * 100)}%
                </Text>
              </div>
              <ProgressBar
                label="压缩进度"
                isLabelHidden
                value={Math.round(progress * 100)}
                max={100}
                variant="accent"
              />
            </div>
          )}

          {error && (
            <Card variant="red" padding={2}>
              <Text type="supporting" color="primary">
                {error}
              </Text>
            </Card>
          )}
        </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
        <div className="flex justify-end gap-2">
          {compressing ? (
            <Button
              label="取消"
              variant="ghost"
              onClick={() => abortRef.current?.abort()}
            />
          ) : (
            <>
              <Button
                label="关闭"
                variant="ghost"
                onClick={() => {
                  resetSource();
                  onClose();
                }}
              />
              <Button
                label="压缩"
                variant="primary"
                onClick={handleCompress}
                isDisabled={!source || probing}
              />
            </>
          )}
        </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
