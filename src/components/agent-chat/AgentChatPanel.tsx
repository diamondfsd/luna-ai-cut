import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, Select } from '../../ui'
import type { AgentChatContext } from '../../shared/types/agentChat'
import { useAgentActivity } from './useAgentActivity'
import { useAgentSelection } from './useAgentSelection'
import { useAgentHistory } from './useAgentHistory'
import { AgentActivity } from './AgentActivity'
import { AgentComposer } from './AgentComposer'
import { mergeAgentActivity } from './mergeAgentActivity'
import './AgentChatPanel.css'

export function AgentChatPanel({ open, context, onOpenChange }: {
  open: boolean; context: AgentChatContext; onOpenChange(open: boolean): void
}) {
  const selection = useAgentSelection()
  const history = useAgentHistory()
  const { snapshot, error: activityError } = useAgentActivity()
  const [request, setRequest] = useState(context.request ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const archived = history.items.find(item => item.id === selectedId)
  const current = snapshot.session
  const anyActive = Boolean(current && ['queued', 'running'].includes(current.status))
  const selectedActive = anyActive && current?.sessionId === selectedId
  const visible = archived ? mergeAgentActivity({ session: archived.session, events: archived.events },
    snapshot.events.filter(event => event.session.sessionId === selectedId))
    : { session: current?.sessionId === selectedId ? current : null,
      events: snapshot.events.filter(event => event.session.sessionId === selectedId) }
  useEffect(() => {
    if (context.request !== undefined) {
      setSelectedId(null)
      setRequest(context.request)
    }
    setError('')
    setResult('')
  }, [context])
  async function launch(copyOnly: boolean) {
    if (pending.current || selectedId || !request.trim() || !selection.agent) return
    pending.current = true
    setBusy(true)
    setError('')
    setResult('')
    try {
      // The external Agent chooses a workflow from the live skill index.
      const input = { request, projectId: context.projectId }
      const response = copyOnly ? await window.luna.externalAgent.copyTask(selection.agent.id, input)
        : await window.luna.externalAgent.startTask(selection.agent.id, input)
      setSelectedId(response.conversation.id)
      setRequest('')
      setResult(response.mode === 'draft' ? `请到 ${selection.agent.name} 确认发送` : `请到 ${selection.agent.name} 粘贴发送`)
      await history.refresh()
    } catch (value) { setError(value instanceof Error ? value.message : '发送失败'); await history.refresh() }
    finally { pending.current = false; setBusy(false) }
  }
  function selectHistory(id: string) {
    setSelectedId(id === 'new' ? null : id)
    setRequest('')
    setResult('')
    setError('')
  }
  const continuationAgent = archived?.agentName || visible.session?.agentType || selection.agent?.name || '所选 Agent'
  const visibleError = error || archived?.error || selection.error || activityError || history.error
  return <Dialog open={open} title="AI 助手" className="agent-chat-panel" modal={false} showOverlay={false} closeOnMaskClick={false} bodyClassName="agent-chat-body"
    onOpenChange={next => { if (!pending.current) onOpenChange(next) }} footer={selectedId
      ? <p className="agent-chat-result">请到 {continuationAgent} 继续聊天</p>
      : <AgentComposer request={request} agents={selection.agents} agentId={selection.agentId}
        onAgentChange={selection.selectAgent} installed={selection.installed} busy={busy} blocked={anyActive}
        onRequestChange={value => { setRequest(value); setError(''); setResult('') }}
        onSend={() => void launch(false)} onCopy={() => void launch(true)} />}>
    <div id="global-agent-chat" className="agent-chat-history">
      <Select variant="compact" placeholder="历史记录" value={selectedId ?? 'new'} fullWidth disabled={busy}
        options={[{ value: 'new', label: '新对话' }, ...history.items.map(item => ({ value: item.id,
          label: `${item.agentName} · ${item.request.replace(/\s+/g, ' ').trim().slice(0, 28)}` }))]}
        onValueChange={selectHistory} />
      <Button size="mini" disabled={busy} onClick={() => selectHistory('new')}>新对话</Button>
    </div>
    <AgentActivity snapshot={visible} onError={setError} readOnly={!selectedActive} originalRequest={archived?.request} />
    {archived && !selectedActive && ['queued', 'running'].includes(archived.session.status) && <p className="agent-chat-result">任务未连接</p>}
    {anyActive && !selectedActive && <p className="agent-chat-result">已有任务进行中，请从历史中选择</p>}
    {visibleError && <Alert variant="error" message={visibleError} />}
    {result && <p className="agent-chat-result" role="status">{result}</p>}
  </Dialog>
}
