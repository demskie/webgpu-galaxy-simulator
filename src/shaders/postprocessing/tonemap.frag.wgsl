// Tone mapping and bloom combination shader

@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var hdrTex : texture_2d<f32>;
@group(0) @binding(3) var bloomTex : texture_2d<f32>;

struct ToneParams {
    exposure: f32,
    saturation: f32,
    bloomIntensity: f32,
    shadowLift: f32,
    minLiftThreshold: f32,
    toneMapToe: f32,
    toneMapHighlights: f32,
    toneMapMidtones: f32,
    toneMapShoulder: f32,
}
@group(0) @binding(2) var<uniform> params: ToneParams;

// Convert RGB to HSV
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
    let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Convert HSV to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// Safe screen blend mode that prevents overflow
fn screenBlend(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
    // Clamp inputs to prevent extreme values
    let safeBase = clamp(base, vec3<f32>(0.0), vec3<f32>(10.0));
    let safeBlend = clamp(blend, vec3<f32>(0.0), vec3<f32>(1.0));
    return 1.0 - (1.0 - safeBase) * (1.0 - safeBlend);
}

// Enhanced ACES tone mapping with user-controllable curve parameters
fn acesToneMapping(color: vec3<f32>, toeAmount: f32, highlights: f32, midtones: f32, shoulder: f32) -> vec3<f32> {
    // Standard ACES constants
    let baseA = 2.51;
    let baseB = 0.03;
    let baseC = 2.43;
    let baseD = 0.59;
    let baseE = 0.14;
    
    // Adjust parameters based on user controls
    // highlights controls the shoulder rolloff (a and c parameters)
    let a = baseA * highlights;
    let c = baseC * highlights;
    
    // midtones controls the overall curve shape (d parameter)
    let d = baseD * midtones;
    
    // toeAmount controls shadow lifting (b and e parameters)
    let adjustedB = baseB + toeAmount * 0.1;
    let adjustedE = baseE - toeAmount * 0.05;
    
    // Apply modified ACES curve
    let mapped = (color * (a * color + adjustedB)) / (color * (c * color + d) + adjustedE);
    
    // shoulder controls the highlight preservation boost
    let boostStrength = 0.1 * shoulder;
    let boost = 1.0 + boostStrength * smoothstep(vec3<f32>(0.8), vec3<f32>(1.0), mapped);
    
    return clamp(mapped * boost, vec3<f32>(0.0), vec3<f32>(1.0));
}

struct FragmentInput {
    @location(0) uv: vec2<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    var color = textureSample(hdrTex, samp, input.uv).rgb;
    let bloom = textureSample(bloomTex, samp, input.uv).rgb;
    
    // Apply exposure first to preserve HDR range
    color *= params.exposure;
    
    // Add bloom
    color += bloom * params.bloomIntensity;
    
    // Ensure no negative values
    color = max(color, vec3<f32>(0.0));
    
    // Prevent color channel overflow by keeping relative ratios
    // This prevents red from overflowing into purple/white
    let maxChannel = max(color.r, max(color.g, color.b));
    if (maxChannel > 10.0) {
        // Scale all channels proportionally to prevent color shift
        color = color * (10.0 / maxChannel);
    }
    
    // Apply tone mapping
    var mappedColor = acesToneMapping(color, params.toneMapToe, params.toneMapHighlights, params.toneMapMidtones, params.toneMapShoulder);
    
    // Apply saturation adjustment AFTER tone mapping
    // This prevents color shifts during HDR processing
    if (params.saturation != 1.0) {
        let luminance = dot(mappedColor, vec3<f32>(0.2126, 0.7152, 0.0722));
        mappedColor = mix(vec3<f32>(luminance), mappedColor, params.saturation);
    }
    
    // Apply shadow lift to brighten darker areas
    if (params.shadowLift > 0.0) {
        // Calculate how much to lift based on how dark the pixel is
        let luminance = dot(mappedColor, vec3<f32>(0.2126, 0.7152, 0.0722));
        
        // Only lift pixels that are above a minimum threshold (not pure black)
        // This prevents lifting the background space
        if (luminance > params.minLiftThreshold) {
            let liftAmount = params.shadowLift * (1.0 - luminance);
            mappedColor = min(mappedColor + liftAmount, vec3<f32>(1.0));
        }
    }
    
    // Final safety clamp
    mappedColor = clamp(mappedColor, vec3<f32>(0.0), vec3<f32>(1.0));
    
    return vec4<f32>(mappedColor, 1.0);
} 