# Luna Virtual Microphone

This Core Audio AudioServerPlugIn publishes two 48 kHz stereo devices:

- `Luna Virtual Microphone`: visible input consumed by OBS, Zoom, Teams, and similar apps.
- `Luna Virtual Microphone Sink`: hidden output used by Luna Camera Host to feed PCM audio.

The hidden output and visible input share an in-process ring buffer. Audio and video remain separate
system devices; the live console controls the shared host pipeline and audio drift compensation.
