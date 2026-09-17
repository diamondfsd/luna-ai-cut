import React from "react";
import { Loader2, CheckCircle, XCircle, Clock } from "@/icons/lucide-compat";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftProgressBar as ProgressBar } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  useProcessingStore,
  PROCESSING_TYPE_LABELS,
  type ProcessingTask,
} from "../../services/processing-manager";

const PROCESSING_STATUS_LABELS: Record<ProcessingTask["status"], string> = {
  queued: "排队中",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

const PROCESSING_MESSAGE_LABELS: Record<string, string> = {
  "Waiting to start...": "等待开始...",
  Complete: "已完成",
  Failed: "失败",
  "Initializing AI model...": "正在初始化 AI 模型...",
  "Preparing background detection...": "正在准备背景检测...",
  "Configuring effect pipeline...": "正在配置效果处理...",
  "Finalizing setup...": "正在完成设置...",
};

function processingMessage(message: string): string {
  return PROCESSING_MESSAGE_LABELS[message] ?? message;
}

const TaskItem: React.FC<{ task: ProcessingTask }> = ({ task }) => {
  const getIcon = () => {
    switch (task.status) {
      case "queued":
        return <Clock size={14} className="text-text-muted" aria-hidden />;
      case "processing":
        return <Loader2 size={14} className="text-blue-400 animate-spin" aria-hidden />;
      case "completed":
        return <CheckCircle size={14} className="text-green-400" aria-hidden />;
      case "failed":
        return <XCircle size={14} className="text-red-400" aria-hidden />;
    }
  };

  const getStatusColor = () => {
    switch (task.status) {
      case "queued":
        return "text-text-muted";
      case "processing":
        return "text-blue-400";
      case "completed":
        return "text-green-400";
      case "failed":
        return "text-red-400";
    }
  };

  return (
    <Card variant="muted" padding={2} className="flex items-center gap-3 bg-black/20">
      {getIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <Text type="supporting" weight="bold" maxLines={1}>
            {PROCESSING_TYPE_LABELS[task.type]}
          </Text>
          <Text type="supporting" className={`text-[10px] ${getStatusColor()}`}>
            {task.status === "processing"
              ? `${task.progress}%`
              : PROCESSING_STATUS_LABELS[task.status]}
          </Text>
        </div>
        {task.status === "processing" && (
          <div className="mt-1">
            <ProgressBar
              label={`${PROCESSING_TYPE_LABELS[task.type]}进度`}
              isLabelHidden
              value={task.progress}
              max={100}
              variant="accent"
            />
            <Text
              type="supporting"
              color="secondary"
              display="block"
              maxLines={1}
              className="mt-0.5 text-[9px]"
            >
              {processingMessage(task.message)}
            </Text>
          </div>
        )}
        {task.status === "failed" && task.error && (
          <Text type="supporting" display="block" maxLines={1} className="mt-0.5 text-[9px] text-red-400">
            {task.error}
          </Text>
        )}
      </div>
    </Card>
  );
};

export const ProcessingOverlay: React.FC = () => {
  const { tasks, isProcessing, getOverallProgress } = useProcessingStore();
  const taskList = Array.from(tasks.values());
  const activeTasks = taskList.filter(
    (t) => t.status === "queued" || t.status === "processing",
  );

  if (!isProcessing || activeTasks.length === 0) {
    return null;
  }

  const { progress } = getOverallProgress();

  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <Card
        variant="default"
        padding={6}
        className="max-w-sm w-full mx-4 bg-background-secondary/95 shadow-2xl border border-border"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
            <Loader2 size={20} className="text-blue-400 animate-spin" aria-hidden />
          </div>
          <div>
            <Text as="h3" type="label" weight="bold" display="block">
              正在处理效果
            </Text>
            <Text type="supporting" color="secondary" display="block">
              {activeTasks.length} 个任务处理中
            </Text>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <Text type="supporting" color="secondary" className="text-[10px]">
              总进度
            </Text>
            <Text type="supporting" color="secondary" className="text-[10px] font-mono">
              {progress}%
            </Text>
          </div>
          <ProgressBar
            label="总体进度"
            isLabelHidden
            value={progress}
            max={100}
            variant="accent"
          />
        </div>

        <div className="max-h-48 overflow-y-auto">
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        </div>

        <Text type="supporting" color="secondary" display="block" justify="center" className="mt-4 text-[10px]">
          正在应用效果，请稍候...
        </Text>
      </Card>
    </div>
  );
};

export default ProcessingOverlay;
