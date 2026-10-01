import { Download } from 'lucide-react'
import { Button, Dialog } from '../ui'
import type { LiveStreamStatus } from '../shared/types'
import { AppleDriverDownloadButton } from './AppleDriverDownloadButton'
import './LiveConnectionGuides.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

function DownloadMobileApp() {
  return (
    <Button variant="secondary" size="compact" icon={<Download size={14} />}
      onClick={() => void window.luna.openPath(MOBILE_APP_DOWNLOAD_URL)}>
      下载 App
    </Button>
  )
}

export function LiveConnectionGuides({ status }: { status: LiveStreamStatus }) {
  return (
    <div className="live-connection-guides">
      <Dialog title="苹果连接指引" bodyClassName="live-connection-guide-body"
        trigger={<Button variant="ghost" size="mini">苹果连接指引</Button>}>
        <ol>
          <li>打开 Luna 咔，连接相机。</li>
          <li>用 USB 数据线连接 iPhone 和电脑。</li>
          <li>解锁 iPhone，选择“信任”此电脑。</li>
        </ol>
        <DownloadMobileApp />
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
      </Dialog>
      <Dialog title="安卓连接指引" bodyClassName="live-connection-guide-body"
        trigger={<Button variant="ghost" size="mini">安卓连接指引</Button>}>
        <ol>
          <li>打开 Luna 咔，连接相机。</li>
          <li>用 USB 数据线连接手机和电脑。</li>
          <li>出现 USB 配件提示时，允许 Luna 咔打开。</li>
        </ol>
        <DownloadMobileApp />
        <p>无法连接时：在手机“关于手机”中连续点击“版本号”，开启开发者模式，再重新连接。</p>
      </Dialog>
    </div>
  )
}
