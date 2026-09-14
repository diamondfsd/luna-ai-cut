use half::f16;
use ndarray::{s, Array, Array2, Axis, Ix2, Ix3, IxDyn};
use ort::value::DynValue;
use rand::distributions::WeightedIndex;
use rand::{thread_rng, Rng};
use std::fmt::{Debug, Formatter};
use std::ops::{Deref, DerefMut};

pub struct Logits(Array2<f32>);

impl From<Array<f32, IxDyn>> for Logits {
    fn from(value: Array<f32, IxDyn>) -> Self {
        Self(
            value
                .into_dimensionality::<Ix2>()
                .expect("logits must be two-dimensional"),
        )
    }
}

impl Deref for Logits {
    type Target = Array2<f32>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for Logits {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Debug for Logits {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}", self.0)
    }
}

impl Logits {
    pub fn from_3d_dyn_value(value: &DynValue) -> ort::Result<Self> {
        let array = if let Ok((shape, data)) = value.try_extract_tensor::<f32>() {
            Array::from_shape_vec(shape.to_ixdyn(), data.to_vec())
                .map_err(|_| ort::Error::new("decoder logits shape is invalid"))?
        } else {
            let (shape, data) = value.try_extract_tensor::<f16>()?;
            Array::from_shape_vec(
                shape.to_ixdyn(),
                data.iter().copied().map(f32::from).collect(),
            )
            .map_err(|_| ort::Error::new("decoder logits shape is invalid"))?
        };
        let array = array
            .into_dimensionality::<Ix3>()
            .map_err(|_| ort::Error::new("decoder logits must be three-dimensional"))?;
        if array.shape()[1] != 1 {
            return Err(ort::Error::new(
                "decoder logits sequence length must be one",
            ));
        }
        Ok(Self(array.remove_axis(Axis(1))))
    }

    pub fn apply_free_guidance(self, guidance_scale: f32) -> Self {
        if self.0.dim().0 % 2 != 0 {
            panic!("free guidance requires an even decoder batch");
        }
        let batch_size = self.0.dim().0 / 2;
        let conditional = self.0.slice(s![0..batch_size, ..]);
        let unconditional = self.0.slice(s![batch_size.., ..]);
        Self((conditional.into_owned() - &unconditional) * guidance_scale + unconditional)
    }

    pub fn sample(&self, top_k: usize) -> Vec<i64> {
        self.0
            .axis_iter(Axis(0))
            .map(|row| {
                let max = row.iter().copied().fold(f32::NEG_INFINITY, f32::max);
                let mut ranked = row
                    .iter()
                    .enumerate()
                    .map(|(index, value)| (index as i64, (*value - max).exp()))
                    .collect::<Vec<_>>();
                let sum = ranked
                    .iter()
                    .map(|(_, value)| *value)
                    .sum::<f32>()
                    .max(f32::EPSILON);
                ranked.iter_mut().for_each(|(_, value)| *value /= sum);
                ranked.sort_by(|left, right| right.1.total_cmp(&left.1));
                ranked.truncate(top_k.max(1).min(ranked.len()));
                let distribution = WeightedIndex::new(ranked.iter().map(|(_, value)| *value))
                    .expect("decoder probability distribution");
                ranked[thread_rng().sample(distribution)].0
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Logits;
    use ndarray::Array;

    #[test]
    fn guidance_keeps_one_conditional_batch() {
        let logits = Logits::from(Array::from(vec![[10., -1., 3.], [-1., 1., 11.]]).into_dyn());
        assert_eq!(logits.apply_free_guidance(3.0).shape(), &[1, 3]);
    }
}
