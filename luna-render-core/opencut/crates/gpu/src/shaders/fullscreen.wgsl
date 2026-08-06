struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

@vertex
fn vertex_main(@location(0) position: vec2f) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(position, 0.0, 1.0);
    output.tex_coord = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
    return output;
}
