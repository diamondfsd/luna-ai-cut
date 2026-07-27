import { Heart } from 'lucide-react'

import { Button, Dialog } from '../ui'
import wechatSupportCode from '../../public/wechat-start-code.png'
import './SupportDialog.css'

interface SupportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SupportDialog({ open, onOpenChange }: SupportDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="支持 Luna AI Cut"
      description="自愿支持项目持续更新"
      className="support-dialog-content"
      footer={(
        <Button variant="primary" icon={<Heart size={14} />} onClick={() => onOpenChange(false)}>
          完成
        </Button>
      )}
    >
      <div className="ui-dialog-body support-dialog-body">
        <div className="support-dialog-copy">
          <p>Luna AI Cut 目前由个人利用业余时间开发和维护。</p>
          <p>如果它为你节省了时间，欢迎自愿支持项目持续更新。</p>
          <p className="support-dialog-note">
            赞助不会影响软件的正常使用，<br />
            也不代表购买功能或技术服务。
          </p>
          <div className="support-dialog-thanks">
            <strong>不方便赞助也没关系。</strong>
            <p>
              提交 Bug、分享软件、参与测试、<br />
              给项目点一个 Star，都是对项目很大的帮助。
            </p>
          </div>
        </div>
        <figure className="support-dialog-code">
          <figcaption>微信赞赏</figcaption>
          <img src={wechatSupportCode} alt="Luna AI Cut 微信赞赏码" />
        </figure>
      </div>
    </Dialog>
  )
}
