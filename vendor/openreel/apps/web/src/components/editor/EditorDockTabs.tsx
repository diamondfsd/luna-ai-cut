import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";

export type RightDockTab = "inspector" | "chat";

export function EditorDockTabs({ value, chatEnabled, onSelect }: {
  value: RightDockTab;
  chatEnabled: boolean;
  onSelect(value: RightDockTab): void;
}) {
  if (!chatEnabled) return <div className="h-9 shrink-0 border-b border-border bg-bg-1 px-3 py-2 text-[12px] text-fg-3">素材详情</div>;
  return <Tabs value={value} onValueChange={next => onSelect(next === "chat" ? "chat" : "inspector")} className="shrink-0">
    <TabsList aria-label="编辑面板标签" className="grid h-9 w-full grid-cols-2 gap-1 rounded-none border-b border-border bg-bg-1 p-1">
      <TabsTrigger value="inspector" className="h-7 rounded-[6px] text-[12px] text-fg-3 data-[state=active]:bg-bg-2 data-[state=active]:text-fg">素材详情</TabsTrigger>
      <TabsTrigger value="chat" className="h-7 rounded-[6px] text-[12px] text-fg-3 data-[state=active]:bg-bg-2 data-[state=active]:text-fg">AI 编辑器</TabsTrigger>
    </TabsList>
  </Tabs>;
}
