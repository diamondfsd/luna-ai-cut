import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useAgentChat } from '../components/agent-chat/agentChatContext'
import { DirectorLabView } from '../components/DirectorLabView'
import { FootageSelectionPanel } from './FootageSelectionPanel'
import { LunaEditWorkspace } from './LunaEditWorkspace'
import './AiEditorPage.css'

type EditorTab = 'shooting' | 'footage' | 'editing'

interface AiEditorLocationState {
  projectId?: string | null
}

export function AiEditorPage({ active }: { active: boolean }): JSX.Element {
  const location = useLocation()
  const { setPageContext } = useAgentChat()
  const [tab, setTab] = useState<EditorTab>('shooting')
  const [projectId, setProjectId] = useState<string | null>(null)
  const state = location.state as AiEditorLocationState | null

  useEffect(() => {
    if (!active || !state || !('projectId' in state)) return
    setProjectId(state.projectId ?? null)
    setTab('editing')
  }, [active, location.key, state])

  useEffect(() => {
    if (active && tab === 'editing' && projectId) setPageContext({ projectId })
    else setPageContext({})
    return () => setPageContext({})
  }, [active, projectId, setPageContext, tab])

  return <main className="ai-editor-page">
    <nav className="ai-editor-subnav" aria-label="AI 导拍与剪辑">
      <div className="ai-editor-tabs" role="tablist">
        <button className="ai-editor-tab" role="tab" aria-selected={tab === 'shooting'} onClick={() => setTab('shooting')}>拍摄计划</button>
        <button className="ai-editor-tab" role="tab" aria-selected={tab === 'footage'} onClick={() => setTab('footage')}>素材点赞评论</button>
        <button className="ai-editor-tab" role="tab" aria-selected={tab === 'editing'} onClick={() => setTab('editing')}>AI 剪辑</button>
      </div>
    </nav>
    <div className="ai-editor-main">
      {tab === 'shooting' && <DirectorLabView active={active} />}
      {tab === 'footage' && <FootageSelectionPanel active={active} />}
      {tab === 'editing' && <LunaEditWorkspace active={active} projectId={projectId} onProjectIdChange={setProjectId} />}
    </div>
  </main>
}
