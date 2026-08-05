use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    io::{self, Read},
    process::ExitCode,
    time::Instant,
};

const WINDOW_SIZE: usize = 200;
const CORE_SIZE: usize = 160;
const CONTEXT_SIZE: usize = (WINDOW_SIZE - CORE_SIZE) / 2;

#[derive(Deserialize)]
struct PunctuationRequest {
    units: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PunctuationResponse {
    punctuations: Vec<String>,
    model_load_ms: u128,
    inference_ms: u128,
}

struct PunctuationSession {
    session: Session,
    token_ids: HashMap<String, i32>,
    punctuations: Vec<String>,
    unknown_id: i32,
    no_punctuation: String,
    model_load_ms: u128,
}

fn metadata_value(session: &Session, key: &str) -> Result<String, String> {
    session
        .metadata()
        .map_err(|error| format!("读取标点模型信息失败: {error}"))?
        .custom(key)
        .ok_or_else(|| format!("标点模型缺少 {key} 信息"))
}

impl PunctuationSession {
    fn load(model_path: &str) -> Result<Self, String> {
        let started = Instant::now();
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 4))
            .unwrap_or(2);
        let session = Session::builder()
            .map_err(|error| format!("初始化标点模型失败: {error}"))?
            .with_intra_threads(threads)
            .map_err(|error| format!("配置标点模型失败: {error}"))?
            .commit_from_file(model_path)
            .map_err(|error| format!("加载标点模型失败: {error}"))?;
        let tokens = metadata_value(&session, "tokens")?;
        let punctuation_raw = metadata_value(&session, "punctuations")?;
        let unknown = metadata_value(&session, "unk_symbol")?;
        let token_ids: HashMap<String, i32> = tokens
            .split('|')
            .enumerate()
            .map(|(index, token)| (token.to_string(), index as i32))
            .collect();
        let unknown_id = *token_ids
            .get(&unknown)
            .ok_or_else(|| "标点模型缺少未知词标记".to_string())?;
        let punctuations: Vec<String> = punctuation_raw.split('|').map(str::to_string).collect();
        if punctuations.len() < 2 || !punctuations.iter().any(|value| value == "_") {
            return Err("标点模型类别不兼容".to_string());
        }
        Ok(Self {
            session,
            token_ids,
            punctuations,
            unknown_id,
            no_punctuation: "_".to_string(),
            model_load_ms: started.elapsed().as_millis(),
        })
    }

    fn token_id(&self, unit: &str) -> i32 {
        self.token_ids
            .get(unit)
            .or_else(|| self.token_ids.get(&unit.to_lowercase()))
            .copied()
            .unwrap_or(self.unknown_id)
    }

    fn infer_window(&mut self, ids: &[i32]) -> Result<Vec<usize>, String> {
        let input = Tensor::from_array(([1usize, ids.len()], ids.to_vec()))
            .map_err(|error| format!("创建标点文本输入失败: {error}"))?;
        let lengths = Tensor::from_array(([1usize], vec![ids.len() as i32]))
            .map_err(|error| format!("创建标点长度输入失败: {error}"))?;
        let outputs = self
            .session
            .run(ort::inputs!["inputs" => input, "text_lengths" => lengths])
            .map_err(|error| format!("标点分析失败: {error}"))?;
        let (_, logits) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("读取标点结果失败: {error}"))?;
        let class_count = self.punctuations.len();
        if logits.len() != ids.len() * class_count {
            return Err("标点模型结果尺寸不兼容".to_string());
        }
        Ok(logits
            .chunks_exact(class_count)
            .map(|classes| {
                classes
                    .iter()
                    .enumerate()
                    .max_by(|(_, left), (_, right)| left.total_cmp(right))
                    .map(|(index, _)| index)
                    .unwrap_or(0)
            })
            .collect())
    }

    fn predict(&mut self, units: &[String]) -> Result<Vec<String>, String> {
        if units.is_empty() {
            return Ok(Vec::new());
        }
        if units.len() > 500_000
            || units
                .iter()
                .any(|unit| unit.is_empty() || unit.chars().count() > 64)
        {
            return Err("标点文本范围无效".to_string());
        }
        let ids: Vec<i32> = units.iter().map(|unit| self.token_id(unit)).collect();
        let mut result = vec![self.no_punctuation.clone(); units.len()];
        for core_start in (0..ids.len()).step_by(CORE_SIZE) {
            let core_end = (core_start + CORE_SIZE).min(ids.len());
            let window_start = core_start.saturating_sub(CONTEXT_SIZE);
            let window_end = (core_end + CONTEXT_SIZE).min(ids.len());
            let predicted = self.infer_window(&ids[window_start..window_end])?;
            for index in core_start..core_end {
                let class_id = predicted[index - window_start];
                result[index] = self
                    .punctuations
                    .get(class_id)
                    .cloned()
                    .unwrap_or_else(|| self.no_punctuation.clone());
            }
        }
        Ok(result)
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() == 2 && args[1] == "--health-check" {
        return Ok(());
    }
    if args.len() != 2 {
        return Err("标点任务参数无效".to_string());
    }
    let mut raw = String::new();
    io::stdin()
        .read_to_string(&mut raw)
        .map_err(|error| format!("无法读取标点任务: {error}"))?;
    let request: PunctuationRequest =
        serde_json::from_str(&raw).map_err(|error| format!("标点任务格式无效: {error}"))?;
    let mut session = PunctuationSession::load(&args[1])?;
    let started = Instant::now();
    let punctuations = session.predict(&request.units)?;
    let response = PunctuationResponse {
        punctuations,
        model_load_ms: session.model_load_ms,
        inference_ms: started.elapsed().as_millis(),
    };
    serde_json::to_writer(io::stdout().lock(), &response)
        .map_err(|error| format!("无法返回标点结果: {error}"))?;
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
