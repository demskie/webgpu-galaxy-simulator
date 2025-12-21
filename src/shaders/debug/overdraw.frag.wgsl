// Overdraw debug shader

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
    minSizeVariation: f32,
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
@group(0) @binding(2) var<storage, read_write> overdrawCounts: array<atomic<u32>>;

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

    // Count overdraw using atomic counter for debug visualization
    let pixelCoord = vec2<u32>(input.position.xy);
    let canvasWidth = u32(uniforms.canvasWidth);
    let canvasHeight = u32(uniforms.canvasHeight);
    
    // Calculate pixel index for overdraw buffer
    // Clamp coordinates to ensure we stay within buffer bounds
    let clampedX = min(pixelCoord.x, canvasWidth - 1u);
    let clampedY = min(pixelCoord.y, canvasHeight - 1u);
    let pixelIndex = clampedY * canvasWidth + clampedX;
    let currentCount = atomicAdd(&overdrawCounts[pixelIndex], 1u);

    // Compute effective per-frame limit for debug visualization
    let accum = max(1.0, uniforms.galaxy.temporalAccumulation);
    let effectiveLimit = max(1u, u32(uniforms.galaxy.maxOverdraw / accum));

    // this is a hack to make stars/dust not square
    let dist = distance(input.uv, vec2(0.5, 0.5));
    
    // Use different falloff for bright stars vs dust to reduce flickering
    var alpha_fade: f32;
    if (input.typ == 0.0) { // STAR type
        // For bright stars, use a softer, more gradual falloff
        let softness = uniforms.galaxy.starEdgeSoftness * 0.7; 
        alpha_fade = 1.0 - smoothstep(0.0, softness, dist);
    } else {
        // Regular falloff for dust particles
        alpha_fade = 1.0 - smoothstep(0.0, uniforms.galaxy.starEdgeSoftness, dist);
    }
    
    if (alpha_fade <= 0.0) { discard; }
    
    // Visualize overdraw as a fraction of the effective limit
    // This shows how close each pixel is to the scaled overdraw limit
    let overdrawFraction = f32(currentCount) / f32(effectiveLimit);
    let intensity = overdrawFraction * uniforms.galaxy.overdrawIntensity;
    
    output.color = vec4(intensity, 0.0, 0.0, 1.0);
    return output;
} 