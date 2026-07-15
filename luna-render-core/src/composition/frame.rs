use super::*;
use napi_derive::napi;

pub(crate) fn render_composition_frame_with(
    compositor: &mut Compositor,
    ffmpeg_path: &str,
    ffprobe_path: &str,
    input: &CompositionInput,
    time: f64,
    max_side: Option<u32>,
    fps: Option<f64>,
) -> Result<(Vec<u8>, u32, u32), String> {
    let layers = composition_layers(input, time);
    let raw_max_side = max_side.unwrap_or_else(|| input.canvas.width.max(input.canvas.height));
    let effective_max_side = Some(raw_max_side.min(compositor.max_texture_size));
    compositor.render_preview(
        ffmpeg_path,
        ffprobe_path,
        Some(input.canvas.width),
        Some(input.canvas.height),
        effective_max_side,
        &layers,
        fps,
    )
}

#[napi]
pub fn render_composition_frame(
    input: RenderCompositionFrameInput,
) -> napi::Result<RenderPreviewOutput> {
    crate::lock_preview(|c| {
        let (data, width, height) = render_composition_frame_with(
            c,
            &input.ffmpeg_path,
            &input.ffprobe_path,
            &input.composition,
            input.time,
            input.max_side,
            None, // preview: no fps override
        )?;
        Ok(RenderPreviewOutput {
            width,
            height,
            data: data.into(),
        })
    })
}

/// 异步版本的 render_composition_frame，在后台线程池执行，不阻塞主线程
pub struct RenderCompositionFrameTask {
    input: RenderCompositionFrameInput,
}

impl Task for RenderCompositionFrameTask {
    type Output = RenderPreviewOutput;
    type JsValue = RenderPreviewOutput;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        crate::lock_preview(|c| {
            let (data, width, height) = render_composition_frame_with(
                c,
                &self.input.ffmpeg_path,
                &self.input.ffprobe_path,
                &self.input.composition,
                self.input.time,
                self.input.max_side,
                None, // preview: no fps override
            )?;
            Ok(RenderPreviewOutput {
                width,
                height,
                data: data.into(),
            })
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn render_composition_frame_async(
    input: RenderCompositionFrameInput,
) -> napi::Result<AsyncTask<RenderCompositionFrameTask>> {
    Ok(AsyncTask::new(RenderCompositionFrameTask { input }))
}
