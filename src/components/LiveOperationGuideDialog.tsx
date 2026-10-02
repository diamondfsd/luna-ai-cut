import type { ReactNode } from 'react'
import { ArrowRight, Camera, HelpCircle, Laptop, Plus, SlidersHorizontal, Smartphone, Usb, Video, Wifi } from 'lucide-react'
import { Button, Dialog } from '../ui'
import lunaKaLogo from '../assets/mobile-app/luna-ka-icon.jpg'
import './LiveOperationGuideDialog.css'

function GuideScreen({ children }: { children: ReactNode }) {
  return <div className="live-operation-screen"><div className="live-operation-screen-bar"><i /><i /><i /></div><div className="live-operation-screen-content">{children}</div></div>
}

export function LiveOperationGuideDialog() {
  const steps = [
    { text: '在手机 Luna 咔中连接相机。',
      image: <><div className="live-operation-phone"><img src={lunaKaLogo} alt="" /></div><Wifi size={20} /><Camera size={40} strokeWidth={1.5} /></> },
    { text: '用 USB 线连接手机和电脑。',
      image: <><Smartphone size={45} strokeWidth={1.5} /><div className="live-operation-usb"><Usb size={20} /><span /></div><Laptop size={62} strokeWidth={1.5} /></> },
    { text: '点击“获取画面”，等待预览区出现画面。',
      image: <GuideScreen><Camera size={30} strokeWidth={1.5} /><span className="live-operation-action"><Video size={12} />获取画面</span></GuideScreen> },
    { text: '可调整水印和色彩；点击“打开直播窗口”打开独立预览。',
      image: <><SlidersHorizontal size={28} /><ArrowRight size={19} /><GuideScreen><Camera size={29} strokeWidth={1.5} /><span>打开直播窗口</span></GuideScreen></> },
    { text: '打开抖音直播伴侣，在场景中添加“窗口画面”，选择直播预览窗口。',
      image: <><GuideScreen><Plus size={25} /><span>窗口画面</span></GuideScreen><ArrowRight size={19} /><GuideScreen><Camera size={29} strokeWidth={1.5} /></GuideScreen></> },
  ]
  return (
    <Dialog title="操作说明" tone="dark" className="live-operation-guide-dialog"
      trigger={<Button variant="secondary" size="compact" icon={<HelpCircle size={14} />}>操作说明</Button>}>
      <ol className="live-operation-steps">
        {steps.map((step, index) => <li key={step.text}>
          <div className="live-operation-illustration" aria-hidden="true">{step.image}</div>
          <div className="live-operation-caption"><span aria-hidden="true">{index + 1}</span><p>{step.text}</p></div>
        </li>)}
      </ol>
    </Dialog>
  )
}
