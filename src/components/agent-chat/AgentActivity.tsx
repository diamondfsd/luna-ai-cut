import type { AiEditorAgentSnapshot } from '../../shared/types'
import { Button } from '../../ui'

export function AgentActivity({ snapshot, onError, readOnly = false, originalRequest }: { snapshot: AiEditorAgentSnapshot; onError(message: string): void; readOnly?: boolean; originalRequest?: string }) {
  const { session, events } = snapshot
  async function action(run: () => Promise<unknown>) {
    try { await run() } catch { onError('操作失败') }
  }
  const messages = events.filter(event => ['session-created', 'request-updated', 'progress', 'result', 'error', 'cancelled'].includes(event.type))
  return <>
    <div className="agent-chat-messages" role="log" aria-label="任务记录">
      {originalRequest && !messages.some(event => event.type === 'session-created') && <article className="agent-chat-message"><span>你</span><p>{originalRequest}</p></article>}
      {!messages.length && !originalRequest && <p className="agent-chat-empty">暂无任务记录</p>}
      {messages.map(event => <article className="agent-chat-message" key={event.sequence}>
        <span>{event.type === 'session-created' || event.type === 'request-updated' ? '你' : event.session.agentType || 'Agent'}</span>
        <p>{event.type === 'session-created' || event.type === 'request-updated'
          ? event.type === 'session-created' ? originalRequest ?? event.session.request : event.session.request : event.type === 'result' ? event.session.result?.summary || event.session.message : ('message' in event ? event.message : '') || event.session.message}</p>
      </article>)}
    </div>
    {session && !readOnly && <div className="agent-chat-session-actions">
      {['queued', 'running'].includes(session.status) && <Button size="mini" variant="danger"
        onClick={() => void action(() => window.luna.aiEditor.agent.cancelRequest(session.sessionId))}>停止任务</Button>}
      {session.exportConfirmation === 'pending' && <>
        <Button size="mini" onClick={() => void action(() => window.luna.aiEditor.agent.denyExport(session.sessionId))}>取消导出</Button>
        <Button size="mini" variant="primary" onClick={() => void action(() => window.luna.aiEditor.agent.confirmExport(session.sessionId))}>确认导出</Button>
      </>}
    </div>}
  </>
}
