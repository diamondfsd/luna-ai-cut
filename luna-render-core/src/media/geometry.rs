pub fn fit_output_size(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let max_side = max_side.max(1);
    let edge = width.max(height);
    if edge <= max_side {
        return (width.max(1), height.max(1));
    }
    let scale = max_side as f64 / edge as f64;
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}
