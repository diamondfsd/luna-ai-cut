import { useEffect, useRef, useState } from 'react'

interface LivePhotoPlayerProps {
  photoSrc: string
  videoSrc: string
  autoPlay?: boolean
  onError?: (message: string) => void
}

export function LivePhotoPlayer({ photoSrc, videoSrc, autoPlay = false, onError }: LivePhotoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const onErrorRef = useRef(onError)
  const [videoVisible, setVideoVisible] = useState(false)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let canceled = false
    setVideoVisible(false)
    video.currentTime = 0
    video.load()

    const play = (): void => {
      if (canceled) return
      void video.play().catch((error) => {
        if (!canceled) onErrorRef.current?.(error instanceof Error ? error.message : String(error))
      })
    }

    if (autoPlay) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        window.setTimeout(play, 60)
      } else {
        video.addEventListener('canplay', play, { once: true })
      }
    }

    return () => {
      canceled = true
      video.removeEventListener('canplay', play)
      video.pause()
    }
  }, [autoPlay, videoSrc])

  return (
    <div className="live-photo-player-host">
      <img className="live-photo-player-photo" src={photoSrc} alt="" draggable={false} />
      <video
        ref={videoRef}
        className={videoVisible ? 'live-photo-player-video is-visible' : 'live-photo-player-video'}
        src={videoSrc}
        poster={photoSrc}
        muted
        playsInline
        preload="auto"
        onCanPlay={() => setVideoVisible(true)}
        onPlaying={() => setVideoVisible(true)}
        onEnded={() => setVideoVisible(false)}
        onError={() => onErrorRef.current?.('LIVE 照片视频无法播放')}
      />
    </div>
  )
}
