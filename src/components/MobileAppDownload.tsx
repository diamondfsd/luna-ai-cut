import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download } from 'lucide-react'
import { Button, Dialog, LoadingIndicator, type ButtonSize } from '../ui'
import lunaKaLogo from '../assets/mobile-app/luna-ka-icon.jpg'
import './MobileAppDownload.css'

const MOBILE_APP_DOWNLOAD_URLS = {
  ios: 'https://testflight.apple.com/join/7f59YZEH',
  android: 'https://lunaka.diamondfsd.com/',
  harmony: 'https://appgallery.huawei.com/link/invite-test-wap?taskId=4701706546eacd13761d03da9e109b8b&invitationCode=5Z1nVRaK8Di',
}

export type MobileAppPlatform = keyof typeof MOBILE_APP_DOWNLOAD_URLS

export function MobileAppDownloadQr({ platform }: { platform: MobileAppPlatform }) {
  const label = { ios: 'iOS', android: '安卓', harmony: '鸿蒙' }[platform]
  const url = MOBILE_APP_DOWNLOAD_URLS[platform]
  const [generated, setGenerated] = useState<{ url: string; image: string | null; failed: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(url, { width: 400, margin: 4, errorCorrectionLevel: 'H' }).then(image => {
      if (!cancelled) setGenerated({ url, image, failed: false })
    }).catch(() => {
      if (!cancelled) setGenerated({ url, image: null, failed: true })
    })
    return () => { cancelled = true }
  }, [url])
  const current = generated?.url === url ? generated : null
  return (
    <figure className="mobile-app-download-code">
      <div className="mobile-app-download-image">
        {current?.image
          ? <><img className="mobile-app-download-qr" src={current.image} alt={`${label} App 下载二维码`} width={200} height={200} />
            <img className="mobile-app-download-logo" src={lunaKaLogo} alt="" /></>
          : current?.failed ? <span role="alert">二维码生成失败</span> : <LoadingIndicator />}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

export function MobileAppDownloadButton({ size = 'compact' }: { size?: ButtonSize }) {
  return (
    <Dialog title="下载 App" className="mobile-app-download-dialog" bodyClassName="mobile-app-download-body"
      trigger={<Button variant="secondary" size={size} icon={<Download size={14} />}>下载 App</Button>}>
      <MobileAppDownloadQr platform="ios" />
      <MobileAppDownloadQr platform="android" />
      <MobileAppDownloadQr platform="harmony" />
    </Dialog>
  )
}
