import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  await server.ssrLoadModule('/scripts/test-ai-selection.mjs')
} finally {
  await server.close()
}
