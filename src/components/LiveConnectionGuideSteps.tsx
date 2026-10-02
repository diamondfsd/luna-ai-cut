import type { ReactNode } from 'react'
import { Camera, Check, Laptop, Usb, Wifi } from 'lucide-react'
import lunaKaLogo from '../assets/mobile-app/luna-ka-icon.jpg'
import './LiveConnectionGuideSteps.css'

function GuidePhone({ children }: { children: ReactNode }) {
  return <div className="live-guide-phone"><div className="live-guide-phone-screen">{children}</div></div>
}

export function LiveConnectionGuideSteps({ platform }: { platform: 'ios' | 'android' }) {
  const apple = platform === 'ios'
  const steps = [
    {
      text: '打开 Luna 咔，连接相机。',
      illustration: <><GuidePhone><img src={lunaKaLogo} alt="" /></GuidePhone><Wifi size={19} className="live-guide-accent" /><Camera size={35} strokeWidth={1.5} /></>,
    },
    {
      text: apple ? '用 USB 数据线连接 iPhone 和电脑。' : '用 USB 数据线连接手机和电脑。',
      illustration: <><GuidePhone><Usb size={23} className="live-guide-accent" /></GuidePhone><div className="live-guide-cable"><Usb size={15} /></div><Laptop size={49} strokeWidth={1.5} /></>,
    },
    {
      text: apple ? '解锁 iPhone，选择“信任”此电脑。' : '出现 USB 配件提示时，允许 Luna 咔打开。',
      illustration: <GuidePhone><Check size={25} className="live-guide-accent" /><span className="live-guide-permission">{apple ? '信任' : '允许'}</span></GuidePhone>,
    },
  ]
  return (
    <ol className="live-guide-steps">
      {steps.map((step, index) => <li key={step.text}>
        <div className="live-guide-illustration" aria-hidden="true">{step.illustration}</div>
        <div className="live-guide-step-caption"><span className="live-guide-step-number" aria-hidden="true">{index + 1}</span><p>{step.text}</p></div>
      </li>)}
    </ol>
  )
}
