import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Bot, X, Undo2, Plus, History, Sparkles, FlaskConical } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { useExternalAgentStore } from "../../../stores/external-agent-store";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { ChatMessage } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { InlineConfirmCard } from "./InlineConfirmCard";
import { ChatErrorCard } from "./ChatErrorCard";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { ExternalAgentActivity } from "./ExternalAgentActivity";
import {
  hasSecret,
  isMasterPasswordSet,
  isSessionUnlocked,
} from "../../../services/secure-storage";

function EmptyState({
  hasOpenProject,
}: {
  hasOpenProject: boolean;
}): JSX.Element {
  const externalAvailable = typeof window !== "undefined" && Boolean(window.openreel?.lunaAgent);
  const provider = useSettingsStore((s) => s.defaultLlmProvider);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const configuredServices = useSettingsStore((s) => s.configuredServices);
  const baseUrl = useSettingsStore((s) => s.llmBaseUrl);
  const model = useSettingsStore((s) => s.llmModel);
  const [setup, setSetup] = useState<
    "loading" | "ready" | "setup" | "locked" | "missing" | "endpoint"
  >("loading");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!provider || !baseUrl.trim() || !model.trim()) {
          if (active) setSetup("endpoint");
          return;
        }
        if (!configuredServices.includes(provider)) {
          if (active) setSetup("ready");
          return;
        }
        if (!(await isMasterPasswordSet())) {
          if (active) setSetup("setup");
          return;
        }
        if (!isSessionUnlocked()) {
          if (active) setSetup("locked");
          return;
        }
        if (active) setSetup((await hasSecret(provider)) ? "ready" : "missing");
      } catch {
        if (active) setSetup("missing");
      }
    })();
    return () => {
      active = false;
    };
  }, [baseUrl, configuredServices, model, provider, settingsOpen]);

  if (externalAvailable) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-bg-2/50 px-2.5 py-2 text-left">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
          <Sparkles size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-fg">外部 Agent</div>
          <Text type="supporting" color="secondary" className="mt-0.5 text-[10px] leading-relaxed text-fg-muted">
            输入目标，生成提示词并复制到其他 AI Agent。
          </Text>
        </div>
      </div>
    );
  }

  const setupMessage =
    setup === "endpoint"
      ? "选择 API 格式，然后输入服务 URL 和模型 ID。"
      : setup === "setup"
      ? "设置主密码，然后添加服务商 API 密钥。"
      : setup === "locked"
        ? "解锁加密的 API 密钥后即可使用 AI 编辑器。"
        : "添加可选的服务 API 密钥后即可开始编辑。";

  return (
    <div className="flex h-full flex-col items-center justify-center px-2 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles size={18} />
      </div>
      <div className="text-[13px] font-medium text-fg">通过对话编辑</div>
      <Text type="supporting" color="secondary" className="mt-1 max-w-[14rem] text-[11px] leading-relaxed text-fg-muted">
        {hasOpenProject
          ? "用自然语言描述编辑内容，AI 会在时间线上执行。"
          : "打开或创建项目，然后用自然语言描述编辑内容。"}
      </Text>
      {hasOpenProject && setup !== "loading" && setup !== "ready" && (
        <div className="mt-4 w-full rounded-lg border border-accent/30 bg-accent-soft/50 p-3 text-left">
          <div className="text-[11px] font-medium text-fg">连接模型</div>
          <Text type="supporting" color="secondary" className="mt-1 block text-[10px] leading-relaxed">
            {setupMessage}
          </Text>
          <Button
            label={
              setup === "locked"
                ? "解锁 API 密钥"
                : setup === "endpoint"
                  ? "配置服务"
                  : "设置 AI 对话"
            }
            variant="primary"
            size="sm"
            onClick={() => openSettings(setup === "endpoint" ? "general" : "api-keys")}
            className="mt-2 w-full"
          />
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  onClose,
}: {
  onClose?: () => void;
}): JSX.Element | null {
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);
  const lastTurnCommitted = useChatStore((s) => s.lastTurnCommitted);
  const usage = useChatStore((s) => s.usage);
  const undoLastTurn = useChatStore((s) => s.undoLastTurn);
  const newChat = useChatStore((s) => s.newChat);
  const clearError = useChatStore((s) => s.clearError);
  const setProjectContext = useChatStore((s) => s.setProjectContext);
  const hasOpenProject = useProjectStore((s) => s.hasOpenProject);
  const projectId = useProjectStore((s) => (s.hasOpenProject ? s.project.id : null));
  const dryRun = useSettingsStore((s) => s.agentDryRun);
  const setDryRun = useSettingsStore((s) => s.setAgentDryRun);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const externalAvailable = typeof window !== "undefined" && Boolean(window.openreel?.lunaAgent);
  const externalSession = useExternalAgentStore((s) => s.session);

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const tokenLabel =
    totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k`
      : `${totalTokens}`;

  const externalBusy = externalSession?.status === "queued" || externalSession?.status === "running";
  const busy = externalAvailable
    ? externalBusy
    : status === "running" || status === "awaiting_confirm";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingConfirm, error]);

  useEffect(() => {
    setProjectContext(projectId);
  }, [projectId, setProjectContext]);

  if (externalAvailable) return null;

  return (
    <div className="relative flex h-full flex-col bg-bg-1">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot size={15} className="shrink-0 text-accent" />
        <span className="shrink-0 text-[13px] font-medium text-fg">
          AI 编辑器
        </span>
        {totalTokens > 0 && (
          <span
            title={`输入 ${usage.inputTokens} · 输出 ${usage.outputTokens}`}
            className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted"
          >
            {tokenLabel} 令牌
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={dryRun ? "试运行已开启：仅生成计划，不应用编辑" : "试运行已关闭"}
            icon={<FlaskConical size={14} aria-hidden />}
            size="sm"
            variant={dryRun ? "secondary" : "ghost"}
            onClick={() => setDryRun(!dryRun)}
            aria-pressed={dryRun}
            className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
              dryRun ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-hover hover:text-fg"
            }`}
          />
          {!externalAvailable && <ProviderModelPicker disabled={busy} />}
          {lastTurnCommitted && (
            <IconButton
              label="撤销上一次 AI 操作"
              icon={<Undo2 size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={() => void undoLastTurn()}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            />
          )}
          <IconButton
            label="对话历史"
            icon={<History size={14} aria-hidden />}
            size="sm"
            variant={historyOpen ? "secondary" : "ghost"}
            onClick={() => setHistoryOpen((open) => !open)}
            isDisabled={busy}
            aria-pressed={historyOpen}
            className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          />
          <Button
            label="新建对话"
            size="sm"
            variant="secondary"
            onClick={() => {
              newChat();
              setHistoryOpen(false);
            }}
            isDisabled={busy || messages.length === 0}
            className="h-7 shrink-0 px-2 text-[10px]"
          >
            <Plus size={12} aria-hidden />
          </Button>
          {onClose && (
            <IconButton
              label="关闭"
              icon={<X size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            />
          )}
        </div>
      </header>

      {historyOpen && (
        <ChatHistoryPanel
          projectId={projectId}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3"
      >
        {externalAvailable && <ExternalAgentActivity />}
        {messages.length === 0 && !(externalAvailable && externalSession) ? (
          <EmptyState hasOpenProject={hasOpenProject} />
        ) : messages.length > 0 ? (
          messages.map((m, index) => (
            <ChatMessage
              key={m.id}
              message={m}
              pending={busy && index === messages.length - 1 && m.role === "assistant"}
            />
          ))
        ) : null}

        {pendingConfirm && <InlineConfirmCard call={pendingConfirm.call} />}

        {error && (
          <ChatErrorCard
            error={error}
            onDismiss={clearError}
            onOpenSettings={openSettings}
            onNewChat={() => {
              newChat();
              setHistoryOpen(false);
            }}
          />
        )}
      </div>

      <ChatComposer promptOnly={externalAvailable} />
    </div>
  );
}

export default ChatPanel;
