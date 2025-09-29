// Bloom combination shader
// Combines the original image with bloom for final output

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var originalTex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;

struct CombineParams {
    bloomIntensity: f32,
    _padding1: f32,
    _padding2: f32,
    _padding3: f32,
}
@group(0) @binding(3) var<uniform> params: CombineParams;

struct FragmentInput {
    @location(0) uv: vec2<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    let original = textureSample(originalTex, samp, input.uv).rgb;
    let bloom = textureSample(bloomTex, samp, input.uv).rgb;
    
    // Combine with screen blending for natural glow
    let screenBlend = 1.0 - (1.0 - original) * (1.0 - bloom * params.bloomIntensity);
    
    return vec4<f32>(screenBlend, 1.0);
} 