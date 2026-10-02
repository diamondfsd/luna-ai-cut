import { useRef, useState } from 'react'
import { Alert, Button, Dialog } from '../ui'
import type { ExternalAgentDescriptor } from '../shared/types/externalAgent'
import { buildDirectorPlanAgentPrompt } from '../lib/directorPlanAgentPrompt'
import './DirectorPlanAiCreateDialog.css'

interface Props {
  open: boolean
  agent: ExternalAgentDescriptor
  onOpenChange(open: boolean): void
}

export function DirectorPlanAiCreateDialog({ open, agent, onOpenChange }: Props) {
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  async function launch(copyOnly: boolean) {
    if (pending.current || !request.trim()) return
    pending.current = true
    setBusy(true)
    setError('')
    setResult('')
    try {
      const connection = await window.luna.aiEditor.mcp.getHttpConnection()
      if (!connection) throw new Error('暂时无法连接，请重试')
      const prompt = buildDirectorPlanAgentPrompt(connection, request)
      if (copyOnly) {
        await window.luna.copyText(prompt)
        setResult('提示词已复制')
      } else {
        const response = await window.luna.externalAgent.startTask(agent.id, { prompt })
        setResult(response.mode === 'draft' ? '任务已预填，请确认发送' : '提示词已复制，请粘贴发送')
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : '发起任务失败')
    } finally { pending.current = false; setBusy(false) }
  }
  return <Dialog open={open} title="AI 创建" description={agent.name}
    onOpenChange={next => { if (!pending.current) onOpenChange(next) }}
    className="director-plan-ai-create-dialog" footer={<>
      <Button size="compact" disabled={busy || !request.trim()} onClick={() => void launch(true)}>复制提示词</Button>
      <Button size="compact" variant="primary" disabled={busy || !request.trim()} onClick={() => void launch(false)}>
        {busy ? '发起中' : '发起任务'}
      </Button>
    </>}>
    <textarea className="ui-input ui-input-compact director-plan-ai-create-request" aria-label="计划要求"
      placeholder="计划要求" maxLength={6000} value={request} disabled={busy}
      onChange={event => { setRequest(event.target.value); setError(''); setResult('') }} />
    {error && <Alert variant="error" message={error} />}
    {result && <p role="status">{result}</p>}
  </Dialog>
}
