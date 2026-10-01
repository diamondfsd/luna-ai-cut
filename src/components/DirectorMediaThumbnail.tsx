import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'

export function DirectorMediaThumbnail({ url }: { url: string }) {
  const container = useRef<HTMLSpanElement>(null)
  const [thumbnail, setThumbnail] = useState<{ source: string; url: string } | null>(null)
  useEffect(() => {
    const element = container.current
    if (!element) return
    let disposed = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void window.luna.directorLab.prepareThumbnail(url).then((result) => {
        if (!disposed) setThumbnail({ source: url, url: result.url })
      }).catch(() => undefined)
    }, { rootMargin: '200px' })
    observer.observe(element)
    return () => { disposed = true; observer.disconnect() }
  }, [url])
  return <span ref={container} className="lab-media-thumbnail">
    {thumbnail?.source === url ? <img src={thumbnail.url} alt="" loading="lazy" /> : <Camera size={20} />}
  </span>
}
