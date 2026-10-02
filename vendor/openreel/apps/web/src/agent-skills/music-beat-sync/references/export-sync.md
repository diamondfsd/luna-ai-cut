# Export sync calibration

Use when the user reports late/early picture changes or the exported file differs from the timeline. The user does not need to request diagnostic steps or provide timing parameters.

1. Read the audio clip's start, source in-point and speed. Map score/source times to timeline seconds before comparing visual boundaries. For generated music, retain its actual MIDI phase; do not detect a new phase from a melody onset.
2. At the export frame rate, use nearest-frame visual boundaries. Check real picture changes in the exported file against intended boundaries and compare its decoded audio with the source waveform. A correct timeline is not proof of correct output. Use available application verification tools; if these measurements are unavailable, report that limit rather than inventing results or installing a new analysis stack.
3. If the output audio has a measured offset, keep that measurement separate from score timing. Choose a nearest-frame visual correction, edit boundaries through normal clip tools, adjust adjacent durations to preserve coverage, and retain the requested beginning and ending. Keep source ranges usable. Re-export only within the existing user authorization and application confirmation flow, then verify the new file.
4. Record source timing, actual exported boundary times, residual error and scope of the measurement. Aim for less than one output frame. Reuse calibration only when the same export conditions have been verified; do not silently shift the score or claim universal codec latency.

Observed case: a 120 BPM generated montage was incorrectly anchored to a melody onset around 0.267 s instead of the score's 0/0.5/1 s grid. After adopting actual MIDI timing, the tested macOS AAC export added 44 ms relative to its WAV. A measured 1/30 s visual correction left approximately 10.7 ms difference in that output. **120 BPM, 44 ms and one-frame correction are case evidence, not defaults.** Other tempos, sample rates, platforms, codecs and encoder versions require their own evidence.

An ordinary editing request does not authorize a diagnostic export. Keep the editable timeline as the deliverable unless export is already requested. Do not rewrite the user's request to manufacture authorization.
