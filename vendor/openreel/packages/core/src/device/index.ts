export {
  type DeviceTier,
  type CpuInfo,
  type MemoryInfo,
  type GpuInfo,
  type DeviceCodecSupport,
  type EncodingSupport,
  type BenchmarkResult,
  type DeviceProfile,
  type CodecRecommendation,
  detectDeviceCapabilities,
  getDeviceProfile,
  getCodecRecommendations,
  getResolutionRecommendations,
  saveBenchmarkResult,
  clearBenchmarkCache,
  formatDeviceSummary,
} from "./device-capabilities";

export {
  type ExportEstimateSettings,
  type TimeEstimate,
  type BenchmarkProgress,
  estimateExportTime,
  compareCodecEstimates,
  runBenchmark,
  shouldRecommendBenchmark,
} from "./export-estimator";
