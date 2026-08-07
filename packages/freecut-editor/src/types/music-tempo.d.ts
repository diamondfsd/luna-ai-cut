declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array)
    tempo: number | string
    beats: number[]
  }
}
