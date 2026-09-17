/**
 * Effects Compute Shader - GPU-accelerated video effects processing
 *
 * Implements brightness, contrast, saturation adjustments and hue rotation
 * using HSV conversion for accurate color manipulation.
 *
 */

// Effect parameters uniform buffer
struct EffectUniforms {
    brightness: f32,    // -1 to 1
    contrast: f32,      // 0 to 2 (1 = no change)
    saturation: f32,    // 0 to 2 (1 = no change)
    hue: f32,           // 0 to 360 degrees
    temperature: f32,   // -1 to 1 (cool to warm)
    tint: f32,          // -1 to 1 (green to magenta)
    shadows: f32,       // -1 to 1
    highlights: f32,    // -1 to 1
};

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
    padding: vec2<u32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> effects: EffectUniforms;
@group(0) @binding(3) var<uniform> dimensions: Dimensions;

// Convert RGB to HSV
fn rgb2hsv(rgb: vec3<f32>) -> vec3<f32> {
    let r = rgb.r;
    let g = rgb.g;
    let b = rgb.b;
    
    let maxC = max(max(r, g), b);
    let minC = min(min(r, g), b);
    let delta = maxC - minC;
    
    var h: f32 = 0.0;
    var s: f32 = 0.0;
    let v: f32 = maxC;
    
    if (delta > 0.00001) {
        s = delta / maxC;
        
        if (maxC == r) {
            h = (g - b) / delta;
            if (g < b) {
                h = h + 6.0;
            }
        } else if (maxC == g) {
            h = 2.0 + (b - r) / delta;
        } else {
            h = 4.0 + (r - g) / delta;
        }
        h = h / 6.0;
    }
    
    return vec3<f32>(h, s, v);
}

// Convert HSV to RGB
fn hsv2rgb(hsv: vec3<f32>) -> vec3<f32> {
    let h = hsv.x * 6.0;
    let s = hsv.y;
    let v = hsv.z;
    
    let i = floor(h);
    let f = h - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    
    let idx = i32(i) % 6;
    
    if (idx == 0) {
        return vec3<f32>(v, t, p);
    } else if (idx == 1) {
        return vec3<f32>(q, v, p);
    } else if (idx == 2) {
        return vec3<f32>(p, v, t);
    } else if (idx == 3) {
        return vec3<f32>(p, q, v);
    } else if (idx == 4) {
        return vec3<f32>(t, p, v);
    } else {
        return vec3<f32>(v, p, q);
    }
}

// Apply brightness adjustment
fn applyBrightness(color: vec3<f32>, brightness: f32) -> vec3<f32> {
    return clamp(color + vec3<f32>(brightness), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Apply contrast adjustment
fn applyContrast(color: vec3<f32>, contrast: f32) -> vec3<f32> {
    return clamp((color - 0.5) * contrast + 0.5, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Apply saturation adjustment
fn applySaturation(color: vec3<f32>, saturation: f32) -> vec3<f32> {
    let luminance = dot(color, vec3<f32>(0.299, 0.587, 0.114));
    return clamp(mix(vec3<f32>(luminance), color, saturation), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Apply hue rotation
fn applyHueRotation(color: vec3<f32>, hueShift: f32) -> vec3<f32> {
    var hsv = rgb2hsv(color);
    hsv.x = fract(hsv.x + hueShift / 360.0);
    return hsv2rgb(hsv);
}

// Apply temperature adjustment (warm/cool)
fn applyTemperature(color: vec3<f32>, temperature: f32) -> vec3<f32> {
    var result = color;
    if (temperature > 0.0) {
        // Warm: increase red/yellow, decrease blue
        result.r = min(1.0, result.r + temperature * 0.2);
        result.g = min(1.0, result.g + temperature * 0.1);
        result.b = max(0.0, result.b - temperature * 0.2);
    } else {
        // Cool: increase blue, decrease red
        result.r = max(0.0, result.r + temperature * 0.2);
        result.g = max(0.0, result.g + temperature * 0.05);
        result.b = min(1.0, result.b - temperature * 0.2);
    }
    return result;
}

// Apply tint adjustment (green/magenta)
fn applyTint(color: vec3<f32>, tint: f32) -> vec3<f32> {
    var result = color;
    result.r = clamp(result.r + tint * 0.1, 0.0, 1.0);
    result.g = clamp(result.g - tint * 0.2, 0.0, 1.0);
    result.b = clamp(result.b + tint * 0.1, 0.0, 1.0);
    return result;
}

// Smoothstep function for tonal adjustments
fn smoothstepCustom(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Apply shadows/highlights adjustment
fn applyShadowsHighlights(color: vec3<f32>, shadows: f32, highlights: f32) -> vec3<f32> {
    let luminance = dot(color, vec3<f32>(0.299, 0.587, 0.114));
    
    // Calculate weights
    let shadowWeight = 1.0 - smoothstepCustom(0.0, 0.33, luminance);
    let highlightWeight = smoothstepCustom(0.66, 1.0, luminance);
    
    // Apply adjustments
    let adjustment = shadows * shadowWeight * 0.3 + highlights * highlightWeight * 0.3;
    
    return clamp(color + vec3<f32>(adjustment), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Main compute shader entry point
// Workgroup size optimized for GPU parallelization
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    // Bounds check
    if (x >= dimensions.width || y >= dimensions.height) {
        return;
    }
    
    // Read input pixel
    let coords = vec2<i32>(i32(x), i32(y));
    var color = textureLoad(inputTexture, coords, 0);
    var rgb = color.rgb;
    
    // Apply effects in order (chained in single pass)
    // Order: brightness -> contrast -> saturation -> hue -> temperature -> tint -> shadows/highlights
    
    // 1. Brightness
    if (abs(effects.brightness) > 0.001) {
        rgb = applyBrightness(rgb, effects.brightness);
    }
    
    // 2. Contrast
    if (abs(effects.contrast - 1.0) > 0.001) {
        rgb = applyContrast(rgb, effects.contrast);
    }
    
    // 3. Saturation
    if (abs(effects.saturation - 1.0) > 0.001) {
        rgb = applySaturation(rgb, effects.saturation);
    }
    
    // 4. Hue rotation
    if (abs(effects.hue) > 0.001) {
        rgb = applyHueRotation(rgb, effects.hue);
    }
    
    // 5. Temperature
    if (abs(effects.temperature) > 0.001) {
        rgb = applyTemperature(rgb, effects.temperature);
    }
    
    // 6. Tint
    if (abs(effects.tint) > 0.001) {
        rgb = applyTint(rgb, effects.tint);
    }
    
    // 7. Shadows/Highlights
    if (abs(effects.shadows) > 0.001 || abs(effects.highlights) > 0.001) {
        rgb = applyShadowsHighlights(rgb, effects.shadows, effects.highlights);
    }
    
    // Write output pixel
    textureStore(outputTexture, coords, vec4<f32>(rgb, color.a));
}
