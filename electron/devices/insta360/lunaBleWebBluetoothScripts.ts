import type { DeviceDefinition } from '../../../src/shared/types'

function scriptValue(value: unknown): string {
  return JSON.stringify(value)
}

function bluetoothConfig(): NonNullable<DeviceDefinition['bluetooth']> {
  const config = {
    serviceUuid: '0000be80-0000-1000-8000-00805f9b34fb',
    writeCharacteristicUuid: '0000be81-0000-1000-8000-00805f9b34fb',
    notifyCharacteristicUuid: '0000be82-0000-1000-8000-00805f9b34fb',
  }
  return config as NonNullable<DeviceDefinition['bluetooth']>
}

export function buildLunaWebBluetoothAvailabilityScript(): string {
  return `(async () => {
    if (!navigator.bluetooth) return false;
    if (typeof navigator.bluetooth.getAvailability !== 'function') return null;
    return Boolean(await navigator.bluetooth.getAvailability());
  })()`
}

/** Connect and subscribe before returning, so no initialization notify is lost. */
export function buildLunaWebBluetoothConnectScript(token: string): string {
  const config = { ...bluetoothConfig(), token }
  return `(() => {
    const config = ${scriptValue(config)};
    const stateKey = '__lunaBluetoothState';
    const toHex = (value) => Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const emit = (event, characteristic, payloadHex, message) => {
      if (!window.luna?.lunaBluetooth?.emit) throw new Error('Luna 蓝牙页面桥接不可用');
      window.luna.lunaBluetooth.emit({ token: config.token, event, characteristic, payloadHex, message });
    };
    const errorDetail = (error) => {
      const name = typeof error?.name === 'string' ? error.name : '';
      const message = typeof error?.message === 'string' ? error.message : '';
      const detail = [name, message].filter(Boolean).join(': ');
      if (detail) return detail;
      const text = String(error || '未知错误');
      return text === '[object Object]' ? '未知错误' : text;
    };
    const stage = (message) => { try { emit('stage', '', '', message); } catch (_) {} };
    const cleanup = (state) => {
      if (!state) return;
      for (const item of state.notificationHandlers) item.characteristic.removeEventListener('characteristicvaluechanged', item.handler);
      state.device.removeEventListener('gattserverdisconnected', state.disconnectHandler);
      try { if (state.device.gatt?.connected) state.device.gatt.disconnect(); } catch (_) {}
    };
    return (async () => {
      cleanup(window[stateKey]);
      window[stateKey] = null;
      if (!navigator.bluetooth) throw new Error('当前 Electron 没有可用的 Web Bluetooth');
      let device = null;
      let source = 'request';
      try {
        stage('检查已授权的 Luna 设备');
        if (typeof navigator.bluetooth.getDevices === 'function') {
          const grantedDevices = await navigator.bluetooth.getDevices();
          device = null;
          for (const candidate of grantedDevices) {
            try {
              if (!candidate?.gatt) continue;
              const server = await candidate.gatt.connect();
              await server.getPrimaryService(config.serviceUuid);
              try { candidate.gatt.disconnect(); } catch (_) {}
              device = candidate;
              break;
            } catch (_) {
              try { if (candidate?.gatt?.connected) candidate.gatt.disconnect(); } catch (_) {}
            }
          }
          if (device) { source = 'granted'; stage('找到已授权设备'); }
        }
        if (!device) {
          stage('开始扫描 Luna 设备');
          device = await navigator.bluetooth.requestDevice({
            // The camera advertises this service. Filter at discovery time so
            // Electron cannot select an unrelated nearby BLE device.
            filters: [{ services: [config.serviceUuid] }],
            optionalServices: [config.serviceUuid],
          });
          stage('扫描已选择设备');
        }
        if (!device?.gatt) throw new Error('Luna 设备不支持 GATT');
        stage('连接 Luna 蓝牙');
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(config.serviceUuid);
        const writeCharacteristic = await service.getCharacteristic(config.writeCharacteristicUuid);
        const notifyCharacteristic = await service.getCharacteristic(config.notifyCharacteristicUuid);
        const notificationHandlers = [];
        const forwardNotification = (event) => {
          const value = event.target?.value;
          if (value) emit('notification', event.target.uuid, toHex(value));
        };
        const disconnectHandler = () => {
          try { emit('disconnected', '', '', 'Luna 蓝牙设备已断开'); } catch (_) {}
        };
        const state = { token: config.token, device, writeCharacteristic, notifyCharacteristic, notificationHandlers, disconnectHandler };
        window[stateKey] = state;
        const handler = forwardNotification;
        notifyCharacteristic.addEventListener('characteristicvaluechanged', handler);
        notificationHandlers.push({ characteristic: notifyCharacteristic, handler });
        stage('启用 Luna 蓝牙通知');
        await notifyCharacteristic.startNotifications();
        state.ready = true;
        stage('Luna 蓝牙连接准备完成');
        return {
          deviceId: device.id,
          deviceName: device.name || '',
          source,
          serviceUuid: service.uuid,
          writeCharacteristicUuid: writeCharacteristic.uuid,
          notifyCharacteristicUuid: notifyCharacteristic.uuid,
        };
      } catch (error) {
        stage('Luna 蓝牙连接失败：' + errorDetail(error));
        cleanup(window[stateKey]);
        if (!window[stateKey] && device) {
          try { if (device.gatt?.connected) device.gatt.disconnect(); } catch (_) {}
        }
        window[stateKey] = null;
        throw error;
      }
    })();
  })()`
}

export function buildLunaWebBluetoothWriteScript(token: string, payload: number[]): string {
  return `(async () => {
    const state = window.__lunaBluetoothState;
    if (!state || state.token !== ${scriptValue(token)} || !state.ready) throw new Error('Luna 蓝牙会话不存在');
    const bytes = new Uint8Array(${scriptValue(payload)});
    if (typeof state.writeCharacteristic.writeValueWithResponse === 'function') {
      await state.writeCharacteristic.writeValueWithResponse(bytes);
    } else if (typeof state.writeCharacteristic.writeValue === 'function') {
      await state.writeCharacteristic.writeValue(bytes);
    } else {
      throw new Error('Luna 蓝牙写入特征不可用');
    }
  })()`
}

export function buildLunaWebBluetoothCleanupScript(token: string): string {
  return `(() => {
    const state = window.__lunaBluetoothState;
    if (state && state.token === ${scriptValue(token)}) {
      for (const item of state.notificationHandlers) item.characteristic.removeEventListener('characteristicvaluechanged', item.handler);
      state.device.removeEventListener('gattserverdisconnected', state.disconnectHandler);
      try { if (state.device.gatt?.connected) state.device.gatt.disconnect(); } catch (_) {}
      window.__lunaBluetoothState = null;
    }
  })()`
}
