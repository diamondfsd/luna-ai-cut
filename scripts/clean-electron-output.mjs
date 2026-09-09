import { rmSync } from 'node:fs'

rmSync('dist-electron', { recursive: true, force: true })
