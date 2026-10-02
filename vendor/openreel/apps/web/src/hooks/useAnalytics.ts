type EventProperties = Record<string, string | number | boolean | null>;
const track = (_event: string, _properties?: EventProperties): void => {};
const identify = (_userId: string, _properties?: EventProperties): void => {};

/** Local compatibility hook. Analytics collection is removed. */
export function useAnalytics() {
  return { track, identify, isEnabled: false };
}

export const AnalyticsEvents = {
  PROJECT_CREATED: "project_created",
  PROJECT_OPENED: "project_opened",
  PROJECT_EXPORTED: "project_exported",
  CLIP_ADDED: "clip_added",
  TEXT_ADDED: "text_added",
  EFFECT_APPLIED: "effect_applied",
  PARTICLE_EFFECT_ADDED: "particle_effect_added",
  TEMPLATE_USED: "template_used",
} as const;
