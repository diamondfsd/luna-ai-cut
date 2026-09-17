import type { JSX } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { CircleAlert, X } from "@/icons/lucide-compat";

export type ChatErrorAction = "general" | "api-keys" | "new-chat" | null;

export interface ChatErrorPresentation {
  readonly title: string;
  readonly message: string;
  readonly action: ChatErrorAction;
  readonly actionLabel?: string;
  readonly details?: string;
}

function messageFromPayload(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Record<string, unknown>;
  return (
    messageFromPayload(payload.message) ??
    messageFromPayload(payload.detail) ??
    messageFromPayload(payload.error)
  );
}

function extractUpstreamMessage(raw: string): string | null {
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    return messageFromPayload(JSON.parse(raw.slice(jsonStart)));
  } catch {
    return null;
  }
}

export function formatChatError(rawError: string): ChatErrorPresentation {
  const raw = rawError.trim() || "AI 请求失败。";
  const upstream = extractUpstreamMessage(raw);
  const status = Number(raw.match(/\b([45]\d{2})\b/)?.[1] ?? 0);
  const searchable = `${raw} ${upstream ?? ""}`.toLowerCase();
  const details = upstream && upstream !== raw ? raw : undefined;

  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|invalid api key|authentication|incorrect api key/.test(
      searchable,
    )
  ) {
    return {
      title: "身份验证失败",
      message:
        upstream ??
        "服务未接受此 API 密钥，请检查已保存的密钥后重试。",
      action: "api-keys",
      actionLabel: "检查 API 密钥",
      details,
    };
  }

  if (status === 429 || /rate limit|too many requests|quota/.test(searchable)) {
    return {
      title: "请求次数已达上限",
      message:
        upstream ??
        "服务当前请求过多，请稍后重试。",
      action: null,
      details,
    };
  }

  if (
    /cors|failed to fetch|network error|could not reach|connection refused|load failed/.test(
      searchable,
    )
  ) {
    return {
      title: "无法连接服务",
      message:
        "请检查服务地址并确认服务在线。通过浏览器连接时，服务还必须允许来自 OpenReel 的 CORS 请求。",
      action: "general",
      actionLabel: "检查服务地址",
      details: raw,
    };
  }

  if (
    /context length|context window|maximum context|prompt is too long|token limit/.test(
      searchable,
    )
  ) {
    return {
      title: "对话内容过长",
      message:
        upstream ??
        "当前模型无法容纳完整对话，请新建对话后继续。",
      action: "new-chat",
      actionLabel: "新建对话",
      details,
    };
  }

  if (status === 404 || /model.+not found|unknown model|does not exist/.test(searchable)) {
    return {
      title: "未找到模型或服务路径",
      message:
        upstream ??
        "请检查基础 URL 和模型 ID 是否与服务提供的信息一致。",
      action: "general",
      actionLabel: "检查服务地址",
      details,
    };
  }

  if (
    /api format|model id|base url|compatible api|endpoint url|secure storage|unlock/.test(
      searchable,
    )
  ) {
    const keyIssue = /secure storage|unlock|api key/.test(searchable);
    return {
      title: "需要设置 AI",
      message: upstream ?? raw,
      action: keyIssue ? "api-keys" : "general",
      actionLabel: keyIssue ? "打开 API 密钥" : "打开 AI 设置",
      details,
    };
  }

  return {
    title: "AI 请求失败",
    message: upstream ?? raw,
    action: null,
    details,
  };
}

export function ChatErrorCard({
  error,
  onDismiss,
  onOpenSettings,
  onNewChat,
}: {
  readonly error: string;
  readonly onDismiss: () => void;
  readonly onOpenSettings: (tab: "general" | "api-keys") => void;
  readonly onNewChat: () => void;
}): JSX.Element {
  const presentation = formatChatError(error);

  return (
    <div
      role="alert"
      className="rounded-xl border border-status-error/35 bg-bg-1 p-3 shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-status-error/10 text-status-error">
          <CircleAlert size={15} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-fg">
            {presentation.title}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-fg-2">
            {presentation.message}
          </div>
        </div>
        <IconButton
          label="关闭错误"
          icon={<X size={13} aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="-mr-1 -mt-1 shrink-0 text-fg-muted transition-colors hover:text-fg"
        />
      </div>

      {presentation.details && (
        <details className="group mt-2 rounded-lg bg-bg-2/70 px-2.5 py-2">
          <summary className="cursor-pointer select-none text-[10px] font-medium text-fg-muted hover:text-fg-2">
            技术详情
          </summary>
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-fg-muted">
            {presentation.details}
          </pre>
        </details>
      )}

      {presentation.action && (
        <Button
          label={presentation.actionLabel ?? "解决问题"}
          variant="secondary"
          size="sm"
          onClick={() => {
            const action = presentation.action;
            if (action === "new-chat") onNewChat();
            else if (action) onOpenSettings(action);
          }}
          className="mt-2.5 w-full"
        />
      )}
    </div>
  );
}
