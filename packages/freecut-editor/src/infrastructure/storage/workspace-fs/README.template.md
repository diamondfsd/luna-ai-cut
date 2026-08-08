# FreeCut Workspace

This folder is your FreeCut project workspace - the app's source of truth
for everything: projects, media metadata, thumbnails, waveforms, caches.

Everything here is **plain files** you can `cat`, `grep`, and diff with
normal tools. AI coding agents can read them directly without a browser.

## Layout

```
./
|-- README.md                  <- this file
|-- .freecut-workspace.json    <- marker + schema version
|-- index.json                 <- fast project list
|-- ai-editing-skills.json     <- enabled editing skills and custom style guides
|-- projects/
|   `-- <projectId>/
|       |-- project.json       <- timeline, settings, keyframes, markers, transitions
|       |-- thumbnail.jpg
|       |-- media-links.json   <- which media this project uses
|       `-- ai-editing-runs.json <- editing assistant plans and completion checks
|-- media/
|   `-- <mediaId>/
|       |-- metadata.json      <- codec, duration, resolution, etc.
|       |-- source.<ext>       <- inline source file
|       |-- source.link.json   <- OR a link descriptor to an external file
|       |-- thumbnail.jpg
|       `-- cache/
|           |-- filmstrip/     <- timeline frame thumbnails (0.jpg, 1.jpg, ...)
|           |-- waveform/      <- audio peaks (binned binary + multi-res.bin)
|           |-- gif-frames/    <- pre-extracted GIF frames
|           |-- decoded-audio/ <- chunked PCM for preview playback
|           |-- preview-audio.wav  <- conformed WAV for non-browser codecs
|           `-- ai/            <- transcripts, captions, scene cuts, ...
`-- content/
    |-- <hash[0:2]>/<hash>/    <- content-addressable source dedup (reserved)
    |   |-- refs.json
    |   `-- data.<ext>
    `-- proxies/<proxyKey>/    <- shared proxies (keyed by content fingerprint)
        |-- proxy.mp4
        `-- meta.json
```

## Safe to edit?

Everything except media source bytes is safe to inspect. Editing
`project.json` externally works; FreeCut picks up changes on next load.

Binary caches (waveforms, decoded audio, filmstrips) are regeneratable -
delete them and the app will rebuild them on demand.

## Workspace location

The desktop app creates and opens this folder automatically under its local
application data directory. Browser deployments may ask you to grant access to
the folder again after it is moved.
