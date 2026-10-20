import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import type { DirectorLabDiscoveredService } from '../shared/types'
import { Button, Dialog, Input, SegmentedControl, Select, toast } from '../ui'
import './DirectorLabPairDialog.css'

type AddressMode = 'search' | 'manual'

const PHONE_SERVICE_PORT = 47821

function endpointForIp(value: string): string {
  const octets = value.trim().split('.')
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet)
    || Number(octet) > 255)) {
    throw new Error('请输入有效的 IP 地址')
  }
  return `http://${octets.map(Number).join('.')}:${PHONE_SERVICE_PORT}`
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPaired: (endpoint: string) => Promise<boolean>
}

export function DirectorLabPairDialog({ open, onOpenChange, onPaired }: Props) {
  const [services, setServices] = useState<DirectorLabDiscoveredService[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [addressMode, setAddressMode] = useState<AddressMode>('search')
  const [manualIp, setManualIp] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState('')

  const discover = useCallback(async (): Promise<void> => {
    setScanning(true)
    setError('')
    try {
      const result = await window.luna.directorLab.discover()
      setServices(result.services)
      setSelectedServiceId((current) => result.services.some((service) => service.id === current)
        ? current : result.services[0]?.id ?? '')
    } catch {
      setServices([])
      setSelectedServiceId('')
      setError('搜索手机失败')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setPairingCode('')
    setError('')
  }, [open])

  useEffect(() => {
    if (!open || addressMode !== 'search') return
    void discover()
  }, [addressMode, discover, open])

  const selectedService = services.find((service) => service.id === selectedServiceId)
  const options = services.map((service) => ({
    value: service.id,
    label: `${service.name} · ${service.host}`,
  }))

  async function pair(): Promise<void> {
    if (pairingCode.length !== 6 || pairing) return
    let endpoint: string
    try {
      if (addressMode === 'manual') {
        endpoint = endpointForIp(manualIp)
      } else {
        if (!selectedService) return
        endpoint = selectedService.baseUrl
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请输入有效的 IP 地址')
      return
    }
    setPairing(true)
    setError('')
    try {
      await window.luna.lunaKaHttpClient.pair(endpoint, pairingCode)
      const connected = await onPaired(endpoint)
      if (!connected) throw new Error('配对成功，但手机暂时无法连接')
      toast.success('配对成功')
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '配对失败')
    } finally {
      setPairing(false)
    }
  }

  const canPair = addressMode === 'manual' ? manualIp.trim().length > 0 : !!selectedService

  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title="配对手机"
    tone="dark"
    className="director-lab-pair-dialog"
    bodyClassName="director-lab-pair-dialog-body"
    closeOnMaskClick={!pairing}
    showCloseButton={!pairing}
    footer={<>
      <Button variant="secondary" disabled={pairing} onClick={() => onOpenChange(false)}>取消</Button>
      <Button variant="primary" disabled={pairing || !canPair || pairingCode.length !== 6}
        onClick={() => void pair()}>{pairing ? '配对中' : '配对'}</Button>
    </>}
  >
    <div className="director-lab-pair-fields">
      <SegmentedControl
        ariaLabel="配对地址方式"
        className="director-lab-pair-mode"
        options={[{ value: 'search', label: '自动搜索' }, { value: 'manual', label: '手动输入' }]}
        value={addressMode}
        onChange={(mode) => {
          setAddressMode(mode)
          setError('')
        }}
      />
      {addressMode === 'search' ? (
        <div className="director-lab-pair-device">
          <Select
            fullWidth
            value={selectedServiceId}
            options={options}
            placeholder="选择手机"
            disabled={scanning || services.length === 0 || pairing}
            onValueChange={setSelectedServiceId}
          />
          <Button variant="utility" size="default" disabled={scanning || pairing}
            aria-label="重新搜索手机" onClick={() => void discover()}>
            <RefreshCw size={15} className={scanning ? 'is-spinning' : undefined} />
          </Button>
        </div>
      ) : (
        <Input
          fullWidth
          aria-label="手机 IP 地址"
          placeholder="输入手机 IP 地址"
          inputMode="decimal"
          autoComplete="off"
          disabled={pairing}
          value={manualIp}
          onChange={(event) => {
            setManualIp(event.target.value)
            setError('')
          }}
        />
      )}
      <Input
        fullWidth
        className="director-lab-pair-code"
        aria-label="配对码"
        placeholder="输入 6 位配对码"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={pairing}
        value={pairingCode}
        onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      {error && <p className="director-lab-pair-error" role="alert">{error}</p>}
    </div>
  </Dialog>
}
