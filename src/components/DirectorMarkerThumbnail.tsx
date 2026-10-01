import { useEffect, useRef, useState } from 'react'
import { ImageOff, Image } from 'lucide-react'
import './DirectorMarkerThumbnail.css'

export function DirectorMarkerThumbnail({ source, positionMs }: { source: string | null; positionMs: number }) {
  const container = useRef<HTMLSpanElement>(null)
  const [result, setResult] = useState<{ key: string; url: string | null } | null>(null)
  const key = `${source}\n${positionMs}`
  useEffect(() => {
    const element = container.current
    if (!element || !source || !Number.isSafeInteger(positionMs) || positionMs < 0) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      timer = setTimeout(() => {
        void window.luna.directorLab.prepareThumbnail(source, positionMs).then(thumbnail => {
          if (!disposed) setResult({ key, url: thumbnail.url })
        }).catch(() => { if (!disposed) setResult({ key, url: null }) })
      }, 250)
    }, { rootMargin: '100px' })
    observer.observe(element)
    return () => { disposed = true; observer.disconnect(); clearTimeout(timer) }
  }, [source, positionMs, key])
  return <span className="director-marker-thumbnail" ref={container}>
    {result?.key === key && result.url ? <img src={result.url} alt="标签对应画面" onError={() => setResult({ key, url: null })} />
      : !source || result?.key === key ? <ImageOff size={18} aria-label="暂时无法读取标签画面" /> : <Image size={18} aria-label="正在读取标签画面" />}
  </span>
}
