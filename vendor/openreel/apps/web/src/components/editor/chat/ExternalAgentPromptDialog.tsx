import { useEffect, useState, type JSX } from "react";
import { Check, Copy, Sparkles } from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftDialog as Dialog,
  ToolcraftDialogHeader as DialogHeader,
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
  ToolcraftLayoutFooter as LayoutFooter,
  ToolcraftTextAreaControl,
} from "@openreel/ui";
import { toast } from "../../../stores/notification-store";

interface ExternalAgentPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  prompt: string;
}

export function ExternalAgentPromptDialog({
  isOpen,
  onClose,
  prompt,
}: ExternalAgentPromptDialogProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) setCopied(false);
  }, [isOpen, prompt]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success("提示词已复制", "请粘贴到其他 AI Agent 中");
      onClose();
    } catch {
      toast.error("复制失败", "剪贴板不可用");
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      width={720}
    >
      <Layout
        header={
          <DialogHeader
            title="剪辑提示词已生成"
            subtitle="复制后粘贴到其他 AI Agent，开始剪辑。"
            onOpenChange={onClose}
            startContent={<Sparkles size={17} className="text-accent" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="space-y-2">
            <ToolcraftTextAreaControl
              label="剪辑提示词"
              isLabelHidden
              value={prompt}
              readOnly
              rows={16}
              inputClassName="min-h-[280px] resize-y font-mono text-[11px] leading-relaxed"
            />
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <Button label="关闭" variant="ghost" onClick={onClose} />
            <Button
              label={copied ? "已复制" : "复制提示词"}
              icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              variant="primary"
              onClick={() => void handleCopy()}
            />
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
