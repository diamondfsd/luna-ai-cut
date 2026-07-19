import { defineConfig } from 'vite'
import * as path from 'node:path'

export default defineConfig({
  build: {
    ssr: path.resolve(process.cwd(), 'scripts/benchmark-ai-selection.ts'),
    outDir: process.env.LUNA_AI_SELECTION_BENCHMARK_OUT || 'dist-benchmark',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'benchmark-ai-selection.cjs', format: 'cjs' },
    },
  },
})
