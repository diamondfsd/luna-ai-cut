use crate::musicgen::logits::Logits;
use ort::session::SessionOutputs;
use ort::value::DynValue;

pub struct MusicGenOutputs<'r> {
    outputs: SessionOutputs<'r>,
}

impl<'r> MusicGenOutputs<'r> {
    pub fn new(outputs: SessionOutputs<'r>) -> Self {
        Self { outputs }
    }

    pub fn take_logits(&mut self) -> ort::Result<Logits> {
        let output = self
            .outputs
            .remove("logits")
            .ok_or_else(|| ort::Error::new("decoder output logits is missing"))?;
        Logits::from_3d_dyn_value(&output)
    }

    fn take(&mut self, name: String) -> DynValue {
        self.outputs
            .remove(&name)
            .unwrap_or_else(|| panic!("{name} was already taken from outputs"))
    }

    pub fn take_present_decoder_key(&mut self, index: usize) -> DynValue {
        self.take(format!("present.{index}.decoder.key"))
    }

    pub fn take_present_decoder_value(&mut self, index: usize) -> DynValue {
        self.take(format!("present.{index}.decoder.value"))
    }

    pub fn take_present_encoder_key(&mut self, index: usize) -> DynValue {
        self.take(format!("present.{index}.encoder.key"))
    }

    pub fn take_present_encoder_value(&mut self, index: usize) -> DynValue {
        self.take(format!("present.{index}.encoder.value"))
    }
}
