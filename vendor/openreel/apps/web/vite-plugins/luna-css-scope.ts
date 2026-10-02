import { list } from "postcss"
// Scope every imported stylesheet, including lazy chunks and design-system resets.
export function lunaCssScope() {
  return {
    postcssPlugin: 'luna-openreel-css-scope',
    Rule(rule: { selector: string; parent?: { type?: string; name?: string } }) {
      if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name ?? '')) return
      rule.selector = list.comma(rule.selector).map(selector => {
        const value = selector.trim()
        if (value.startsWith('.luna-openreel')) return value
        if (/^(:root|html|body)(?=[\s.:#\[]|$)/.test(value)) {
          return value.replace(/^(:root|html|body)/, '.luna-openreel')
        }
        return `.luna-openreel ${value}`
      }).join(', ')
    },
  }
}
