// Particle compute shader

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

const PI = 3.14159265358979323846;
const PC_TO_KM = 3.08567758129e13;
const SEC_PER_YEAR = 365.25 * 86400.0;

fn bulge(r: f32, i0: f32, k: f32) -> f32 {
    return i0 * exp(-k * pow(r, 0.25));
};

fn disc(r: f32, i0: f32, a: f32) -> f32 {
    return i0 * exp(-r / a);
};

fn intensity(x: f32, r_bulge: f32, i0: f32, k: f32, a: f32) -> f32 {
    if (x < r_bulge) {
        return bulge(x, i0, k);
    }
    return disc(x - r_bulge, bulge(r_bulge, i0, k), a);
};

// Improved integer hash -> [0,1)  (based on PCG hash)
fn pcg_hash(input: u32) -> u32 {
    var state = input * 747796405u + 2891336453u;
    var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

// Multi-dimensional hash for better distribution
fn hash2(p: vec2<u32>) -> f32 {
    // Combine two dimensions with different large primes
    let n = p.x * 1597334677u + p.y * 3812015801u;
    return f32(pcg_hash(n)) * (1.0 / 4294967295.0);
}

fn hash3(p: vec3<u32>) -> f32 {
    // Combine three dimensions
    let n = p.x * 1597334677u + p.y * 3812015801u + p.z * 2922600713u;
    return f32(pcg_hash(n)) * (1.0 / 4294967295.0);
}

// Legacy single-dimension hash for compatibility
fn hash(f: f32) -> f32 {
    return f32(pcg_hash(u32(f * 4294967295.0))) * (1.0 / 4294967295.0);
}

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

struct ParticleBuffer {
    particles: array<Particle>,
};

@group(0) @binding(0) var<uniform> galaxy: Galaxy;
@group(0) @binding(1) var<storage, read_write> particleBuffer: ParticleBuffer;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= u32(galaxy.totalStarCount)) { return; }

    var p: Particle;
    
    // First brightStarCount particles are bright stars
    if (id < u32(galaxy.brightStarCount)) {
        p = generateBrightStar(id);
    } else {
        // Remaining particles are distributed among other types using weighted selection
        let remainingId = id - u32(galaxy.brightStarCount);
        let totalWeight = galaxy.centralBulgeDensity + galaxy.diskStarDensity + galaxy.backgroundStarDensity;
        
        if (totalWeight > 0.0) {
            // Use hash based on the remaining ID for distribution
            let randVal = hash2(vec2<u32>(remainingId, 0u));
            let weightedRand = randVal * totalWeight;
            
            if (weightedRand < galaxy.centralBulgeDensity) {
                p = generateBulgeStar(id);
            } else if (weightedRand < galaxy.centralBulgeDensity + galaxy.diskStarDensity) {
                p = generateNormalStar(id);
            } else {
                p = generateUniformStar(id);
            }
        } else {
            // Fallback to normal stars if no weights are set
            p = generateNormalStar(id);
        }
    }

    particleBuffer.particles[id] = p;
}

fn sampleGalaxyRadius(randVal:f32) -> f32{
    let maxFactor = 1.0 - exp(-1.0 / galaxy.densityFalloff);
    let radNorm = -log(1.0 - randVal * maxFactor) * galaxy.densityFalloff;
    return radNorm * galaxy.galaxyRadius;
}

// Add position jitter to avoid regular patterns
fn addPositionJitter(pos: vec2<f32>, id: u32, scale: f32) -> vec2<f32> {
    let jitterX = (hash2(vec2<u32>(id, 100u)) - 0.5) * scale;
    let jitterY = (hash2(vec2<u32>(id, 101u)) - 0.5) * scale;
    return pos + vec2<f32>(jitterX, jitterY);
}

const STAR = 0.0;
const DUST = 1.0;

fn generateBrightStar(id:u32) -> Particle {
    // Bright stars use a more uniform distribution, not affected by density falloff
    // Use a gentler power function for better distribution without the steep falloff
    let radiusRand = hash2(vec2<u32>(id, 1u));
    let r = galaxy.galaxyRadius * pow(radiusRand, 0.7) * galaxy.brightStarRadiusFactor * 1.05; // Small 5% extension
    
    var s: Particle;
    s.a = r;
    s.b = r * getExcentricity(r);
    s.tiltAngle = r * galaxy.spiralTightness;
    s.theta0 = 360.0 * hash2(vec2<u32>(id, 2u));
    s.velTheta = getOrbitalVelocity(r);
    let tempRange = galaxy.brightStarMaxTemperature - galaxy.brightStarMinTemperature;
    s.temp = galaxy.brightStarMinTemperature + tempRange * hash2(vec2<u32>(id, 3u));
    var mag = galaxy.brightStarBaseMagnitude + hash2(vec2<u32>(id, 4u)) * galaxy.brightnessVariation;
    
    // Apply density-based suppression to bright stars
    // Suppression is stronger in dense areas (center) and weaker at edges
    let normalizedR = r / galaxy.galaxyRadius;
    if (galaxy.coreBrightStarSuppressionMag > 0.0) {
        // Calculate suppression falloff based on extent parameter
        // coreBrightStarSuppressionExtent controls how far the effect reaches
        // Lower values = effect limited to very center, higher values = effect extends further
        let suppressionFalloff = exp(-normalizedR / galaxy.coreBrightStarSuppressionExtent);
        
        // Apply suppression based on magnitude and falloff
        // coreBrightStarSuppressionMag controls the maximum suppression amount
        let suppressionAmount = galaxy.coreBrightStarSuppressionMag * suppressionFalloff;
        mag = mag * (1.0 - suppressionAmount);
        
        // Ensure magnitude doesn't go below minimum
        mag = max(mag, galaxy.minimumBrightness * 0.1);
    }
    
    // Apply edge brightness falloff
    if (normalizedR > galaxy.galaxyEdgeFadeStart * 0.9) {  // Start fading bright stars slightly earlier
        let fadeFactor = 1.0 - smoothstep(galaxy.galaxyEdgeFadeStart * 0.9, 1.05, normalizedR);
        mag *= fadeFactor;
    }
    
    s.mag = mag;
    s.typ = STAR;
    s.color = colorFromTemperature(s.temp);
    return s;
}

fn generateBulgeStar(id:u32) -> Particle {
    // Allow bulge stars to extend slightly beyond galaxy radius
    let r = sampleGalaxyRadius(hash2(vec2<u32>(id, 5u))) * 1.05;
    var s: Particle;
    s.a = r;
    s.b = r * getExcentricity(r);
    s.tiltAngle = r * galaxy.spiralTightness;
    s.theta0 = 360.0 * hash2(vec2<u32>(id, 6u));
    s.velTheta = getOrbitalVelocity((s.a+s.b)/2.0);
    s.temp = galaxy.baseTemperature + r / galaxy.temperatureRadiusFactor;
    
    // Apply brightness falloff at edges
    let normalizedR = r / galaxy.galaxyRadius;
    var brightness = galaxy.minimumBrightness + hash2(vec2<u32>(id, 7u)) * galaxy.brightnessVariation;
    if (normalizedR > galaxy.galaxyEdgeFadeStart) {
        let fadeFactor = 1.0 - smoothstep(galaxy.galaxyEdgeFadeStart, 1.05, normalizedR);
        brightness *= fadeFactor;
    }
    s.mag = brightness;
    
    s.typ = DUST;
    s.color = colorFromTemperature(s.temp);
    return s;
}

fn generateNormalStar(id: u32) -> Particle {
    // Use polar coordinates for better circular distribution
    let angle = 2.0 * PI * hash2(vec2<u32>(id, 8u));
    // Extend beyond galaxy radius for soft edge
    let radiusRand = hash2(vec2<u32>(id, 9u));
    // Use a gentler power function (0.85 instead of 0.7) for less center concentration
    // Extend only 10% beyond edge to maintain visual size
    let r = galaxy.galaxyRadius * 1.1 * pow(radiusRand, 0.85);
    
    var s = Particle();
    s.a = r;
    s.b = r * getExcentricity(r);
    s.tiltAngle = r * galaxy.spiralTightness;
    s.theta0 = 360.0 * hash2(vec2<u32>(id, 10u));
    s.velTheta = getOrbitalVelocity((s.a + s.b)/2.0);
    s.temp = galaxy.baseTemperature + r / galaxy.temperatureRadiusFactor;
    
    // Apply brightness falloff at edges
    let normalizedR = r / galaxy.galaxyRadius;
    var brightness = galaxy.minimumBrightness + hash2(vec2<u32>(id, 11u)) * galaxy.brightnessVariation;
    if (normalizedR > galaxy.galaxyEdgeFadeStart) {
        let fadeFactor = 1.0 - smoothstep(galaxy.galaxyEdgeFadeStart, 1.1, normalizedR);
        brightness *= fadeFactor;
    }
    s.mag = brightness;
    
    s.typ = DUST;
    s.color = colorFromTemperature(s.temp);
    return s;
}

fn generateUniformStar(id:u32) -> Particle{
    // Generate truly uniform stars that don't follow galactic structure
    // Use polar coordinates for even distribution
    let angle = 2.0 * PI * hash2(vec2<u32>(id, 12u));
    // Extend moderately beyond galaxy for background stars - uniform distribution
    let r = galaxy.galaxyRadius * 1.2 * sqrt(hash2(vec2<u32>(id, 13u)));
    
    var s: Particle;
    s.a = r;
    s.b = r; // Circular orbit (no eccentricity)
    s.tiltAngle = 0.0; // No spiral arm structure
    s.theta0 = 360.0 * hash2(vec2<u32>(id, 14u));
    s.velTheta = getOrbitalVelocity(r); // Spin with galaxy but stay circular
    s.temp = galaxy.baseTemperature + r / galaxy.temperatureRadiusFactor;
    
    // Apply brightness falloff for uniform stars too
    let normalizedR = r / galaxy.galaxyRadius;
    var brightness = galaxy.minimumBrightness + hash2(vec2<u32>(id, 15u)) * galaxy.brightnessVariation;
    if (normalizedR > 0.8) {  // Start fading earlier for background stars
        let fadeFactor = 1.0 - smoothstep(0.8, 1.2, normalizedR);
        brightness *= fadeFactor;
    }
    s.mag = brightness;
    
    s.typ = DUST;
    s.color = colorFromTemperature(s.temp);
    return s;
}

fn getExcentricity(r: f32) -> f32 {
    let radGalaxy = galaxy.galaxyRadius;
    
    // Normalize radius to 0-1 range relative to galaxy size
    let normalizedR = r / radGalaxy;
    
    // spiralPeakPosition controls where the spiral peaks (0.1 = inner, 1.0 = outer)
    let peakPosition = galaxy.spiralPeakPosition;
    
    // Width adapts based on peak position for natural look
    // Inner peaks need narrower curves, outer peaks need wider
    let width = galaxy.spiralWidthBase + galaxy.spiralWidthScale * galaxy.spiralPeakPosition;
    
    // Gaussian-like curve centered at peakPosition
    let distFromPeak = normalizedR - peakPosition;
    let bellCurve = exp(-(distFromPeak * distFromPeak) / (width * width));
    
    // Scale by spiralIntensity: 0 = circular, 1 = maximum spiral
    // Add 1.0 base to ensure we never go below circular (eccentricity = 1)
    var eccentricity = 1.0 + galaxy.spiralIntensity * bellCurve * galaxy.spiralEccentricityScale;
    
    // Seamless edge fade using smooth falloff based on galaxyEdgeFadeStart
    // galaxyEdgeFadeStart controls how early the fade begins (0.5 = fade starts at 50% radius)
    let edgeFade = smoothstep(galaxy.galaxyEdgeFadeStart, 1.2, normalizedR);
    eccentricity = mix(eccentricity, 1.0, edgeFade);
    
    return eccentricity;
}

fn getOrbitalVelocity(r: f32) -> f32 {
    let vel_kms = velocity(r);
    let u = 2.0 * PI * r * PC_TO_KM;
    let time = u / (vel_kms * SEC_PER_YEAR);
    return 360.0 / time;
}

fn cubic(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 {
    return a * pow(x, 3.0) + b * pow(x, 2.0) + c * x + d;
}

fn quadratic(x: f32, a: f32, b: f32, c: f32) -> f32 {
    return a * (x * x) + b * x + c;
}

// DO NOT CHANGE - IT'S FINELY TUNED AND PURPOSEFULLY INACCURATE
fn colorFromTemperature(kelvin: f32) -> vec4<f32> {
    let k = clamp(kelvin, galaxy.minColorTemperature, galaxy.maxColorTemperature);
    let percent = (k - galaxy.minColorTemperature) / (galaxy.maxColorTemperature - galaxy.minColorTemperature);
    var r = 0.0;
    var g = 0.0;
    var b = 0.0;
    if (percent <= 0.615) {
        r = 1.0;
        g = cubic(percent, 0.1597, -1.575, 2.46, -0.01768);
        b = cubic(percent, -4.729, 6.219, -0.4015, -0.0143);
    } else {
        r = cubic(percent, -3.19, 9.571, -10.14, 4.36);
        g = cubic(percent, -1.483, 4.582, -5.094, 2.687);
        b = 1.0;
    }
    return vec4<f32>(r, g, b, 1.0);
}

fn massHalo(r: f32) -> f32 {
    let rho_h0 = 0.15;
    let rC = 2500.0;
    return ((rho_h0 * 1.0) / (1.0 + pow(r / rC, 2.0))) * ((4.0 * PI * pow(r, 3.0)) / 3.0);
}

fn velocity(r: f32) -> f32 {
    if (r <= 0.0) { return 0.0; }
    return galaxy.maxRotationVelocity * (1.0 - exp(-r / galaxy.rotationVelocityScale));
}

