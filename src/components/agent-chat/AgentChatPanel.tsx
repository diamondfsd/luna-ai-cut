import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, Select, Textarea } from '../../ui'
import type { AgentChatContext } from '../../shared/types/agentChat'
import { useAgentActivity } from './useAgentActivity'
import { useAgentSelection } from './useAgentSelection'
import { useAgentHistory } from './useAgentHistory'
import { AgentActivity } from './AgentActivity'
import { mergeAgentActivity } from './mergeAgentActivity'
import './AgentChatPanel.css'

export function AgentChatPanel({ open, context, onOpenChange }: {
  open: boolean; context: AgentChatContext; onOpenChange(open: boolean): void
}) {
  const selection = useAgentSelection()
  const history = useAgentHistory()
  const { snapshot, error: activityError } = useAgentActivity()
  const [purpose, setPurpose] = useState(context.purpose)
  const [request, setRequest] = useState(context.request ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const archived = history.items.find(item => item.id === selectedId)
  const current = snapshot.session
  const anyActive = current && ['queued', 'running'].includes(current.status)
  const selectedActive = Boolean(anyActive && current?.sessionId === selectedId)
  const visible = archived ? mergeAgentActivity({ session: archived.session, events: archived.events },
    snapshot.events.filter(event => event.session.sessionId === selectedId))
    : { session: current?.sessionId === selectedId ? current : null,
      events: snapshot.events.filter(event => event.session.sessionId === selectedId) }
  useEffect(() => {
    setPurpose(context.purpose)
    if (context.request !== undefined) setRequest(context.request)
    setError('')
    setResult('')
  }, [context])
  async function launch(copyOnly: boolean) {
    if (pending.current || !request.trim() || !selection.agent) return
    pending.current = true
    setBusy(true)
    setError('')
    setResult('')
    try {
      const input = { request, purpose, projectId: context.projectId }
      const response = copyOnly ? await window.luna.externalAgent.copyTask(selection.agent.id, input)
        : await window.luna.externalAgent.startTask(selection.agent.id, input)
      setSelectedId(response.conversation.id)
      setRequest('')
      setResult(response.mode === 'draft' ? `任务已预填，请到 ${selection.agent.name} 确认发送并继续沟通` : `提示词已复制，请到 ${selection.agent.name} 粘贴发送并继续沟通`)
      await history.refresh()
    } catch (value) { setError(value instanceof Error ? value.message : '发起任务失败'); await history.refresh() }
    finally { pending.current = false; setBusy(false) }
  }
  async function updateCurrent() {
    if (pending.current || !selectedActive || !current || !request.trim()) return
    pending.current = true
    setBusy(true)
    try {
      await window.luna.aiEditor.agent.updateRequest(current.sessionId, request.trim())
      setRequest('')
      setError('')
    } catch { setError('更新任务失败') }
    finally { pending.current = false; setBusy(false) }
  }
  function selectHistory(id: string) {
    const item = history.items.find(value => value.id === id)
    if (!item) return
    setSelectedId(id)
    setPurpose(item.purpose)
    if (selection.agents.some(agent => agent.id === item.agentId)) selection.selectAgent(item.agentId)
    setRequest('')
    setResult('')
    setError('')
  }
  const { agent, installed } = selection
  const visibleError = error || selection.error || activityError || history.error
  return <Dialog open={open} title="AI 助手" className="agent-chat-panel" modal={false} showOverlay={false} closeOnMaskClick={false} bodyClassName="agent-chat-body"
    onOpenChange={next => { if (!pending.current) onOpenChange(next) }} footer={<>
      <Button size="compact" disabled={busy || !request.trim() || Boolean(anyActive)} onClick={() => void launch(true)}>复制提示词</Button>
      {selectedActive ? <Button size="compact" variant="primary" disabled={busy || !request.trim()}
        onClick={() => void updateCurrent()}>更新当前任务</Button>
        : <Button size="compact" variant="primary" disabled={busy || !request.trim() || Boolean(anyActive) || installed !== true || agent?.capabilities.task === 'unsupported'}
          onClick={() => void launch(false)}>{busy ? '发起中' : '发起任务'}</Button>}
    </>}>
    <div id="global-agent-chat" className="agent-chat-toolbar">
      <Select variant="compact" placeholder="选择 Agent" value={selection.agentId} disabled={busy || selectedActive}
        options={selection.agents.map(value => ({ value: value.id, label: value.name }))} onValueChange={selection.selectAgent} />
      <Select variant="compact" placeholder="任务类型" value={purpose} disabled={busy || selectedActive}
        options={[{ value: 'editing', label: 'AI 剪辑' }, { value: 'director-plan', label: '导演计划' }]}
        onValueChange={value => setPurpose(value as AgentChatContext['purpose'])} />
    </div>
    <div className="agent-chat-toolbar">
      <Select variant="compact" placeholder="任务历史" value={selectedId ?? ''} disabled={busy}
        options={history.items.map(item => ({ value: item.id, label: `${item.purpose === 'director-plan' ? '导演计划' : 'AI 剪辑'} · ${item.request.slice(0, 24)}` }))}
        onValueChange={selectHistory} />
      <Button size="mini" disabled={busy} onClick={() => { setSelectedId(null); setRequest(''); setResult(''); setError('') }}>新对话</Button>
      {archived && !selectedActive && <Button size="mini" variant="danger" disabled={busy} onClick={async () => {
        try { await window.luna.externalAgent.deleteConversation(archived.id); setSelectedId(null); await history.refresh() }
        catch { setError('删除记录失败') }
      }}>删除记录</Button>}
    </div>
    <AgentActivity snapshot={visible} onError={setError} readOnly={!selectedActive} originalRequest={archived?.request} />
    <p className="agent-chat-result">后续请在 {archived?.agentName || agent?.name || '所选 Agent'} 中继续沟通；这里显示任务进度和结果。</p>
    {archived && !selectedActive && ['queued', 'running'].includes(archived.session.status) && <p className="agent-chat-result">未连接到此任务，可新建对话后重新发起。</p>}
    {anyActive && !selectedActive && <p className="agent-chat-result">已有任务进行中，请从历史中选择该任务。</p>}
    <Textarea className="agent-chat-request" aria-label="任务要求" placeholder="任务要求" rows={4}
      maxLength={6000} disabled={busy} value={request}
      onChange={event => { setRequest(event.target.value); setError(''); setResult('') }} />
    {visibleError && <Alert variant="error" message={visibleError} />}
    {result && <p className="agent-chat-result" role="status">{result}</p>}
  </Dialog>
}
