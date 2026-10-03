import { Button, Dialog } from '../ui'
import type { LiveStreamStatus } from '../shared/types'
import { AppleDriverDownloadButton } from './AppleDriverDownloadButton'
import { MobileAppDownloadQr, type MobileAppPlatform } from './MobileAppDownload'
import { LiveConnectionGuideSteps } from './LiveConnectionGuideSteps'
import lunaKaLogo from '../assets/mobile-app/luna-ka-icon.jpg'
import './LiveConnectionGuides.css'

function GuideDownload({ platform }: { platform: MobileAppPlatform }) {
  return <aside className="live-guide-download">
    <div className="live-guide-app"><img src={lunaKaLogo} alt="Luna 咔 Logo" width={36} height={36} /><strong>Luna 咔</strong></div>
    <MobileAppDownloadQr platform={platform} />
  </aside>
}

export function LiveConnectionGuides({ status }: { status: LiveStreamStatus }) {
  return (
    <div className="live-connection-guides">
      <Dialog title="苹果连接指引" className="live-connection-guide-dialog" bodyClassName="live-connection-guide-body"
        trigger={<Button variant="ghost" size="mini">苹果连接指引</Button>}>
        <div className="live-guide-instructions">
        <LiveConnectionGuideSteps platform="ios" />
        {status.platform === 'win32' && status.appleDeviceSupport === 'missing' && (
          <>
            <p>安装苹果设备驱动后重新连接。</p>
            <AppleDriverDownloadButton status={status.appleDriverDownload} />
          </>
        )}
        {status.platform === 'win32' && status.appleDeviceSupport === 'stopped' && (
          <p>请在系统服务中启动 Apple Mobile Device Service。</p>
        )}
        {status.platform === 'win32' && status.appleDeviceSupport === 'unavailable' && (
          <p>苹果设备服务不可用，请重启电脑后重试。</p>
        )}
        </div>
        <GuideDownload platform="ios" />
      </Dialog>
      <Dialog title="安卓连接指引" className="live-connection-guide-dialog" bodyClassName="live-connection-guide-body"
        trigger={<Button variant="ghost" size="mini">安卓连接指引</Button>}>
        <div className="live-guide-instructions">
        <LiveConnectionGuideSteps platform="android" />
        <p>无法连接时：在手机“关于手机”中连续点击“版本号”，开启开发者模式，并开启 USB 调试，再重新连接。</p>
        </div>
        <GuideDownload platform="android" />
      </Dialog>
      <Dialog title="鸿蒙原生连接指引" className="live-connection-guide-dialog" bodyClassName="live-connection-guide-body"
        trigger={<Button variant="ghost" size="mini">鸿蒙原生连接指引</Button>}>
        <div className="live-guide-instructions">
          <LiveConnectionGuideSteps platform="harmony" />
          <p>使用支持直播的鸿蒙原生 Luna 咔版本，保持相机页面在前台。</p>
        </div>
        <GuideDownload platform="harmony" />
      </Dialog>
    </div>
  )
}
