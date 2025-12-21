// Particle vertex shader

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

// Define the structure for particle data, matching the old VertexInput
struct Particle {
    theta0: f32,
    velTheta: f32,
    tiltAngle: f32,
    a: f32,
    b: f32,
    temp: f32,
    mag: f32,
    typ: f32,
    color: vec4<f32>,
};

// Define the storage buffer containing an array of particle data
struct ParticleBuffer {
    particles: array<Particle>,
};
@group(0) @binding(1) var<storage, read> particleBuffer: ParticleBuffer;

// Visible indices buffer from frustum culling
// Layout: count (u32), padding (3 x u32), indices (array<u32>)
struct VisibleBuffer {
    count: u32,
    _padding1: u32,
    _padding2: u32,
    _padding3: u32,
    indices: array<u32>,
};
@group(0) @binding(3) var<storage, read> visibleBuffer: VisibleBuffer;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) @interpolate(flat) features: u32,
    @location(3) @interpolate(flat) typ: f32,
    @location(4) worldPos: vec2<f32>,
};

const STAR: f32 = 0.0;
const DUST: f32 = 1.0;

// Exposure control
const BASE_STAR_COUNT = 1000000.0;

// Simple hash function for better particle distribution
fn hash(value: u32) -> u32 {
    var x = value;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return x;
}

// Hash function that returns a float in [0, 1) range
fn hashFloat(n: u32) -> f32 {
    return f32(hash(n)) * (1.0 / 4294967295.0);
}

// Halton sequence generator for low-discrepancy sampling
fn haltonSequence(index: u32, base: u32) -> f32 {
    var result = 0.0;
    var f = 1.0;
    var i = index;
    
    while (i > 0u) {
        f = f / f32(base);
        result = result + f * f32(i % base);
        i = i / base;
    }
    
    return result;
}

// Calculate size scaling for dust particles based on total star count
// When star count is low, particles are larger to fill space
// When star count is high, particles are smaller to avoid overlap
fn dustSizeScale() -> f32 {
    // Use square root for gentler scaling curve
    // With BASE_STAR_COUNT = 1M, this gives us:
    // - 10K stars: ~10x size
    // - 100K stars: ~3.16x size 
    // - 1M stars: 1x size
    // - 10M stars: ~0.32x size
    return sqrt(BASE_STAR_COUNT / uniforms.galaxy.totalStarCount);
}

fn calcPos(p: Particle, g: Galaxy) -> vec2<f32> {
    let thetaActual = p.theta0 + p.velTheta * g.time * g.rotationSpeed;
    let beta = -p.tiltAngle;
    let alpha = radians(thetaActual);
    
    // Apply perturbation to the radius before calculating the position
    // This creates periodic disturbances in the elliptical shape itself
    var a_perturbed = p.a;
    var b_perturbed = p.b;
    
    if (g.spiralWaveStrength > 0.0 && g.spiralArmWaves > 0.0) {
        let invertedSpiralWaveStrength = 1.0 / (100.0 - min(g.spiralWaveStrength, 100.0));
        let perturbation = 1.0 + invertedSpiralWaveStrength * cos(alpha * 2.0 * g.spiralArmWaves);
        a_perturbed = p.a * perturbation;
        b_perturbed = p.b * perturbation;
    }
    
    // Now calculate position using the perturbed ellipse parameters
    let cosalpha = cos(alpha);
    let sinalpha = sin(alpha);
    let cosbeta = cos(beta);
    let sinbeta = sin(beta);
    
    var ps = vec2<f32>(
        (a_perturbed * cosalpha * cosbeta - b_perturbed * sinalpha * sinbeta),
        (a_perturbed * cosalpha * sinbeta + b_perturbed * sinalpha * cosbeta)
    );
    
    return ps;
}

@vertex
fn main(
	@location(0) local_pos: vec2<f32>,
	@builtin(instance_index) instanceIdx: u32
) -> VertexOutput {
	// Look up the actual particle index from the visible indices buffer
	// The visibility culling compute pass has already filtered particles
	let particleIdx = visibleBuffer.indices[instanceIdx];
	
	// Read particle data using the actual particle index
	let particle = particleBuffer.particles[particleIdx];
    var output: VertexOutput;

    // Calculate particle center position in world space (using data from storage buffer)
    let center_pos_world = calcPos(particle, uniforms.galaxy);

    // Determine size based on type (using data from storage buffer)
    var world_size: f32;
    
    if (particle.typ == STAR) {
        // Bright stars don't use size variation - only dust particles do
        world_size = particle.mag * uniforms.galaxy.brightStarSize;
        // Bright stars are rendered every slice.
        output.color = particle.color * particle.mag * uniforms.galaxy.brightStarBrightness;
    } else {
        // Calculate size variation factor for dust particles only
        var sizeVariationFactor = 1.0;
        if (uniforms.galaxy.particleSizeVariation > 0.0) {
            // Use actual particle index for consistent size variation
            let randomValue = hashFloat(particleIdx);
            // Map random value from [0,1] to [-1,1] for symmetric variation
            let symmetricRandom = (randomValue - 0.5) * 2.0;
            // Apply variation symmetrically around 1.0
            // When particleSizeVariation = 1.0: factor ranges from 0.5x to 1.5x
            // When particleSizeVariation = 0.5: factor ranges from 0.75x to 1.25x
            sizeVariationFactor = 1.0 + symmetricRandom * 0.5 * uniforms.galaxy.particleSizeVariation;
            // Clamp to minimum to prevent zero/negative sizes
            sizeVariationFactor = max(sizeVariationFactor, uniforms.galaxy.minSizeVariation);
        }
        
        // Dust particles: scale size based on total star count
        let sizeScale = dustSizeScale();
        world_size = uniforms.galaxy.dustParticleSize * sizeVariationFactor * sizeScale;
        
        // Compensate brightness for size variation to maintain constant total light output.
        // Area scales with size^2, so brightness scales inversely with size^2.
        let sizeCompensation = 1.0 / (sizeVariationFactor * sizeVariationFactor);
        
        output.color = particle.color * particle.mag * sizeCompensation;
    }

    // Calculate quad corner offset in world space using direct array indexing
    let corner_offset = local_pos * world_size;

    // Calculate vertex position in world space
    let vertex_pos_world = center_pos_world + corner_offset;

    // Transform to clip space
    output.position = uniforms.projMat * uniforms.viewMat * vec4<f32>(vertex_pos_world, 0.0, 1.0);

    // Pass uniform features
    output.features = uniforms.features;

    // Pass instance type (using data from storage buffer)
    output.typ = particle.typ;

    output.uv = vec2(local_pos.x + 0.5, 0.5 - local_pos.y);

    // Pass world position for radial exposure falloff
    output.worldPos = center_pos_world;

    return output;
}