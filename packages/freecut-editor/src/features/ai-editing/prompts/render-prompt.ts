const PLACEHOLDER_PATTERN = /{{([A-Z][A-Z0-9_]*)}}/g

export function renderPrompt(template: string, values: Record<string, string>): string {
  const rendered = template.replace(PLACEHOLDER_PATTERN, (_placeholder, key: string) => {
    if (!(key in values)) throw new Error(`Missing prompt value: ${key}`)
    return values[key] ?? ''
  })
  const unresolved = rendered.match(PLACEHOLDER_PATTERN)
  if (unresolved) throw new Error(`Unresolved prompt value: ${unresolved[0]}`)
  return rendered.trim()
}
