use super::{Model, Result};
use ort::session::Session;
use ort::value::{DynValue, Tensor, TensorElementType, ValueType};

pub fn inputs(session: &Session, model: &Model) -> Result<Vec<(String, DynValue)>> {
    session
        .inputs()
        .iter()
        .map(|i| (i.name().to_owned(), i.dtype().clone()))
        .into_iter()
        .map(|(name, dtype)| {
            let ValueType::Tensor { ty, shape, .. } = dtype else {
                return Err(format!("unsupported input {name}").into());
            };
            let override_shape: Option<Vec<usize>> = match (model.kind.as_str(), name.as_str()) {
                ("sam-decoder", "input_points") => Some(vec![1, 1, 1, 2]),
                ("sam-decoder", "input_labels") => Some(vec![1, 1, 1]),
                ("sam-decoder", "image_embeddings" | "image_positional_embeddings") => {
                    Some(vec![1, 256, 64, 64])
                }
                ("asr", "speech") => {
                    let dim = session
                        .metadata()?
                        .custom("neg_mean")
                        .ok_or("missing ASR metadata")?
                        .split(',')
                        .count();
                    Some(vec![1, 32, dim])
                }
                ("asr", "speech_lengths") | ("punctuation", "text_lengths") => Some(vec![1]),
                ("punctuation", "inputs") => Some(vec![1, 8]),
                ("vad", "input") => Some(vec![1, 512]),
                ("vad", "state") => Some(vec![2, 1, 128]),
                ("vad", "sr") => Some(vec![1]),
                ("inpaint", "mask") => Some(vec![1, 1, 512, 512]),
                ("image" | "inpaint" | "reference" | "sam-encoder", _) => {
                    Some(vec![1, 3, model.height, model.width])
                }
                _ => None,
            };
            let dims = override_shape.unwrap_or_else(|| {
                shape
                    .iter()
                    .map(|d| if *d > 0 { *d as usize } else { 1 })
                    .collect()
            });
            let count: usize = dims.iter().product();
            let value = match ty {
                TensorElementType::Float32 => {
                    let values = (0..count)
                        .map(|i| match (model.kind.as_str(), name.as_str()) {
                            ("sam-decoder", "input_points") => 128.0,
                            ("vad", "state") => 0.0,
                            ("vad", _) => (i as f32 * 0.17).sin() * 0.1,
                            ("inpaint", "mask") => {
                                if i % 512 > 200 && i % 512 < 300 && i / 512 > 200 && i / 512 < 300
                                {
                                    1.0
                                } else {
                                    0.0
                                }
                            }
                            _ => (i % 251) as f32 / 250.0,
                        })
                        .collect::<Vec<_>>();
                    Tensor::from_array((dims, values))?.into_dyn()
                }
                TensorElementType::Int64 => Tensor::from_array((
                    dims,
                    vec![if name == "sr" { 16000i64 } else { 1 }; count],
                ))?
                .into_dyn(),
                TensorElementType::Int32 => Tensor::from_array((
                    dims,
                    vec![
                        if name == "speech_lengths" {
                            32i32
                        } else if name == "text_lengths" {
                            8
                        } else {
                            1
                        };
                        count
                    ],
                ))?
                .into_dyn(),
                _ => return Err(format!("unsupported dtype {ty:?} for {name}").into()),
            };
            Ok((name, value))
        })
        .collect()
}
