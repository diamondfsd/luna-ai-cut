import { useEffect } from 'react'
import { Button } from '../ui'

export function ExternalAgentControl({ onReturn }: { onReturn: () => void }) {
  useEffect(() => {
    window.addEventListener('focus', onReturn)
    return () => window.removeEventListener('focus', onReturn)
  }, [onReturn])
  return <Button size="compact" variant="primary"
    onClick={() => void window.luna.externalAgent.openChat({ purpose: 'director-plan' })}>AI 创建</Button>
}
