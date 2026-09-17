import React, { useState, useEffect, useCallback } from "react";
import { Plug, Eye, EyeOff, Copy, RefreshCw, Wifi } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import type { OpenReelMcpStatus } from "../../../types/global";

const isDesktop = (): boolean =>
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

function clientConfigSnippet(shimPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openreel: {
          command: "node",
          args: [shimPath || "<path to openreel-mcp shim>"],
        },
      },
    },
    null,
    2,
  );
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} 已复制`);
  } catch {
    toast.error("复制失败", "剪贴板不可用。");
  }
}

export const McpPanel: React.FC = () => {
  const [status, setStatus] = useState<OpenReelMcpStatus | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      const nextStatus = await bridge.getStatus();
      setStatus(nextStatus);
      if (nextStatus.running) {
        const connection = await bridge.testConnection();
        setToolCount(connection.ok ? (connection.toolCount ?? 0) : null);
      } else {
        setToolCount(null);
      }
    } catch {
      setStatus(null);
      setToolCount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRotate = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      setStatus(await bridge.rotateToken());
      toast.success("令牌已轮换", "请在 MCP 客户端中更新令牌。");
    } catch (err) {
      toast.error("轮换失败", err instanceof Error ? err.message : "未知错误");
    }
  }, []);

  const handleTest = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    setTesting(true);
    try {
      const result = await bridge.testConnection();
      if (result.ok) {
        setToolCount(result.toolCount ?? 0);
        toast.success(
          "连接正常",
          `服务器返回了 ${result.toolCount ?? 0} 个工具。`,
        );
      } else {
        setToolCount(null);
        toast.error("连接失败", result.message ?? "无响应");
      }
    } catch (err) {
      toast.error("连接失败", err instanceof Error ? err.message : "未知错误");
    } finally {
      setTesting(false);
    }
  }, []);

  if (!isDesktop()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug size={28} className="mb-3 text-text-muted" />
        <Text type="body" color="primary" className="text-sm font-medium">
          仅限桌面端
        </Text>
        <Text type="supporting" color="secondary" className="mt-1 max-w-sm text-xs">
          MCP 服务运行在 OpenReel 桌面应用中，外部 AI 客户端（Claude Desktop、Cursor、Cline）
          可以借此编辑项目。请在桌面端 OpenReel 中进行配置。
        </Text>
      </div>
    );
  }

  const tokenDisplay = status?.token
    ? revealToken
      ? status.token
      : "•".repeat(32)
    : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            MCP 服务
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            本地 MCP 服务允许 AI 客户端使用与内置聊天相同的工具操作编辑器。
            服务仅监听本机地址，并需要使用下方的令牌。
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            状态
          </Text>
          <Text
            type="supporting"
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              status?.running ? "text-status-success" : "text-text-muted"
            }`}
          >
            <i
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status?.running ? "bg-status-success" : "bg-text-muted"
              }`}
            />
            {status?.running ? "运行中" : "已停止"}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            工具
          </Text>
          <Text type="supporting" color="secondary" className="text-xs">
            {toolCount === null
              ? status?.running
                ? "正在检查工具目录…"
                : "—"
              : `${toolCount} 个可用`}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            URL
          </Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {status?.url || "—"}
          </code>
          <IconButton
            label="复制 URL"
            onClick={() => status?.url && copy(status.url, "URL")}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            令牌
          </Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {tokenDisplay}
          </code>
          <IconButton
            label={revealToken ? "隐藏令牌" : "显示令牌"}
            onClick={() => setRevealToken((v) => !v)}
            variant="ghost"
            size="sm"
            icon={revealToken ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label="复制令牌"
            onClick={() => status?.token && copy(status.token, "令牌")}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label="轮换令牌"
            onClick={handleRotate}
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <Button
          label={testing ? "测试中…" : "测试连接"}
          size="sm"
          variant="secondary"
          onClick={handleTest}
          isDisabled={testing}
          icon={<Wifi size={14} aria-hidden />}
        />
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            可用工作流
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            当前工具目录为每个桌面工作区提供专用工具。
          </Text>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["视频编辑", "轨道、片段、效果、转场、音频和字幕"],
            ["动效设计", "图层、动画、着色器、遮罩、效果和渲染队列"],
            ["创作与 3D", "场景、产品、材质、摄像机、绑定和预览"],
            ["项目操作", "检查、导入、保存、撤销、导出和诊断"],
          ].map(([label, description]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2.5">
              <Text type="supporting" color="primary" className="text-xs font-medium">
                {label}
              </Text>
              <Text type="supporting" color="secondary" className="mt-1 text-[11px] leading-4">
                {description}
              </Text>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            客户端配置
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            将其添加到 MCP 客户端配置中（Claude Desktop、Cursor、Cline）。
            连接程序会自动连接正在运行的应用。
          </Text>
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
            {clientConfigSnippet(status?.shimPath ?? "")}
          </pre>
          <IconButton
            label="复制配置"
            onClick={() =>
              copy(clientConfigSnippet(status?.shimPath ?? ""), "配置")
            }
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="absolute right-2 top-2 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>
      </div>

    </div>
  );
};
