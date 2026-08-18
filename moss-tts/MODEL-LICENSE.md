# MOSS-TTS-Nano Model Resources

Luna downloads these resources on first use. No model weights are included in
the application or source repository.

## Sources and licenses

- TTS ONNX: `openmoss/MOSS-TTS-Nano-100M-ONNX`
  - ModelScope revision: `0badeaff90722f01b5c727d991d750531cb802e0`
  - License declared by the repository: Apache-2.0
- Audio tokenizer ONNX: `openmoss/MOSS-Audio-Tokenizer-Nano-ONNX`
  - ModelScope revision: `82a897035d9ff72803df10a06c1a5aa6691be0f8`
  - License declared by the repository: Apache-2.0
- Inference source: `https://github.com/OpenMOSS/MOSS-TTS-Nano`
  - Commit: `cc7bdf19c7639c0870dab22045a33b442760f6be`
  - License: Apache-2.0; the copied license is at `licenses/MOSS-TTS-Nano-LICENSE`.

The application fetches only from ModelScope using the fixed revisions above.
Each file is checked by its expected byte count and SHA256 before it becomes
available to the runtime. The complete file manifest and hashes are kept in
`electron/mossTtsService.ts`.

The model card and any additional upstream terms remain part of the model
repositories and should be reviewed before changing the application's usage
or distribution scope.
