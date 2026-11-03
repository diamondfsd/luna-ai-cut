import { useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Copy, LoaderCircle } from 'lucide-react'

import { Button, Dialog, Select, toast } from '../ui'
import type {
  LiveConnectionDebugReport,
  LiveConnectionDebugStep,
  LiveConnectionDebugTarget,
} from '../shared/types'
import './LiveConnectionDebugDialog.css'

const targetOptions = [
  { value: 'ios', label: 'iPhone · iproxy' },
  { value: 'android-adb', label: '安卓 · ADB' },
  { value: 'harmony-hdc', label: '鸿蒙 · HDC' },
]

function stateText(state: LiveConnectionDebugStep['state']): string {
  if (state === 'passed') return '正常'
  if (state === 'failed') return '异常'
  return '未检测'
}

function reportText(report: LiveConnectionDebugReport): string {
  const target = targetOptions.find((option) => option.value === report.target)?.label ?? report.target
  const lines = [
    `直播连接检测：${target}`,
    `电脑：${report.platform}`,
    `结果：${report.state === 'passed' ? '正常' : '存在异常'}`,
    `时间：${report.completedAt}`,
    ...report.steps.map((step) => `${stateText(step.state)}｜${step.title}：${step.detail}`),
  ]
  return lines.join('\n')
}

function StepIcon({ state }: { state: LiveConnectionDebugStep['state'] }) {
  if (state === 'passed') return <CheckCircle2 aria-hidden="true" />
  if (state === 'failed') return <AlertCircle aria-hidden="true" />
  return <CircleDashed aria-hidden="true" />
}

export function LiveConnectionDebugDialog() {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<LiveConnectionDebugTarget>('ios')
  const [report, setReport] = useState<LiveConnectionDebugReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runDiagnostics = async () => {
    if (running) return
    setRunning(true)
    setReport(null)
    setError(null)
    try {
      setReport(await window.luna.liveStream.diagnoseConnection(target))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
    }
  }

  const copyReport = async () => {
    if (!report) return
    try {
      await window.luna.copyText(reportText(report))
      toast.success('已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="直播调试"
      description="检测手机连接工具、USB 连接和直播端口。"
      tone="dark"
      className="live-connection-debug-dialog"
      bodyClassName="live-connection-debug-body"
      footer={(
        <>
          <Button variant="secondary" size="compact" icon={<Copy size={14} />} onClick={() => void copyReport()} disabled={!report || running}>
            复制结果
          </Button>
          <Button variant="primary" size="compact" icon={running ? <LoaderCircle className="live-connection-debug-spin" size={14} /> : <Activity size={14} />} onClick={() => void runDiagnostics()} disabled={running}>
            {running ? '检测中' : '开始检测'}
          </Button>
        </>
      )}
      trigger={<Button variant="secondary" size="compact" icon={<Activity size={14} />}>直播调试</Button>}
    >
      <div className="live-connection-debug-controls">
        <span>手机连接方式</span>
        <Select
          variant="compact"
          value={target}
          placeholder="手机连接方式"
          fullWidth
          className="live-connection-debug-select"
          options={targetOptions}
          onValueChange={(value) => {
            setTarget(value as LiveConnectionDebugTarget)
            setReport(null)
            setError(null)
          }}
        />
      </div>
      <p className="live-connection-debug-hint">请先打开手机端直播，再开始检测。</p>

      {running && <div className="live-connection-debug-progress" role="status"><LoaderCircle className="live-connection-debug-spin" size={16} />正在检查连接</div>}
      {error && <p className="live-connection-debug-error" role="alert">{error}</p>}
      {report && (
        <section className="live-connection-debug-results" aria-label="检测结果">
          <div className={`live-connection-debug-summary ${report.state}`}>
            <strong>{report.state === 'passed' ? '连接正常' : '发现连接问题'}</strong>
            <span>{report.steps.filter((step) => step.state === 'failed').length} 项异常</span>
          </div>
          <ol>
            {report.steps.map((step) => (
              <li className={`live-connection-debug-step ${step.state}`} key={step.id}>
                <StepIcon state={step.state} />
                <div className="live-connection-debug-step-copy">
                  <div className="live-connection-debug-step-heading">
                    <strong>{step.title}</strong>
                    <span>{stateText(step.state)}</span>
                  </div>
                  <p>{step.detail}</p>
                </div>
                {step.durationMs > 0 && <time>{step.durationMs} ms</time>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </Dialog>
  )
}
