use ort::session::SessionInputs;
use ort::value::{DynValue, Tensor};
use std::collections::HashMap;

pub struct MusicGenInputs {
    inputs: HashMap<String, DynValue>,
    pub use_cache_branch: bool,
}

impl MusicGenInputs {
    pub fn new() -> Self {
        Self {
            inputs: HashMap::new(),
            use_cache_branch: false,
        }
    }

    pub fn encoder_attention_mask<T, E>(&mut self, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs
            .insert("encoder_attention_mask".to_string(), value.try_into()?);
        Ok(())
    }

    pub fn input_ids<T, E>(&mut self, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs
            .insert("input_ids".to_string(), value.try_into()?);
        Ok(())
    }

    pub fn encoder_hidden_states<T, E>(&mut self, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs
            .insert("encoder_hidden_states".to_string(), value.try_into()?);
        Ok(())
    }

    pub fn past_key_value_decoder_key<T, E>(&mut self, index: usize, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs.insert(
            format!("past_key_values.{index}.decoder.key"),
            value.try_into()?,
        );
        Ok(())
    }

    pub fn past_key_value_decoder_value<T, E>(&mut self, index: usize, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs.insert(
            format!("past_key_values.{index}.decoder.value"),
            value.try_into()?,
        );
        Ok(())
    }

    pub fn past_key_value_encoder_key<T, E>(&mut self, index: usize, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs.insert(
            format!("past_key_values.{index}.encoder.key"),
            value.try_into()?,
        );
        Ok(())
    }

    pub fn past_key_value_encoder_value<T, E>(&mut self, index: usize, value: T) -> Result<(), E>
    where
        DynValue: TryFrom<T, Error = E>,
    {
        self.inputs.insert(
            format!("past_key_values.{index}.encoder.value"),
            value.try_into()?,
        );
        Ok(())
    }

    pub fn use_cache_branch(&mut self, value: bool) {
        self.use_cache_branch = value;
        self.inputs.insert(
            "use_cache_branch".to_string(),
            Tensor::from_array(([1usize], vec![value]))
                .expect("cache branch tensor")
                .into_dyn(),
        );
    }

    pub fn ort(&self) -> SessionInputs<'_, '_> {
        SessionInputs::ValueMap(
            self.inputs
                .iter()
                .map(|(name, value)| (name.to_string().into(), value.view().into()))
                .collect(),
        )
    }
}
