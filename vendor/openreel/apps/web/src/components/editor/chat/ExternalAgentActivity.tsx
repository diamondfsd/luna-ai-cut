import { useEffect, useState, type JSX } from "react";
import { Bot, Check, CircleAlert, Loader2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftProgressBar } from "@openreel/ui";
import { useExternalAgentStore } from "../../../stores/external-agent-store";

const STATUS_LABELS: Record<string, string> = {
  queued: "等待 Agent",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const PHASE_LABELS: Record<string, string> = {
  waiting: "等待任务",
  analyzing_media: "分析素材",
  creating_project: "创建项目",
  importing_media: "导入素材",
  editing: "剪辑中",
  captioning: "处理字幕",
  saving: "保存项目",
  exporting: "导出成片",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const TOOL_PROGRESS_LABELS: Record<string, string> = {
  get_director_plan_format: "读取计划格式",
  list_director_plans: "查找导演计划",
  get_director_plan: "读取导演计划",
  validate_director_plan_markdown: "检查计划",
  create_director_plan: "创建导演计划",
  validate_director_plan_changes: "检查计划修改",
  update_director_plan: "更新导演计划",
  get_editing_skill: "读取剪辑能力",
  list_editing_skills: "扫描剪辑技能",
  get_editing_skill_resource: "读取技能参考",
  list_local_media: "浏览本地素材",
  inspect_local_media: "查看素材画面",
  create_media_contact_sheet: "生成素材联络表",
  transcribe_local_media: "识别语音字幕",
  list_music_templates: "选择背景音乐模板",
  get_music_template: "读取背景音乐模板",
  generate_background_music: "生成背景音乐",
  create_project: "创建项目",
  open_project: "打开项目",
  import_local_media: "导入本地素材",
  add_clip: "添加片段",
  trim_clip: "裁剪片段",
  split_clip: "分割片段",
  ripple_delete_clip: "整理时间线",
  add_transition: "添加转场",
  create_text_clip: "添加文字包装",
  import_srt: "导入字幕",
  export_video: "导出视频",
};

function statusIcon(status: string): JSX.Element {
  if (status === "completed") return <Check size={13} />;
  if (status === "failed") return <CircleAlert size={13} />;
  return <Loader2 size={13} className={status === "running" ? "animate-spin" : ""} />;
}

export function ExternalAgentActivity(): JSX.Element | null {
  const initialize = useExternalAgentStore((state) => state.initialize);
  const available = useExternalAgentStore((state) => state.available);
  const session = useExternalAgentStore((state) => state.session);
  const awaitingAgent = useExternalAgentStore((state) => state.awaitingAgent);
  const events = useExternalAgentStore((state) => state.events);
  const error = useExternalAgentStore((state) => state.error);
  const confirmExport = useExternalAgentStore((state) => state.confirmExport);
  const denyExport = useExternalAgentStore((state) => state.denyExport);
  const [exportDecisionBusy, setExportDecisionBusy] = useState(false);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if ((!available || !session) && error) {
    return (
      <div className="rounded-md border border-status-error/30 bg-status-error/10 px-2.5 py-2 text-[11px] text-status-error">
        {error}
      </div>
    );
  }

  if (awaitingAgent) {
    return (
      <section
        className="space-y-2 rounded-md border border-border bg-bg-2/50 p-2.5"
        aria-label="外部 Agent 进度"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
            <Bot size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-fg">等待外部 Agent</div>
            <div className="mt-0.5 text-[10px] text-fg-muted">
              将提示词粘贴到其他 AI Agent 后，这里会显示剪辑进度
            </div>
          </div>
          <Loader2 size={13} className="shrink-0 text-fg-muted" />
        </div>
      </section>
    );
  }

  if (!available || !session) return null;

  const terminal = session.status === "completed" || session.status === "failed" || session.status === "cancelled";
  const progressVariant = session.status === "failed" ? "error" : session.status === "completed" ? "success" : "accent";
  const sessionEvents = events.filter(
    (event) => event.session.sessionId === session.sessionId,
  );
  const lastEvent = sessionEvents.at(-1);
  const activeToolLabel = lastEvent?.type === "tool-start" && lastEvent.toolName
    ? TOOL_PROGRESS_LABELS[lastEvent.toolName] ?? "执行编辑操作"
    : null;
  const lastToolFinished = [...sessionEvents].reverse().find(
    (event) => event.type === "tool-finished",
  );
  const lastToolStart = [...sessionEvents].reverse().find(
    (event) => event.type === "tool-start",
  );
  const lastToolFailure = lastToolFinished?.ok === false
    && (!lastToolStart || lastToolStart.sequence < lastToolFinished.sequence)
    ? lastToolFinished
    : null;
  const decideExport = async (approved: boolean): Promise<void> => {
    if (exportDecisionBusy) return;
    setExportDecisionBusy(true);
    try {
      await (approved ? confirmExport() : denyExport());
    } finally {
      setExportDecisionBusy(false);
    }
  };

  return (
    <section
      className="space-y-2 rounded-md border border-border bg-bg-2/50 p-2.5"
      aria-label="外部 Agent 进度"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
          <Bot size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-fg">
            <span className="truncate">{session.agentType || "外部 Agent"}</span>
            <span className="text-fg-muted">·</span>
            <span className={session.status === "failed" ? "text-status-error" : session.status === "completed" ? "text-status-success" : "text-fg-muted"}>
              {STATUS_LABELS[session.status] ?? session.status}
            </span>
          </div>
          <div className="truncate text-[10px] text-fg-muted">
            {PHASE_LABELS[session.phase] ?? session.phase} · {session.agentModel ? `模型：${session.agentModel}` : "模型未上报"}
          </div>
        </div>
        <span className="shrink-0 text-fg-muted">{statusIcon(session.status)}</span>
      </div>

      <ToolcraftProgressBar
        label={activeToolLabel ? `正在${activeToolLabel}` : session.message}
        value={session.progress}
        hasValueLabel
        isLabelHidden
        variant={progressVariant}
      />

      {lastToolFailure && (
        <div className="space-y-0.5 rounded border border-status-error/30 bg-status-error/10 px-2 py-1.5 text-[10px] text-status-error">
          <div>{lastToolFailure.error?.message ?? lastToolFailure.summary ?? "编辑操作失败"}</div>
          {lastToolFailure.error?.suggestedAction && (
            <div className="text-status-error/80">{lastToolFailure.error.suggestedAction}</div>
          )}
        </div>
      )}

      {error && !lastToolFailure && (
        <div className="rounded border border-status-error/30 bg-status-error/10 px-2 py-1.5 text-[10px] text-status-error">
          {error}
        </div>
      )}

      {session.cancelRequested && !terminal && (
        <div className="text-[10px] text-status-warning">正在停止当前任务</div>
      )}

      {session.exportConfirmation === "pending" && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="text-[11px] font-medium text-fg">是否导出视频？</div>
          <div className="flex gap-1.5">
            <Button
              label="暂不导出"
              variant="ghost"
              size="sm"
              onClick={() => void decideExport(false)}
              isDisabled={exportDecisionBusy}
              className="flex-1"
            />
            <Button
              label="确认导出"
              variant="primary"
              size="sm"
              onClick={() => void decideExport(true)}
              isDisabled={exportDecisionBusy}
              className="flex-1"
            />
          </div>
        </div>
      )}
    </section>
  );
}
