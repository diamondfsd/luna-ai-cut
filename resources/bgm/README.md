# Luna BGM Resources

This directory contains the self-contained background-music runtime used by the
`luna-bgm-worker` native process.

- `templates/`: compact `.bgm` arrangements and the machine-readable catalogs.
- `soundfonts/GeneralUser.sf2`: pinned GeneralUser GS SoundFont, downloaded by
  `scripts/copy-bgm-assets.mjs` and verified by SHA256. The binary is ignored by
  Git and is copied into packaged builds.
- `licenses/`: notices for the pure-Rust SoundFont synthesizer dependency.

The renderer is pure Rust and does not invoke FluidSynth or any system audio
binary. The worker compiles the compact DSL to MIDI events, renders a
44.1 kHz/16-bit stereo WAV with the bundled SoundFont, and returns a local media
identifier to the Luna editing flow.

The normal local build downloads the SoundFont from the GitCode
`build-dependencies-v1.0.0` release:

`https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/build-dependencies-v1.0.0/GeneralUser.sf2`

The upstream GitHub URL is retained only as provenance and as the GitHub
Actions build source.
