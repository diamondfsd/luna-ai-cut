import { ArrowUp, Copy } from 'lucide-react'
import type { ExternalAgentDescriptor } from '../../shared/types/externalAgent'
import { Button, Select, Textarea } from '../../ui'

export function AgentComposer({ request, onRequestChange, agents, agentId, onAgentChange, installed, busy, blocked, onSend, onCopy }: {
  request: string; onRequestChange(value: string): void
  agents: ExternalAgentDescriptor[]; agentId: string; onAgentChange(value: string): void
  installed: boolean | null; busy: boolean; blocked: boolean
  onSend(): void; onCopy(): void
}) {
  const agent = agents.find(item => item.id === agentId)
  const sendDisabled = busy || blocked || !request.trim() || installed !== true || agent?.capabilities.task === 'unsupported'
  return <div className="agent-chat-composer">
    <Textarea className="agent-chat-request" aria-label="消息" placeholder="描述你想做什么…" rows={3}
      maxLength={6000} disabled={busy} value={request} onChange={event => onRequestChange(event.target.value)}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter' && !sendDisabled) {
          event.preventDefault(); onSend()
        }
      }} />
    <div className="agent-chat-composer-actions">
      <Select variant="ghost" placeholder="选择 Agent" value={agentId} disabled={busy}
        options={agents.map(item => ({ value: item.id, label: item.name }))} onValueChange={onAgentChange} />
      <div className="agent-chat-send-actions">
        <Button size="mini" disabled={busy || blocked || !request.trim() || !agent}
          onClick={onCopy}><Copy size={14} />复制提示词</Button>
        <Button size="compact" variant="primary" disabled={sendDisabled} onClick={onSend}>
          <ArrowUp size={16} />{busy ? '发送中' : '发送'}
        </Button>
      </div>
    </div>
    {agent && installed === false && <p className="agent-chat-result">未检测到 {agent.name}</p>}
  </div>
}
