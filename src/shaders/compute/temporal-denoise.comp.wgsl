// SVGF-style temporal denoiser with neighborhood clamping and variance-guided blending.
// Adapted for galaxy particle rendering with perspective camera.

struct DenoiseParams {
  sigmaSpatial: f32,
  sigmaColor: f32,
  temporalAlpha: f32,  // Base blend weight for temporal accumulation (0.05 = keep 95% history)
  _padding: f32,
  // Camera reprojection inputs
  prevPanX: f32,
  prevPanY: f32,
  currPanX: f32,
  currPanY: f32,
  // Dolly reprojection (1.0 = default distance, <1 = closer, >1 = further back)
  prevDolly: f32,
  currDolly: f32,
  _padding2: f32,
  _padding3: f32,
}

@group(0) @binding(0) var currentTex: texture_2d<f32>;      // Raw noisy current frame
@group(0) @binding(1) var historyTex: texture_2d<f32>;      // Denoised history from previous frame
@group(0) @binding(2) var historySampler: sampler;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: DenoiseParams;

fn safeLog1p(c: vec3<f32>) -> vec3<f32> {
  return log(vec3<f32>(1.0) + max(c, vec3<f32>(0.0)));
}

fn luminance(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Spatial filter radius for denoising
const SPATIAL_RADIUS: i32 = 2;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(currentTex, 0);
  let width = i32(dims.x);
  let height = i32(dims.y);

  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }

  let current = textureLoad(currentTex, vec2<i32>(x, y), 0).rgb;
  let currentLog = safeLog1p(current);

  // Motion-compensated history reprojection for perspective camera
  let w = f32(width);
  let h = f32(height);
  let uv = (vec2<f32>(f32(x) + 0.5, f32(y) + 0.5)) / vec2<f32>(w, h);

  // For perspective camera with pan and dolly:
  // - Pan shifts the view in screen space
  // - Dolly changes the distance, which scales things from center
  let center = vec2<f32>(0.5, 0.5);
  
  // Calculate pan delta in normalized screen coordinates
  // X is negated because when camera pans right, scene moves left (opposite direction)
  let panDelta = vec2<f32>(params.prevPanX - params.currPanX, params.currPanY - params.prevPanY);
  
  // Dolly ratio: how much the view has zoomed
  // When dollying out (currDolly > prevDolly), we need to sample further from center
  let dollyRatio = params.currDolly / max(params.prevDolly, 0.001);
  
  // Reproject: first undo current pan to get world-relative UV, then apply dolly scale, then add previous pan
  let uvFromCenter = uv - center;
  let uvPrev = center + (uvFromCenter - panDelta) * dollyRatio;

  // Always sample from reprojected location (clamped to valid range)
  let uvPrevClamped = clamp(uvPrev, vec2<f32>(0.0), vec2<f32>(1.0));
  let history = textureSampleLevel(historyTex, historySampler, uvPrevClamped, 0.0).rgb;

  // === Step 1: Compute neighborhood statistics for clamping ===
  var neighborMin = current;
  var neighborMax = current;
  var neighborSum = vec3<f32>(0.0);
  var neighborSumSq = vec3<f32>(0.0);
  var neighborCount = 0.0;

  // Also do spatial filtering while we're sampling neighbors
  let sigmaSpatial = max(0.1, params.sigmaSpatial);
  let sigmaColor = max(0.01, params.sigmaColor);
  let invTwoSigmaSpatial2 = 1.0 / (2.0 * sigmaSpatial * sigmaSpatial);
  let invTwoSigmaColor2 = 1.0 / (2.0 * sigmaColor * sigmaColor);

  var spatialSum = vec3<f32>(0.0);
  var spatialWsum = 0.0;

  for (var dy: i32 = -SPATIAL_RADIUS; dy <= SPATIAL_RADIUS; dy++) {
    for (var dx: i32 = -SPATIAL_RADIUS; dx <= SPATIAL_RADIUS; dx++) {
      let sx = clamp(x + dx, 0, width - 1);
      let sy = clamp(y + dy, 0, height - 1);

      let sample = textureLoad(currentTex, vec2<i32>(sx, sy), 0).rgb;

      // Neighborhood min/max for clamping
      neighborMin = min(neighborMin, sample);
      neighborMax = max(neighborMax, sample);
      neighborSum += sample;
      neighborSumSq += sample * sample;
      neighborCount += 1.0;

      // Bilateral spatial filter
      let sampleLog = safeLog1p(sample);
      let r2 = f32(dx * dx + dy * dy);
      let spatialW = exp(-r2 * invTwoSigmaSpatial2);
      let diff = sampleLog - currentLog;
      let colorDist2 = dot(diff, diff);
      let colorW = exp(-colorDist2 * invTwoSigmaColor2);
      let wt = spatialW * colorW;
      spatialSum += sample * wt;
      spatialWsum += wt;
    }
  }

  // Spatial filtered result
  let spatialFiltered = spatialSum / max(spatialWsum, 1e-6);

  // === Step 2: Compute variance for adaptive blending ===
  let neighborMean = neighborSum / neighborCount;
  let neighborVariance = (neighborSumSq / neighborCount) - (neighborMean * neighborMean);
  let variance = max(0.0, luminance(neighborVariance));

  // High variance = noisy area = trust history more (lower alpha)
  // Low variance = stable area = can accept more current frame
  let varianceFactor = 1.0 / (1.0 + variance * 100.0);

  // === Step 3: Expand neighborhood bounds for softer clamping ===
  // This prevents over-clamping in high-variance areas
  let neighborStdDev = sqrt(max(neighborVariance, vec3<f32>(0.0)));
  let expandAmount = 1.5 + variance * 5.0; // More expansion in noisy areas
  let clampMin = neighborMin - neighborStdDev * expandAmount;
  let clampMax = neighborMax + neighborStdDev * expandAmount;

  // === Step 4: Clamp history to neighborhood ===
  let clampedHistory = clamp(history, clampMin, clampMax);

  // === Step 5: Compute adaptive blend weight ===
  // Base alpha from params, adjusted by variance
  let baseAlpha = params.temporalAlpha;

  // In noisy areas (high variance), use less of current frame (accumulate more)
  // In stable areas, can use more current frame
  let alpha = baseAlpha * (0.5 + varianceFactor * 0.5);

  // If history was clamped significantly, trust it less
  let clampDist = length(history - clampedHistory);
  let historyReliability = exp(-clampDist * 2.0);
  let finalAlpha = mix(0.3, alpha, historyReliability); // At least 30% current if history is bad

  // === Step 6: Blend temporal + spatial ===
  // Mix spatially filtered current with clamped history
  let temporalResult = mix(clampedHistory, spatialFiltered, finalAlpha);

  // Ensure no negative values
  let finalColor = max(temporalResult, vec3<f32>(0.0));

  textureStore(outputTex, vec2<u32>(gid.x, gid.y), vec4<f32>(finalColor, 1.0));
}

