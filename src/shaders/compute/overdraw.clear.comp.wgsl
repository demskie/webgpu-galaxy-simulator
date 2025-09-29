// Overdraw clear shader

struct Dimensions {
    width: f32,
    height: f32,
    _padding1: f32,
    _padding2: f32,
}

@group(0) @binding(0) var<storage, read_write> counts: array<u32>;
@group(0) @binding(1) var<uniform> dimensions: Dimensions;

@compute @workgroup_size(64, 1, 1)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(workgroup_id) wgid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>
) {
    let width = u32(dimensions.width);
    let height = u32(dimensions.height);
    let totalPixels = width * height;
    
    // Calculate how many workgroups are needed total
    let workgroupsNeeded = (totalPixels + 63u) / 64u;
    
    // Calculate linear workgroup index from 2D dispatch
    var linearWorkgroupId: u32;
    if (workgroupsNeeded <= 65535u) {
        // 1D dispatch: wgid.x is the linear workgroup ID
        linearWorkgroupId = wgid.x;
    } else {
        // 2D dispatch: calculate linear workgroup ID from x,y
        // When dispatching in 2D, workgroupsX = min(workgroupsNeeded, 65535)
        let workgroupsX = min(workgroupsNeeded, 65535u);
        linearWorkgroupId = wgid.y * workgroupsX + wgid.x;
    }
    
    // Calculate the pixel index this thread should clear
    let index = linearWorkgroupId * 64u + lid.x;
    
    if (index < totalPixels && index < arrayLength(&counts)) {
        counts[index] = 0u;
    }
}