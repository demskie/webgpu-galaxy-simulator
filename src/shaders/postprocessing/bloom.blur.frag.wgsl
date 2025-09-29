// High-quality bloom blur shader
// Uses a larger kernel with smoother falloff to avoid artifacts

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

struct BlurParams {
    horizontal: f32,  // 1.0 for horizontal pass, 0.0 for vertical
    _padding1: f32,
    _padding2: f32,
    _padding3: f32,
}
@group(0) @binding(2) var<uniform> params: BlurParams;

struct FragmentInput {
    @location(0) uv: vec2<f32>,
}

fn gaussian(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma));
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    let texDimensions = vec2<f32>(textureDimensions(inputTex, 0));
    let texelSize = 1.0 / texDimensions;
    
    var blurDirection: vec2<f32>;
    if (params.horizontal > 0.5) {
        blurDirection = vec2<f32>(1.0, 0.0);
    } else {
        blurDirection = vec2<f32>(0.0, 1.0);
    }
    
    let sigma = 4.0;  // Standard deviation for Gaussian
    let kernelRadius = 12;  // Number of samples on each side
    
    var color = vec3<f32>(0.0);
    var weightSum = 0.0;
    
    for (var i = -kernelRadius; i <= kernelRadius; i++) {
        let weight = gaussian(f32(i), sigma);
        let offset = blurDirection * texelSize * f32(i) * 1.5;  // 1.5x spacing for wider blur
        
        color += textureSample(inputTex, samp, input.uv + offset).rgb * weight;
        weightSum += weight;
    }
    
    color = color / weightSum;
    
    return vec4<f32>(color, 1.0);
} 