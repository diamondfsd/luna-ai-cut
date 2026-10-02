import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, Select, Textarea } from '../../ui'
import type { AgentChatContext } from '../../shared/types/agentChat'
import { buildDirectorPlanAgentPrompt } from '../../lib/directorPlanAgentPrompt'
import { buildAiEditorHttpAgentPrompt } from '../../pages/aiEditorAgentPrompt'
import { useAgentActivity } from './useAgentActivity'
import { useAgentSelection } from './useAgentSelection'
import { AgentActivity } from './AgentActivity'
import './AgentChatPanel.css'

export function AgentChatPanel({ open, context, onOpenChange }: {
  open: boolean; context: AgentChatContext; onOpenChange(open: boolean): void
}) {
  const selection = useAgentSelection()
  const { snapshot, error: activityError } = useAgentActivity()
  const [purpose, setPurpose] = useState(context.purpose)
  const [request, setRequest] = useState(context.request ?? '')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const sessionActive = snapshot.session && ['queued', 'running'].includes(snapshot.session.status)
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
      const connection = await window.luna.aiEditor.mcp.getHttpConnection()
      if (!connection) throw new Error('暂时无法连接，请重试')
      const prompt = purpose === 'director-plan'
        ? buildDirectorPlanAgentPrompt(connection, request)
        : buildAiEditorHttpAgentPrompt(connection, request)
      const contextualPrompt = purpose === 'editing' && context.projectId
        ? `${prompt}\n本次用户选择的现有项目 ID：${JSON.stringify(context.projectId)}。通过工具确认并打开该项目后执行。`
        : prompt
      if (copyOnly) {
        await window.luna.copyText(contextualPrompt)
        setResult('提示词已复制')
      } else {
        const response = await window.luna.externalAgent.startTask(selection.agent.id, { prompt: contextualPrompt })
        setResult(response.mode === 'draft' ? '任务已预填，请确认发送' : '提示词已复制，请粘贴发送')
      }
    } catch (value) { setError(value instanceof Error ? value.message : '发起任务失败') }
    finally { pending.current = false; setBusy(false) }
  }
  async function updateCurrent() {
    if (pending.current || !snapshot.session || !request.trim()) return
    pending.current = true
    setBusy(true)
    try {
      await window.luna.aiEditor.agent.updateRequest(snapshot.session.sessionId, request.trim())
      setRequest('')
      setError('')
    } catch { setError('更新任务失败') }
    finally { pending.current = false; setBusy(false) }
  }
  const { agent, installed } = selection
  const visibleError = error || selection.error || activityError
  return <Dialog open={open} title="AI 助手" className="agent-chat-panel" modal={false} showOverlay={false} closeOnMaskClick={false} bodyClassName="agent-chat-body"
    onOpenChange={next => { if (!pending.current) onOpenChange(next) }} footer={<>
      <Button size="compact" disabled={busy || !request.trim()} onClick={() => void launch(true)}>复制提示词</Button>
      {sessionActive ? <Button size="compact" variant="primary" disabled={busy || !request.trim()}
        onClick={() => void updateCurrent()}>更新当前任务</Button>
        : <Button size="compact" variant="primary" disabled={busy || !request.trim() || installed !== true || agent?.capabilities.task === 'unsupported'}
          onClick={() => void launch(false)}>{busy ? '发起中' : '发起任务'}</Button>}
    </>}>
    <div id="global-agent-chat" className="agent-chat-toolbar">
      <Select variant="compact" placeholder="选择 Agent" value={selection.agentId} disabled={busy}
        options={selection.agents.map(value => ({ value: value.id, label: value.name }))} onValueChange={selection.selectAgent} />
      <Select variant="compact" placeholder="任务类型" value={purpose} disabled={busy || Boolean(sessionActive)}
        options={[{ value: 'editing', label: 'AI 剪辑' }, { value: 'director-plan', label: '导演计划' }]}
        onValueChange={value => setPurpose(value as AgentChatContext['purpose'])} />
    </div>
    <AgentActivity snapshot={snapshot} onError={setError} />
    <Textarea className="agent-chat-request" aria-label="任务要求" placeholder="任务要求" rows={4}
      maxLength={6000} disabled={busy} value={request}
      onChange={event => { setRequest(event.target.value); setError(''); setResult('') }} />
    {visibleError && <Alert variant="error" message={visibleError} />}
    {result && <p className="agent-chat-result" role="status">{result}</p>}
  </Dialog>
}
