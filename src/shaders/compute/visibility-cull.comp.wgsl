// Visibility culling compute shader
// Performs frustum culling to determine which particles are visible
// and writes their indices to a compact buffer for indirect indexed drawing

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

struct CullUniforms {
    viewProjMat: mat4x4<f32>,
    time: f32,
    rotationSpeed: f32,
    spiralArmWaves: f32,
    spiralWaveStrength: f32,
    totalStarCount: u32,
    brightStarSize: f32,
    dustParticleSize: f32,
    _padding1: f32,
    _padding2: f32,
    _padding3: f32,
    _padding4: f32,
    _padding5: f32,
}

struct ParticleBuffer {
    particles: array<Particle>,
};

struct VisibleBuffer {
    count: atomic<u32>,
    _padding1: u32,
    _padding2: u32,
    _padding3: u32,
    indices: array<u32>,
};

@group(0) @binding(0) var<uniform> cull: CullUniforms;
@group(0) @binding(1) var<storage, read> particles: ParticleBuffer;
@group(0) @binding(2) var<storage, read_write> visible: VisibleBuffer;

const STAR: f32 = 0.0;
const PI: f32 = 3.14159265358979323846;
const BASE_STAR_COUNT: f32 = 1000000.0;

// Match the vertex shader's dust size scaling based on total star count
fn dustSizeScale() -> f32 {
    return sqrt(BASE_STAR_COUNT / f32(cull.totalStarCount));
}

// Calculate particle world position (same logic as vertex shader)
fn calcPos(p: Particle) -> vec2<f32> {
    let thetaActual = p.theta0 + p.velTheta * cull.time * cull.rotationSpeed;
    let beta = -p.tiltAngle;
    let alpha = radians(thetaActual);
    
    // Apply perturbation to the radius before calculating the position
    var a_perturbed = p.a;
    var b_perturbed = p.b;
    
    if (cull.spiralWaveStrength > 0.0 && cull.spiralArmWaves > 0.0) {
        let invertedSpiralWaveStrength = 1.0 / (100.0 - min(cull.spiralWaveStrength, 100.0));
        let perturbation = 1.0 + invertedSpiralWaveStrength * cos(alpha * 2.0 * cull.spiralArmWaves);
        a_perturbed = p.a * perturbation;
        b_perturbed = p.b * perturbation;
    }
    
    let cosalpha = cos(alpha);
    let sinalpha = sin(alpha);
    let cosbeta = cos(beta);
    let sinbeta = sin(beta);
    
    return vec2<f32>(
        (a_perturbed * cosalpha * cosbeta - b_perturbed * sinalpha * sinbeta),
        (a_perturbed * cosalpha * sinbeta + b_perturbed * sinalpha * cosbeta)
    );
}

// Check if particle is visible in clip space with margin for particle size
fn isVisible(worldPos: vec2<f32>, worldSize: f32) -> bool {
    // Transform to clip space
    let clipPos = cull.viewProjMat * vec4<f32>(worldPos, 0.0, 1.0);
    
    // Behind camera check
    if (clipPos.w <= 0.0) {
        return false;
    }
    
    // Calculate margin in NDC space based on actual projected particle size.
    // The particle's screen-space size is approximately worldSize / clipPos.w in NDC units.
    // We use the projection matrix's [0][0] and [1][1] to get proper aspect-corrected size.
    // For a simple approximation, we use the w component directly.
    let ndcRadius = worldSize / clipPos.w;
    
    // Add a small base margin plus the projected particle radius
    let margin = 0.05 + ndcRadius;
    
    // NDC coordinates with margin
    let ndc = clipPos.xy / clipPos.w;
    let threshold = 1.0 + margin;
    
    return abs(ndc.x) <= threshold && abs(ndc.y) <= threshold;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= cull.totalStarCount) { return; }
    
    let p = particles.particles[id];
    
    // Calculate world position
    let worldPos = calcPos(p);
    
    // Calculate actual world-space size of the particle
    // Must match the vertex shader's size calculation to avoid popping
    var worldSize: f32;
    if (p.typ == STAR) {
        worldSize = cull.brightStarSize * p.mag;
    } else {
        // Apply the same size scaling as the vertex shader
        let sizeScale = dustSizeScale();
        // Use maximum size variation (1.5) to be conservative and avoid popping
        let maxSizeVariation = 1.5;
        worldSize = cull.dustParticleSize * sizeScale * maxSizeVariation;
    }
    
    // Check visibility using proper projected size for margin
    if (isVisible(worldPos, worldSize)) {
        // Atomically append to visible buffer
        let idx = atomicAdd(&visible.count, 1u);
        visible.indices[idx] = id;
    }
}

