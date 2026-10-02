import { useEffect, useState } from 'react'
import type { ExternalAgentDescriptor } from '../../shared/types/externalAgent'

export function useAgentSelection() {
  const [agents, setAgents] = useState<ExternalAgentDescriptor[]>([])
  const [agentId, setAgentId] = useState('')
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    window.luna.externalAgent.list().then(values => {
      if (!active) return
      setAgents(values)
      setAgentId(values[0]?.id ?? '')
    }).catch(() => { if (active) setError('无法获取 Agent') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    let generation = 0
    setInstalled(null)
    const check = () => {
      if (!agentId) return
      const current = ++generation
      window.luna.externalAgent.isInstalled(agentId).then(value => {
        if (active && current === generation) { setInstalled(value); setError('') }
      }).catch(() => { if (active && current === generation) setError('无法检测 Agent') })
    }
    check()
    window.addEventListener('focus', check)
    return () => { active = false; window.removeEventListener('focus', check) }
  }, [agentId])
  return {
    agents, agentId, installed, error,
    agent: agents.find(value => value.id === agentId),
    selectAgent: (id: string) => { setInstalled(null); setAgentId(id) },
  }
}
