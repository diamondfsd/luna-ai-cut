import { CheckCircle2, FolderOpen, Images, Layers3, Sparkles } from 'lucide-react'

import { Button } from '../ui'

interface AiSelectionWelcomeProps {
  busy: boolean
  onStart: () => void
}

const steps = [
  { icon: FolderOpen, title: '添加照片和视频', detail: '选择一次拍摄的素材文件夹' },
  { icon: Layers3, title: '比较相似内容', detail: '连拍和近似画面会放在一起' },
  { icon: Images, title: '勾选想保留的素材', detail: '先看推荐，再处理少量待确认内容' },
  { icon: CheckCircle2, title: '完成选片', detail: '带着已选素材进入剪辑工作台' },
]

export function AiSelectionWelcome({ busy, onStart }: AiSelectionWelcomeProps) {
  return <div className="ai-selection-empty">
    <div className="ai-selection-empty-icon"><Sparkles size={28} /></div>
    <h2>选择一个素材文件夹，开始选片</h2>
    <p>我们会把相似照片放在一起，先找出值得比较和需要留意的内容。</p>
    <div className="ai-selection-empty-steps">
      {steps.map(({ icon: Icon, title, detail }, index) => <div key={title}>
        <span><Icon size={16} /></span>
        <section><strong>{index + 1}. {title}</strong><small>{detail}</small></section>
      </div>)}
    </div>
    <Button variant="primary" icon={<FolderOpen size={16} />} disabled={busy} onClick={onStart}>选择素材文件夹</Button>
    <small className="ai-selection-safe-note">原文件保持不变，所有选择都可以撤销</small>
  </div>
}
