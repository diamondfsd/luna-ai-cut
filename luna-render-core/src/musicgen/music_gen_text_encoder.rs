use ort::session::Session;
use ort::value::{DynValue, Tensor};
use tokenizers::Tokenizer;

use crate::musicgen::tensor_ops::ones_tensor;

pub struct MusicGenTextEncoder {
    pub tokenizer: Tokenizer,
    pub text_encoder: Session,
}

impl MusicGenTextEncoder {
    pub fn encode(&mut self, prompt: &str) -> ort::Result<(DynValue, DynValue)> {
        let encoding = self
            .tokenizer
            .encode(prompt, true)
            .map_err(|error| ort::Error::new(format!("tokenizer failed: {error}")))?;
        let tokens = encoding
            .get_ids()
            .iter()
            .map(|value| *value as i64)
            .collect::<Vec<_>>();
        if tokens.is_empty() {
            return Err(ort::Error::new("music prompt produced no tokens"));
        }
        let token_count = tokens.len();
        let input_ids = Tensor::from_array(([1usize, token_count], tokens))?;
        let attention_mask = ones_tensor::<i64>(&[1, token_count]);
        let mut output = self
            .text_encoder
            .run(ort::inputs![input_ids, attention_mask])?;
        let last_hidden_state = output
            .remove("last_hidden_state")
            .ok_or_else(|| ort::Error::new("text encoder output is missing"))?;
        Ok((
            last_hidden_state,
            ones_tensor::<i64>(&[1, token_count]).into_dyn(),
        ))
    }
}
