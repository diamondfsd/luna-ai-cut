import type { JSX } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { AlertTriangle } from "@/icons/lucide-compat";
import type { ToolCall } from "@openreel/agent";
import { useChatStore } from "../../../stores/chat-store";

export function InlineConfirmCard({ call }: { call: ToolCall }): JSX.Element {
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);

  return (
    <div
      data-tool-name={call.name}
      className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-2.5 text-[12px]"
    >
      <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
        <AlertTriangle size={13} className="text-status-warning" />
        确认删除素材
      </div>
      <Text type="supporting" color="secondary" className="mb-2 text-fg-2">
        AI 请求删除项目中的一个素材。
      </Text>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          label="删除"
          variant="destructive"
          size="sm"
          onClick={() => resolveConfirm("approve")}
          className="rounded-md px-2.5 py-1 text-[11px] font-medium"
        />
        <Button
          label="拒绝"
          variant="secondary"
          size="sm"
          onClick={() => resolveConfirm("reject")}
          className="rounded-md px-2.5 py-1 text-[11px] font-medium"
        />
      </div>
    </div>
  );
}
