#[derive(Debug)]
pub struct DelayedPatternMaskIds<const N: usize> {
    batches: [Vec<i64>; N],
}

impl<const N: usize> DelayedPatternMaskIds<N> {
    pub fn new() -> Self {
        assert!(N > 0, "N needs to be greater than 0");
        Self {
            batches: [(); N].map(|()| vec![]),
        }
    }

    pub fn push(&mut self, token_ids: impl IntoIterator<Item = i64>) {
        let mut index = 0;
        for token_id in token_ids {
            assert!(index < N, "Expected exactly {N} token_ids");
            self.batches[index].push(token_id);
            index += 1;
        }
        assert_eq!(index, N, "Expected exactly {N} token_ids");
    }

    pub fn last_delayed_masked(&self, pad_token_id: i64) -> [i64; N] {
        let sequence_length = self.batches[0].len();
        let mut result = [0; N];
        for (index, item) in result.iter_mut().enumerate() {
            *item = if sequence_length <= index {
                pad_token_id
            } else {
                *self.batches[index].last().expect("There are no input_ids")
            };
        }
        result
    }

    pub fn last_de_delayed(&self) -> Option<[i64; N]> {
        if self.batches[0].len() < N {
            return None;
        }
        let mut result = [0; N];
        for (index, item) in result.iter_mut().enumerate() {
            *item = self.batches[index][self.batches[index].len() - N + index];
        }
        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::DelayedPatternMaskIds;

    #[test]
    fn delayed_pattern_is_masked_until_all_codebooks_are_ready() {
        let mut ids = DelayedPatternMaskIds::<4>::new();
        assert_eq!(ids.last_delayed_masked(0), [0, 0, 0, 0]);
        ids.push([1, 2, 3, 4]);
        assert_eq!(ids.last_delayed_masked(0), [1, 0, 0, 0]);
        ids.push([5, 6, 7, 8]);
        assert_eq!(ids.last_delayed_masked(0), [5, 6, 0, 0]);
        ids.push([9, 10, 11, 12]);
        assert_eq!(ids.last_delayed_masked(0), [9, 10, 11, 0]);
        ids.push([13, 14, 15, 16]);
        assert_eq!(ids.last_de_delayed(), Some([1, 6, 11, 16]));
    }
}
