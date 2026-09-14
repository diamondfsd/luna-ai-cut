use crate::musicgen::delay_pattern_mask_ids::DelayedPatternMaskIds;
use crate::musicgen::music_gen_config::MusicGenConfig;
use crate::musicgen::music_gen_inputs::MusicGenInputs;
use crate::musicgen::music_gen_outputs::MusicGenOutputs;
use crate::musicgen::tensor_ops::{dupe_zeros_along_first_dim, zeros_tensor};
use ort::session::Session;
use ort::value::{DynValue, PrimitiveTensorElementType, Tensor};
use std::fmt::Debug;
use std::marker::PhantomData;
use std::sync::mpsc::Receiver;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

pub trait MusicGenType:
    PrimitiveTensorElementType + Debug + Clone + num_traits::Zero + Send + Sync
{
}

impl MusicGenType for f32 {}
impl MusicGenType for half::f16 {}

pub trait MusicGenDecoder: Send + Sync {
    fn generate_tokens(
        &self,
        last_hidden_state: DynValue,
        encoder_attention_mask: DynValue,
        max_len: usize,
        cancelled: Arc<AtomicBool>,
    ) -> ort::Result<Receiver<ort::Result<[i64; 4]>>>;
}

pub struct MusicGenMergedDecoder<T: MusicGenType> {
    pub decoder_model_merged: Arc<Mutex<Session>>,
    pub config: MusicGenConfig,
    pub _phantom_data: PhantomData<T>,
}

impl<T: MusicGenType + 'static> MusicGenDecoder for MusicGenMergedDecoder<T> {
    fn generate_tokens(
        &self,
        last_hidden_state: DynValue,
        encoder_attention_mask: DynValue,
        max_len: usize,
        cancelled: Arc<AtomicBool>,
    ) -> ort::Result<Receiver<ort::Result<[i64; 4]>>> {
        let encoder_hidden_states = dupe_zeros_along_first_dim::<T>(last_hidden_state.downcast()?)?;
        let encoder_attention_mask =
            dupe_zeros_along_first_dim::<i64>(encoder_attention_mask.downcast()?)?;
        let decoder = self.decoder_model_merged.clone();
        let config = &self.config;
        let num_hidden_layers = config.decoder.num_hidden_layers;
        let num_attention_heads = config.decoder.num_attention_heads;
        let pad_token_id = config.decoder.pad_token_id;
        let d_kv = config.text_encoder.d_kv;
        let top_k = config.decoder.top_k;
        let decoder_dims = [1, num_attention_heads, 0, d_kv];
        let encoder_dims = [1, num_attention_heads, 0, d_kv];
        let (sender, receiver) = std::sync::mpsc::channel::<ort::Result<[i64; 4]>>();
        let error_sender = sender.clone();

        std::thread::spawn(move || {
            let result = (|| {
                let mut inputs = MusicGenInputs::new();
                inputs.input_ids(Tensor::from_array(([8usize, 1], vec![pad_token_id; 8]))?)?;
                inputs.encoder_attention_mask(encoder_attention_mask)?;
                inputs.encoder_hidden_states(encoder_hidden_states)?;
                for index in 0..num_hidden_layers {
                    inputs.past_key_value_decoder_key(index, zeros_tensor::<T>(&decoder_dims))?;
                    inputs.past_key_value_decoder_value(index, zeros_tensor::<T>(&decoder_dims))?;
                    inputs.past_key_value_encoder_key(index, zeros_tensor::<T>(&encoder_dims))?;
                    inputs.past_key_value_encoder_value(index, zeros_tensor::<T>(&encoder_dims))?;
                }
                inputs.use_cache_branch(false);
                let mut pattern = DelayedPatternMaskIds::<4>::new();

                for _ in 0..max_len {
                    if cancelled.load(Ordering::Relaxed) {
                        return Err(ort::Error::new("music generation cancelled"));
                    }
                    let mut decoder = decoder
                        .lock()
                        .map_err(|_| ort::Error::new("decoder session lock failed"))?;
                    let outputs = decoder.run(inputs.ort())?;
                    let mut outputs = MusicGenOutputs::new(outputs);
                    pattern.push(
                        outputs
                            .take_logits()?
                            .apply_free_guidance(3.0)
                            .sample(top_k),
                    );
                    let [a, b, c, d] = pattern.last_delayed_masked(pad_token_id);
                    inputs.input_ids(Tensor::from_array((
                        [8usize, 1],
                        vec![a, b, c, d, a, b, c, d],
                    ))?)?;

                    if let Some(tokens) = pattern.last_de_delayed() {
                        if sender.send(Ok(tokens)).is_err() {
                            return Err(ort::Error::new("music generation consumer closed"));
                        }
                    }
                    for index in 0..num_hidden_layers {
                        inputs.past_key_value_decoder_key(
                            index,
                            outputs.take_present_decoder_key(index),
                        )?;
                        inputs.past_key_value_decoder_value(
                            index,
                            outputs.take_present_decoder_value(index),
                        )?;
                        if !inputs.use_cache_branch {
                            inputs.past_key_value_encoder_key(
                                index,
                                outputs.take_present_encoder_key(index),
                            )?;
                            inputs.past_key_value_encoder_value(
                                index,
                                outputs.take_present_encoder_value(index),
                            )?;
                        }
                    }
                    inputs.use_cache_branch(true);
                }
                Ok(())
            })();
            if let Err(error) = result {
                let _ = error_sender.send(Err(error));
            }
        });
        Ok(receiver)
    }
}
