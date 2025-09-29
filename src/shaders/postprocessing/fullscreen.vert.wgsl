// Full-screen triangle vertex shader with UV output

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate positions for a full-screen triangle
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0)
    );
    
    // Generate UVs
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0)
    );
    
    output.position = vec4<f32>(pos[idx], 0.0, 1.0);
    output.uv = uvs[idx];
    
    return output;
} 