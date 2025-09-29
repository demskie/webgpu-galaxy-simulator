// Averaging shader for temporal accumulation
// Combines N slice textures into final averaged output

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var texArray: texture_2d_array<f32>;

// Each slice has an independent brightness weight.  We store 16 weights as 4 vec4s
// for proper 16-byte alignment in uniform buffers. Unused slots are 0.
// The sum of all weights should be 16 to maintain overall energy.
struct AverageParams {
    weights: array<vec4<f32>, 4>,  // 4 vec4s = 16 floats total
}
@group(0) @binding(2) var<uniform> params: AverageParams;

struct FragmentInput {
    @location(0) uv: vec2<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    var sum = vec3<f32>(0.0);

    // Sample all 16 texture layers, each multiplied by its weight.  Layers that
    // are currently unused simply have weight 0.
    // Access weights[0].x, weights[0].y, weights[0].z, weights[0].w, 
    //        weights[1].x, weights[1].y, weights[1].z, weights[1].w, etc.
    
    for (var i = 0u; i < 16u; i++) {
        let vec_idx = i / 4u;
        let comp_idx = i % 4u;
        
        var weight: f32;
        if (comp_idx == 0u) { weight = params.weights[vec_idx].x; }
        else if (comp_idx == 1u) { weight = params.weights[vec_idx].y; }
        else if (comp_idx == 2u) { weight = params.weights[vec_idx].z; }
        else { weight = params.weights[vec_idx].w; }
        
        sum += weight * textureSample(texArray, samp, input.uv, i).rgb;
    }

    // The weights are authored so that their sum is 16.  Divide by 16 here
    // to normalise final brightness back to the original range (0-1).
    return vec4<f32>(sum / 16.0, 1.0);
} 