// Prepare indirect draw buffer from visibility culling results
// Reads the visible count and sets up the indirect draw arguments

struct VisibleBuffer {
    count: u32,
    _padding1: u32,
    _padding2: u32,
    _padding3: u32,
};

struct IndirectDrawArgs {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
};

@group(0) @binding(0) var<storage, read> visible: VisibleBuffer;
@group(0) @binding(1) var<storage, read_write> indirect: IndirectDrawArgs;

@compute @workgroup_size(1)
fn main() {
    // Set up indirect draw arguments
    indirect.vertexCount = 6u;           // 6 vertices per quad (2 triangles)
    indirect.instanceCount = visible.count;  // Number of visible particles
    indirect.firstVertex = 0u;
    indirect.firstInstance = 0u;
}

