import type { DjiModelProfile } from './djiModels'

function scriptValue(value: unknown): string {
  return JSON.stringify(value)
}

export function matchesDjiBluetoothName(name: string | undefined, profile: DjiModelProfile): boolean {
  const candidate = String(name || '').trim().toLowerCase()
  if (!candidate) return false
  if (profile.ble.excludedNamePrefixes.some((prefix) => candidate.startsWith(String(prefix).toLowerCase()))) return false
  return profile.ble.namePrefixes.some((prefix) => candidate.startsWith(String(prefix).toLowerCase()))
}

/** Build the renderer-side Web Bluetooth broker without importing Electron APIs. */
export function buildDjiWebBluetoothConnectScript(token: string, profile: DjiModelProfile): string {
  const config = {
    token,
    namePrefixes: profile.ble.namePrefixes,
    excludedNamePrefixes: profile.ble.excludedNamePrefixes,
    serviceUuid: profile.ble.serviceUuid,
    writeCharacteristicUuid: profile.ble.writeCharacteristicUuid,
    notifyCharacteristicUuid: profile.ble.notifyCharacteristicUuid,
  }
  return `(() => {
    const config = ${scriptValue(config)};
    const stateKey = '__lunaDjiBluetoothState';
    const matches = (name) => {
      const candidate = String(name || '').trim().toLowerCase();
      if (!candidate) return false;
      if (config.excludedNamePrefixes.some((prefix) => candidate.startsWith(String(prefix).toLowerCase()))) return false;
      return config.namePrefixes.some((prefix) => candidate.startsWith(String(prefix).toLowerCase()));
    };
    const toHex = (value) => Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const emit = (event, characteristic, payloadHex, message) => {
      if (!window.luna?.djiBluetooth?.emit) throw new Error('Luna 蓝牙页面桥接不可用');
      window.luna.djiBluetooth.emit({ token: config.token, event, characteristic, payloadHex, message });
    };
    const stage = (message) => {
      try { emit('stage', '', '', message); } catch (_) {}
    };
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
      let state = null;
      let source = 'request';
      try {
        stage('检查已授权的蓝牙设备');
        if (typeof navigator.bluetooth.getDevices === 'function') {
          const grantedDevices = await navigator.bluetooth.getDevices();
          device = grantedDevices.find((candidate) => matches(candidate.name));
          if (device) {
            source = 'granted';
            stage('找到已授权设备');
          }
        }
        if (!device) {
          stage('未找到已授权设备，开始扫描');
          device = await navigator.bluetooth.requestDevice({
            filters: config.namePrefixes.map((namePrefix) => ({ namePrefix })),
            optionalServices: [config.serviceUuid],
          });
          stage('扫描已选择设备');
        }
        if (!device?.gatt) throw new Error('蓝牙设备不支持 GATT');
        stage('开始连接 GATT');
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(config.serviceUuid);
        stage('GATT 服务已发现');
        const writeCharacteristic = await service.getCharacteristic(config.writeCharacteristicUuid);
        stage('写入特征已发现');
        const notifyCharacteristic = await service.getCharacteristic(config.notifyCharacteristicUuid);
        stage('通知特征已发现');
        const notificationHandlers = [];
        const forwardNotification = (event) => {
          const value = event.target?.value;
          if (value) emit('notification', event.target.uuid, toHex(value));
        };
        const disconnectHandler = () => {
          try { emit('disconnected', '', '', '蓝牙设备已断开'); } catch (_) {}
        };
        state = { token: config.token, device, writeCharacteristic, notifyCharacteristic, notificationHandlers, disconnectHandler };
        window[stateKey] = state;
        for (const characteristic of [notifyCharacteristic, ...(writeCharacteristic.uuid === notifyCharacteristic.uuid ? [] : [writeCharacteristic])]) {
          const handler = forwardNotification;
          characteristic.addEventListener('characteristicvaluechanged', handler);
          notificationHandlers.push({ characteristic, handler });
        }
        stage('正在启用蓝牙通知');
        await notifyCharacteristic.startNotifications();
        if (writeCharacteristic.uuid !== notifyCharacteristic.uuid) {
          stage('正在启用写入特征通知');
          await writeCharacteristic.startNotifications();
        }
        stage('蓝牙连接准备完成');
        return {
          deviceId: device.id,
          deviceName: device.name || '',
          source,
          serviceUuid: service.uuid,
          writeCharacteristicUuid: writeCharacteristic.uuid,
          notifyCharacteristicUuid: notifyCharacteristic.uuid,
        };
      } catch (error) {
        stage('蓝牙连接失败');
        cleanup(state);
        if (!state && device) {
          try { if (device.gatt?.connected) device.gatt.disconnect(); } catch (_) {}
        }
        window[stateKey] = null;
        throw error;
      }
    })();
  })()`
}
