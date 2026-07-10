import { useEffect, useRef, useState } from 'react'

export function useTripleStitchPlayback(duration: number) {
  const [playing, setPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTime, setSeekTime] = useState(0)
  const currentTimeRef = useRef(0)

  useEffect(() => {
    if (!playing) return

    const startedAt = performance.now() - currentTimeRef.current * 1000
    let animationFrame = 0

    function updateProgress(now: number): void {
      const nextTime = Math.min(duration, (now - startedAt) / 1000)
      currentTimeRef.current = nextTime
      setCurrentTime(nextTime)
      if (nextTime >= duration) {
        setSeekTime(duration)
        setPlaying(false)
        return
      }
      animationFrame = requestAnimationFrame(updateProgress)
    }

    animationFrame = requestAnimationFrame(updateProgress)
    return () => cancelAnimationFrame(animationFrame)
  }, [duration, playing])

  function pause(): void {
    setSeekTime(currentTimeRef.current)
    setPlaying(false)
  }

  function seek(time: number): void {
    const nextTime = Math.min(duration, Math.max(0, time))
    currentTimeRef.current = nextTime
    setCurrentTime(nextTime)
    setSeekTime(nextTime)
    setPlaying(false)
  }

  function toggle(): void {
    if (playing) {
      pause()
      return
    }
    if (currentTimeRef.current >= duration) {
      currentTimeRef.current = 0
      setCurrentTime(0)
      setSeekTime(0)
    }
    setPlaying(true)
  }

  function reset(): void {
    currentTimeRef.current = 0
    setCurrentTime(0)
    setSeekTime(0)
    setPlaying(false)
  }

  return { currentTime, pause, playing, reset, seek, seekTime, toggle }
}
