import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download } from 'lucide-react'
import { Button, Dialog, LoadingIndicator, type ButtonSize } from '../ui'
import './MobileAppDownload.css'

const MOBILE_APP_DOWNLOAD_URLS = {
  ios: 'https://testflight.apple.com/join/7f59YZEH',
  android: 'https://lunaka.diamondfsd.com/',
}

export function MobileAppDownloadQr({ platform }: { platform: 'ios' | 'android' }) {
  const label = platform === 'ios' ? 'iOS' : '安卓'
  const url = MOBILE_APP_DOWNLOAD_URLS[platform]
  const [generated, setGenerated] = useState<{ url: string; image: string | null; failed: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    void QRCode.toDataURL(url, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).then(image => {
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
          ? <img src={current.image} alt={`${label} App 下载二维码`} width={200} height={200} />
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
    </Dialog>
  )
}
