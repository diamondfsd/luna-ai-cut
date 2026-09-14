use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct MusicGenConfig {
    pub audio_encoder: AudioEncoderConfig,
    pub decoder: DecoderConfig,
    pub text_encoder: TextEncoderConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AudioEncoderConfig {
    pub sampling_rate: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DecoderConfig {
    pub num_attention_heads: usize,
    pub num_hidden_layers: usize,
    pub top_k: usize,
    pub pad_token_id: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TextEncoderConfig {
    pub d_kv: usize,
}
