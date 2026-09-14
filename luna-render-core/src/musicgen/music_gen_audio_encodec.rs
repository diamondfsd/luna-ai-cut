use half::f16;
use ndarray::{Array, Axis};
use ort::session::Session;
use ort::value::{DynValue, Tensor};

pub struct MusicGenAudioEncodec {
    pub audio_encodec_decode: Session,
}

impl MusicGenAudioEncodec {
    pub fn encode(&mut self, tokens: impl IntoIterator<Item = [i64; 4]>) -> ort::Result<Vec<f32>> {
        let data = tokens
            .into_iter()
            .flat_map(|ids| ids.into_iter())
            .collect::<Vec<_>>();
        if data.is_empty() || data.len() % 4 != 0 {
            return Err(ort::Error::new("decoder produced an invalid token stream"));
        }
        let sequence_length = data.len() / 4;
        let values = Array::from_shape_vec((sequence_length, 4), data)
            .map_err(|error| ort::Error::new(format!("encodec input shape is invalid: {error}")))?;
        let values = values.t().insert_axis(Axis(0)).insert_axis(Axis(0));
        let input = Tensor::from_array(values.to_owned())?;
        let mut outputs = self.audio_encodec_decode.run(ort::inputs![input])?;
        let audio_values: DynValue = outputs
            .remove("audio_values")
            .ok_or_else(|| ort::Error::new("encodec output is missing"))?;
        if let Ok((_, data)) = audio_values.try_extract_tensor::<f32>() {
            return Ok(data.to_vec());
        }
        if let Ok((_, data)) = audio_values.try_extract_tensor::<f16>() {
            return Ok(data.iter().map(|value| f32::from(*value)).collect());
        }
        Err(ort::Error::new("encodec output must be f16 or f32"))
    }
}
