export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "add"
  | "subtract";

export interface BlendModeSettings {
  mode: BlendMode;
  opacity: number;
}

export class BlendModeEngine {
  applyBlendMode(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    mode: BlendMode,
  ): void {
    switch (mode) {
      case "normal":
        ctx.globalCompositeOperation = "source-over";
        break;
      case "multiply":
        ctx.globalCompositeOperation = "multiply";
        break;
      case "screen":
        ctx.globalCompositeOperation = "screen";
        break;
      case "overlay":
        ctx.globalCompositeOperation = "overlay";
        break;
      case "darken":
        ctx.globalCompositeOperation = "darken";
        break;
      case "lighten":
        ctx.globalCompositeOperation = "lighten";
        break;
      case "color-dodge":
        ctx.globalCompositeOperation = "color-dodge";
        break;
      case "color-burn":
        ctx.globalCompositeOperation = "color-burn";
        break;
      case "hard-light":
        ctx.globalCompositeOperation = "hard-light";
        break;
      case "soft-light":
        ctx.globalCompositeOperation = "soft-light";
        break;
      case "difference":
        ctx.globalCompositeOperation = "difference";
        break;
      case "exclusion":
        ctx.globalCompositeOperation = "exclusion";
        break;
      case "add":
        ctx.globalCompositeOperation = "lighter";
        break;
      case "subtract":
        ctx.globalCompositeOperation = "difference";
        break;
    }
  }

  getBlendShader(mode: BlendMode): string {
    const blendFunctions: Record<BlendMode, string> = {
      normal: `
 vec4 blend(vec4 base, vec4 blend) {
 return blend;
 }
 `,
      multiply: `
 vec4 blend(vec4 base, vec4 blend) {
 return base * blend;
 }
 `,
      screen: `
 vec4 blend(vec4 base, vec4 blend) {
 return 1.0 - (1.0 - base) * (1.0 - blend);
 }
 `,
      overlay: `
 vec4 blend(vec4 base, vec4 blend) {
 vec4 result;
 result.r = base.r < 0.5 ? 2.0 * base.r * blend.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r);
 result.g = base.g < 0.5 ? 2.0 * base.g * blend.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g);
 result.b = base.b < 0.5 ? 2.0 * base.b * blend.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b);
 result.a = blend.a;
 return result;
 }
 `,
      darken: `
 vec4 blend(vec4 base, vec4 blend) {
 return min(base, blend);
 }
 `,
      lighten: `
 vec4 blend(vec4 base, vec4 blend) {
 return max(base, blend);
 }
 `,
      "color-dodge": `
 vec4 blend(vec4 base, vec4 blend) {
 vec4 result;
 result.r = blend.r == 1.0 ? 1.0 : min(base.r / (1.0 - blend.r), 1.0);
 result.g = blend.g == 1.0 ? 1.0 : min(base.g / (1.0 - blend.g), 1.0);
 result.b = blend.b == 1.0 ? 1.0 : min(base.b / (1.0 - blend.b), 1.0);
 result.a = blend.a;
 return result;
 }
 `,
      "color-burn": `
 vec4 blend(vec4 base, vec4 blend) {
 vec4 result;
 result.r = blend.r == 0.0 ? 0.0 : 1.0 - min((1.0 - base.r) / blend.r, 1.0);
 result.g = blend.g == 0.0 ? 0.0 : 1.0 - min((1.0 - base.g) / blend.g, 1.0);
 result.b = blend.b == 0.0 ? 0.0 : 1.0 - min((1.0 - base.b) / blend.b, 1.0);
 result.a = blend.a;
 return result;
 }
 `,
      "hard-light": `
 vec4 blend(vec4 base, vec4 blend) {
 vec4 result;
 result.r = blend.r < 0.5 ? 2.0 * base.r * blend.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r);
 result.g = blend.g < 0.5 ? 2.0 * base.g * blend.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g);
 result.b = blend.b < 0.5 ? 2.0 * base.b * blend.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b);
 result.a = blend.a;
 return result;
 }
 `,
      "soft-light": `
 vec4 blend(vec4 base, vec4 blend) {
 vec4 result;
 result.r = blend.r < 0.5 ? 2.0 * base.r * blend.r + base.r * base.r * (1.0 - 2.0 * blend.r) : 2.0 * base.r * (1.0 - blend.r) + sqrt(base.r) * (2.0 * blend.r - 1.0);
 result.g = blend.g < 0.5 ? 2.0 * base.g * blend.g + base.g * base.g * (1.0 - 2.0 * blend.g) : 2.0 * base.g * (1.0 - blend.g) + sqrt(base.g) * (2.0 * blend.g - 1.0);
 result.b = blend.b < 0.5 ? 2.0 * base.b * blend.b + base.b * base.b * (1.0 - 2.0 * blend.b) : 2.0 * base.b * (1.0 - blend.b) + sqrt(base.b) * (2.0 * blend.b - 1.0);
 result.a = blend.a;
 return result;
 }
 `,
      difference: `
 vec4 blend(vec4 base, vec4 blend) {
 return abs(base - blend);
 }
 `,
      exclusion: `
 vec4 blend(vec4 base, vec4 blend) {
 return base + blend - 2.0 * base * blend;
 }
 `,
      add: `
 vec4 blend(vec4 base, vec4 blend) {
 return min(base + blend, 1.0);
 }
 `,
      subtract: `
 vec4 blend(vec4 base, vec4 blend) {
 return max(base - blend, 0.0);
 }
 `,
    };

    return blendFunctions[mode] || blendFunctions.normal;
  }
}

export const blendModeEngine = new BlendModeEngine();
