import type { JSX } from "react";
import { useState, useCallback, type KeyboardEvent } from "react";
import { ToolcraftIconButton as IconButton, ToolcraftTextAreaControl } from "@openreel/ui";
import { Send, Square } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";

interface ChatComposerProps {
  promptOnly?: boolean;
}

export function ChatComposer(_props: ChatComposerProps): JSX.Element | null {
  return window.openreel?.lunaAgent ? null : <LocalChatComposer />;
}

function LocalChatComposer(): JSX.Element {
  const status = useChatStore((state) => state.status);
  const send = useChatStore((state) => state.send);
  const stop = useChatStore((state) => state.stop);
  const [text, setText] = useState("");
  const busy = status === "running" || status === "awaiting_confirm";
  const submit = useCallback(() => {
    const request = text.trim();
    if (!request || busy) return;
    setText("");
    void send(request);
  }, [text, busy, send]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  }, [submit]);
  return <div className="border-t border-border p-2">
    <div className="relative rounded-lg border border-border bg-bg-2 focus-within:border-accent">
      <ToolcraftTextAreaControl label="AI 编辑请求" isLabelHidden value={text} onChange={setText}
        onKeyDown={onKeyDown} rows={2} placeholder="告诉 AI 如何编辑视频…"
        inputClassName="block w-full resize-none bg-transparent px-3 py-2 pr-11 text-[13px] text-fg outline-none" />
      <div className="absolute bottom-1.5 right-1.5">
        <IconButton label={busy ? "停止" : "发送"} icon={busy ? <Square size={12} aria-hidden /> : <Send size={12} aria-hidden />}
          size="sm" variant={busy ? "destructive" : "primary"} onClick={busy ? stop : submit} isDisabled={!busy && !text.trim()} />
      </div>
    </div>
  </div>;
}
