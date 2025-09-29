// Bloom extraction shader - extracts bright pixels for bloom effect

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

struct BloomParams {
    threshold: f32,
    _padding1: f32,
    _padding2: f32,
    _padding3: f32,
}
@group(0) @binding(2) var<uniform> params: BloomParams;

struct FragmentInput {
    @location(0) uv: vec2<f32>,
}

// Soft thresholding function for smoother bloom
fn softThreshold(color: vec3<f32>, threshold: f32) -> vec3<f32> {
    let brightness = max(color.r, max(color.g, color.b));
    
    // Only extract values above threshold
    if (brightness < threshold) {
        return vec3<f32>(0.0);
    }
    
    // Smooth falloff from threshold
    let soft = smoothstep(threshold, threshold * 2.0, brightness);
    
    // Return the color scaled by the soft threshold
    // Clamp to prevent extreme values
    return min(color * soft, vec3<f32>(10.0));
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    let color = textureSample(inputTex, samp, input.uv).rgb;
    
    // Clamp input to reasonable range to prevent overflow
    let clampedColor = min(color, vec3<f32>(100.0));
    
    // Apply soft threshold
    let bloom = softThreshold(clampedColor, params.threshold);
    
    // Subtle enhancement without overflow
    let luminance = dot(bloom, vec3<f32>(0.2126, 0.7152, 0.0722));
    let enhancement = 1.0 + min(luminance * 0.2, 1.0);
    let enhancedBloom = bloom * enhancement;
    
    // Final clamp to prevent any overflow
    return vec4<f32>(min(enhancedBloom, vec3<f32>(10.0)), 1.0);
} 