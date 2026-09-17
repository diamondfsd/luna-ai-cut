import type { JSX } from "react";
import { useState, useCallback, useEffect, type KeyboardEvent } from "react";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { Send, Square } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { useProjectStore } from "../../../stores/project-store";
import { useExternalAgentStore } from "../../../stores/external-agent-store";
import { ExternalAgentPromptDialog } from "./ExternalAgentPromptDialog";

interface ChatComposerProps {
  promptOnly?: boolean;
}

export function ChatComposer({ promptOnly = false }: ChatComposerProps): JSX.Element {
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const initializeExternalAgent = useExternalAgentStore((s) => s.initialize);
  const submitExternalRequest = useExternalAgentStore((s) => s.submit);
  const cancelExternalRequest = useExternalAgentStore((s) => s.cancel);
  const markPromptGenerated = useExternalAgentStore((s) => s.markPromptGenerated);
  const externalSession = useExternalAgentStore((s) => s.session);
  const promptGenerated = useExternalAgentStore((s) => s.promptGenerated);
  const projectId = useProjectStore((s) => (s.hasOpenProject ? s.project.id : null));
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const externalAvailable = typeof window !== "undefined" && Boolean(window.openreel?.lunaAgent);
  const externalBusy = externalSession?.status === "queued" || externalSession?.status === "running";
  const busy = promptOnly
    ? generatingPrompt
    : externalAvailable
      ? false
      : status === "running" || status === "awaiting_confirm";
  const promptInputVisible = !promptOnly || (!promptGenerated && !externalSession);
  const promptGenerationMode = promptOnly && promptInputVisible;

  useEffect(() => {
    if (externalAvailable) void initializeExternalAgent();
  }, [externalAvailable, initializeExternalAgent]);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || busy) return;

    if (externalBusy) {
      setText("");
      void submitExternalRequest(value, projectId);
      return;
    }

    if (promptGenerationMode) {
      const bridge = window.openreel?.lunaAgent;
      if (!bridge) {
        setGenerationError("AI Agent 尚未准备好");
        return;
      }
      setGeneratingPrompt(true);
      setGenerationError(null);
      void bridge.generatePrompt(value)
        .then((generatedPrompt) => {
          setText("");
          setPrompt(generatedPrompt);
          setPromptDialogOpen(true);
          markPromptGenerated();
        })
        .catch((error: unknown) => {
          setGenerationError(error instanceof Error ? error.message : "无法生成剪辑提示词");
        })
        .finally(() => setGeneratingPrompt(false));
      return;
    }

    setText("");
    if (externalAvailable) {
      void submitExternalRequest(value, projectId);
    } else {
      void send(value);
    }
  }, [text, busy, externalAvailable, externalBusy, projectId, markPromptGenerated, promptGenerationMode, send, submitExternalRequest]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <>
      {promptInputVisible ? (
        <div className="border-t border-border p-2">
          <div className="relative rounded-lg border border-border bg-bg-2 transition-colors focus-within:border-accent">
            <ToolcraftTextAreaControl
              label={promptGenerationMode ? "剪辑目标" : "AI 编辑请求"}
              isLabelHidden
              value={text}
              onChange={setText}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={promptGenerationMode ? "描述剪辑目标，生成提示词…" : externalBusy ? "输入对当前剪辑的修改要求…" : "告诉 AI 如何编辑视频…"}
              inputClassName="block w-full resize-none bg-transparent px-3 py-2 pr-11 text-[13px] text-fg outline-none placeholder:text-fg-muted"
            />
            <div className="absolute bottom-1.5 right-1.5">
              {promptGenerationMode ? (
                <IconButton
                  label={generatingPrompt ? "正在生成提示词" : "生成剪辑提示词"}
                  icon={<Send size={12} aria-hidden />}
                  size="sm"
                  variant="primary"
                  onClick={submit}
                  isDisabled={!text.trim() || generatingPrompt}
                  className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40"
                />
              ) : externalAvailable ? (
                <div className="flex items-center gap-1">
                  {externalBusy && (
                    <IconButton
                      label="停止外部 Agent"
                      icon={<Square size={12} className="fill-current" aria-hidden />}
                      size="sm"
                      variant="destructive"
                      onClick={() => void cancelExternalRequest()}
                      className="grid h-7 w-7 place-items-center rounded-md bg-status-error/15 text-status-error transition-colors hover:bg-status-error/25"
                    />
                  )}
                  <IconButton
                    label={externalBusy ? "更新剪辑要求" : "发送给外部 Agent"}
                    icon={<Send size={12} aria-hidden />}
                    size="sm"
                    variant="primary"
                    onClick={submit}
                    isDisabled={!text.trim()}
                    className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40"
                  />
                </div>
              ) : busy ? (
                <IconButton
                  label="停止"
                  icon={<Square size={12} className="fill-current" aria-hidden />}
                  size="sm"
                  variant="destructive"
                  onClick={stop}
                  className="grid h-7 w-7 place-items-center rounded-md bg-status-error/15 text-status-error transition-colors hover:bg-status-error/25"
                />
              ) : (
                <IconButton
                  label="发送"
                  icon={<Send size={12} aria-hidden />}
                  size="sm"
                  variant="primary"
                  onClick={submit}
                  isDisabled={!text.trim()}
                  className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40"
                />
              )}
            </div>
          </div>
          <div className="mt-1 px-1 text-[10px] text-fg-muted">
            按 Enter {promptGenerationMode ? "生成提示词" : externalBusy ? "更新要求" : "发送"}，按 Shift+Enter 换行
          </div>
          {generationError && (
            <div className="mt-2 px-1 text-[10px] text-status-error" role="alert">
              {generationError}
            </div>
          )}
        </div>
      ) : externalBusy ? (
        <div className="flex justify-end border-t border-border p-2">
          <IconButton
            label="停止外部 Agent"
            icon={<Square size={12} className="fill-current" aria-hidden />}
            size="sm"
            variant="destructive"
            onClick={() => void cancelExternalRequest()}
            className="grid h-7 w-7 place-items-center rounded-md bg-status-error/15 text-status-error transition-colors hover:bg-status-error/25"
          />
        </div>
      ) : null}
      <ExternalAgentPromptDialog
        isOpen={promptDialogOpen}
        prompt={prompt}
        onClose={() => setPromptDialogOpen(false)}
      />
    </>
  );
}
