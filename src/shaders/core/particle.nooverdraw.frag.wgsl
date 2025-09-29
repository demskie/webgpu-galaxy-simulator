// Particle fragment shader (no overdraw logic)

struct Galaxy {
    time: f32,
    galaxyRadius: f32,
    spiralPeakPosition: f32,
    spiralIntensity: f32,
    spiralTightness: f32,
    brightStarSize: f32,
    dustParticleSize: f32,
    totalStarCount: f32,
    spiralArmWaves: f32,
    spiralWaveStrength: f32,
    baseTemperature: f32,
    brightStarCount: f32,
    centralBulgeDensity: f32,
    diskStarDensity: f32,
    backgroundStarDensity: f32,
    densityFalloff: f32,
    rotationSpeed: f32,
    minimumBrightness: f32,
    brightnessVariation: f32,
    brightStarMinTemperature: f32,
    brightStarMaxTemperature: f32,
    temperatureRadiusFactor: f32,
    spiralWidthBase: f32,
    spiralWidthScale: f32,
    spiralEccentricityScale: f32,
    maxRotationVelocity: f32,
    rotationVelocityScale: f32,
    minColorTemperature: f32,
    maxColorTemperature: f32,
    galaxyEdgeFadeStart: f32,
    brightStarBaseMagnitude: f32,
    starEdgeSoftness: f32,
    brightStarRadiusFactor: f32,
    coreBrightStarSuppressionMag: f32,
    coreBrightStarSuppressionExtent: f32,
    radialExposureFalloff: f32,
    exposure: f32,
    saturation: f32,
    bloomIntensity: f32,
    bloomThreshold: f32,
    overdrawDebug: f32,
    overdrawIntensity: f32,
    shadowLift: f32,
    minLiftThreshold: f32,
    particleSizeVariation: f32,
    toneMapToe: f32,
    toneMapHighlights: f32,
    toneMapMidtones: f32,
    toneMapShoulder: f32,
    temporalAccumulation: f32,
    temporalFrame: f32,
    brightStarBrightness: f32,
    maxOverdraw: f32,
    _padding1: f32,
    _padding2: f32,
    _padding3: f32,
}

struct Uniforms {
    viewMat: mat4x4<f32>,
    projMat: mat4x4<f32>,
    galaxy: Galaxy,
    features: u32,
    canvasWidth: f32,
    canvasHeight: f32,
    _padding1: f32,
    _padding2: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentInput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) @interpolate(flat) features: u32,
    @location(3) @interpolate(flat) typ: f32,
    @location(4) worldPos: vec2<f32>,
};

struct FragmentOutput {
    @location(0) color: vec4<f32>,
};

@fragment
fn main(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;

    // this is a hack to make stars/dust not square
    let dist = distance(input.uv, vec2(0.5, 0.5));

    // Use different falloff for bright stars vs dust to reduce flickering
    var alpha_fade: f32;
    if (input.typ == 0.0) { // STAR type
        // For bright stars, use a softer, more gradual falloff
        let softness = uniforms.galaxy.starEdgeSoftness * 0.7; // Make bright stars slightly sharper
        alpha_fade = 1.0 - smoothstep(0.0, softness, dist);
        if (dist > softness) {
            let glow_falloff = 1.0 - smoothstep(softness, 0.5, dist);
            alpha_fade = max(alpha_fade, glow_falloff * 0.2);
        }
    } else {
        // Regular falloff for dust particles
        alpha_fade = 1.0 - smoothstep(0.0, uniforms.galaxy.starEdgeSoftness, dist);
    }

    if (alpha_fade <= 0.0) { discard; }

    // Apply radial exposure falloff if enabled
    var exposure_multiplier = 1.0;
    if (uniforms.galaxy.radialExposureFalloff > 0.0) {
        let center_distance = length(input.worldPos) / uniforms.galaxy.galaxyRadius;
        let distance_factor = clamp(center_distance, 0.0, 1.0);
        let falloff_amount = distance_factor * uniforms.galaxy.radialExposureFalloff;
        exposure_multiplier = 1.0 - falloff_amount;
        exposure_multiplier = max(exposure_multiplier, 0.1);
    }

    output.color = vec4(input.color.rgb * exposure_multiplier, input.color.a * alpha_fade);
    return output;
}

