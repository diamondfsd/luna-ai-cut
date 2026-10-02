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

`rhythmic-montage` is a complete original 120 BPM arrangement with seven
complementary layers and six sections: intro, groove, variation, break, climax
and ending. It targets travel/family/lifestyle montages and provides a clear
pulse for 0.5/1/2 second shot slots. Public-domain `*-seed` templates remain
melody sketches; arrange supporting parts before treating them as finished
montage music. Adjust section bar counts as well as `dur` so the requested
length includes an ending and does not leave an unscored tail.

Music-led montage skills select and analyze music before setting shot lengths.
Beat analysis returns no cut grid for undetected tempo rather than fabricating
a default 120 BPM grid. The regression `node scripts/test-music-beat-analysis.mjs`
checks silence, percussion over sustained harmony, eighth-note subdivision,
and the actual native-rendered layered template.

The normal local build downloads the SoundFont from the GitCode
`build-dependencies-v1.0.0` release:

`https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/build-dependencies-v1.0.0/GeneralUser.sf2`

The upstream GitHub URL is retained only as provenance and as the GitHub
Actions build source.
