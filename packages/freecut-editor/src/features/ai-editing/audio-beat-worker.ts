import MusicTempo from 'music-tempo'

interface BeatWorkerRequest {
  id: string
  samples: ArrayBuffer
}

interface BeatWorkerResponse {
  id: string
  tempo: number
  beats: number[]
}

self.onmessage = (event: MessageEvent<BeatWorkerRequest>) => {
  const samples = new Float32Array(event.data.samples)
  const detector = new MusicTempo(samples)
  const tempo = Number(detector.tempo)
  const beats = detector.beats.filter((value) => Number.isFinite(value) && value >= 0)
  const response: BeatWorkerResponse = {
    id: event.data.id,
    tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : 0,
    beats,
  }
  self.postMessage(response)
}
