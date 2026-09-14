use ndarray::Array;
use num_traits::{One, Zero};
use ort::value::{PrimitiveTensorElementType, Tensor};
use std::fmt::Debug;

pub fn zeros_tensor<T: PrimitiveTensorElementType + Debug + Clone + Zero + 'static>(
    shape: &[usize],
) -> Tensor<T> {
    ort::value::Value::from_array(Array::<T, _>::zeros(shape)).expect("zero tensor")
}

pub fn dupe_zeros_along_first_dim<
    T: PrimitiveTensorElementType + Debug + Zero + Clone + 'static,
>(
    tensor: Tensor<T>,
) -> ort::Result<Tensor<T>> {
    let (shape, data) = tensor.try_extract_tensor()?;
    let mut doubled_shape = shape.to_vec();
    doubled_shape[0] *= 2;
    let data = [data.to_vec(), vec![T::zero(); data.len()]].concat();
    Tensor::from_array((doubled_shape, data))
}

pub fn ones_tensor<T: PrimitiveTensorElementType + Debug + Clone + One + 'static>(
    shape: &[usize],
) -> Tensor<T> {
    ort::value::Value::from_array(Array::<T, _>::ones(shape)).expect("one tensor")
}
