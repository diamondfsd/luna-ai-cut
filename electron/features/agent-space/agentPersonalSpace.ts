import { homedir } from 'node:os'
import { join } from 'node:path'

/** Durable user-owned data; never derive these locations from app/userData/baseDir. */
export function agentPersonalSpace(homeDir = homedir()) {
  const root = join(homeDir, '.luna-ai-cut')
  return {
    root,
    memoryDir: join(root, 'memory'),
    conversationsDir: join(root, 'conversations'),
    endpointPath: join(root, 'mcp-endpoint.json'),
  }
}
