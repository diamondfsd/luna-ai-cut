$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$script:outputLock = New-Object object
$script:serviceUuid = $null
$script:writeUuid = $null
$script:notifyUuid = $null
$script:namePrefixes = @()
$script:excludedNamePrefixes = @()
$script:device = $null
$script:service = $null
$script:writeCharacteristic = $null
$script:notifyCharacteristic = $null
$script:notifyHandler = $null
$script:ready = $false

function Emit-Json($value) {
  [System.Threading.Monitor]::Enter($script:outputLock)
  try {
    [Console]::WriteLine(($value | ConvertTo-Json -Compress -Depth 8))
    [Console]::Out.Flush()
  } finally {
    [System.Threading.Monitor]::Exit($script:outputLock)
  }
}

function Respond([string]$id, [bool]$ok, [string]$event = $null, [string]$message = $null, [string]$code = $null, [string]$name = $null) {
  $result = [ordered]@{ id = $id; ok = $ok }
  if ($event) { $result.event = $event }
  if ($message) { $result.message = $message }
  if ($code) { $result.code = $code }
  if ($name) { $result.name = $name }
  Emit-Json $result
}

function Await-WinRt($operation) {
  $genericArgument = $operation.GetType().GenericTypeArguments
  if ($genericArgument.Count -gt 0) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
      Select-Object -First 1
    $task = $method.MakeGenericMethod($genericArgument[0]).Invoke($null, @($operation))
  } else {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
      Select-Object -First 1
    $task = $method.Invoke($null, @($operation))
  }
  return $task.GetAwaiter().GetResult()
}

function Convert-HexToBytes([string]$value) {
  $hex = ($value -replace '\s', '')
  if (($hex.Length % 2) -ne 0) { throw 'Payload must contain an even number of hexadecimal characters' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($index = 0; $index -lt $bytes.Length; $index++) {
    $bytes[$index] = [Convert]::ToByte($hex.Substring($index * 2, 2), 16)
  }
  return $bytes
}

function Convert-BufferToBytes($buffer) {
  $bytes = New-Object byte[] $buffer.Length
  [Windows.Security.Cryptography.CryptographicBuffer]::CopyToByteArray($buffer, [ref]$bytes)
  return $bytes
}

function Convert-BytesToHex([byte[]]$bytes) {
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Test-MatchingName([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) { return $false }
  $candidate = $name.ToLowerInvariant()
  foreach ($prefix in $script:excludedNamePrefixes) {
    if ($candidate.StartsWith(([string]$prefix).ToLowerInvariant())) { return $false }
  }
  if ($script:namePrefixes.Count -eq 0) { return $true }
  foreach ($prefix in $script:namePrefixes) {
    if ($candidate.StartsWith(([string]$prefix).ToLowerInvariant())) { return $true }
  }
  return $false
}

function Find-Device([string]$requestId) {
  $selector = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelector()
  $script:matchedDeviceInfo = $null
  $watcher = [Windows.Devices.Enumeration.DeviceInformation]::CreateWatcher($selector)
  $handler = [Windows.Foundation.TypedEventHandler[Windows.Devices.Enumeration.DeviceWatcher, Windows.Devices.Enumeration.DeviceInformation]]{
    param($sender, $args)
    if (Test-MatchingName $args.Name) { $script:matchedDeviceInfo = $args }
  }
  $watcher.add_Added($handler)
  $watcher.Start()
  $deadline = (Get-Date).AddSeconds(20)
  while ($null -eq $script:matchedDeviceInfo -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
  }
  $watcher.Stop()
  $watcher.remove_Added($handler)
  if ($null -eq $script:matchedDeviceInfo) { throw 'No matching DJI Bluetooth device was found' }
  return $script:matchedDeviceInfo
}

function Get-FirstGattService($result) {
  $service = $result.Services | Select-Object -First 1
  if ($null -eq $service) { throw "DJI BLE service $script:serviceUuid was not found" }
  return $service
}

function Get-FirstGattCharacteristic($result, [string]$uuid) {
  $characteristic = $result.Characteristics | Select-Object -First 1
  if ($null -eq $characteristic) { throw "DJI BLE characteristic $uuid was not found" }
  return $characteristic
}

function Enable-Notifications($characteristic) {
  $status = Await-WinRt ($characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
    [Windows.Devices.Bluetooth.GenericAttributeProfile.GattClientCharacteristicConfigurationDescriptorValue]::Notify
  ))
  if ($status -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]::Success) {
    throw "Unable to enable notifications for $($characteristic.Uuid)"
  }
}

function Connect-Dji([string]$id, $request) {
  $script:serviceUuid = [Guid]$request.serviceUuid
  $script:writeUuid = [Guid]$request.writeCharacteristicUuid
  $script:notifyUuid = [Guid]$request.notifyCharacteristicUuid
  $script:namePrefixes = @($request.namePrefixes)
  $script:excludedNamePrefixes = @($request.excludedNamePrefixes)

  $deviceInfo = Find-Device $id
  $script:device = Await-WinRt ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($deviceInfo.Id))
  if ($null -eq $script:device) { throw 'Unable to open the DJI Bluetooth device' }

  $serviceResult = Await-WinRt ($script:device.GetGattServicesForUuidAsync(
    $script:serviceUuid,
    [Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached
  ))
  $script:service = Get-FirstGattService $serviceResult

  $writeResult = Await-WinRt ($script:service.GetCharacteristicsForUuidAsync(
    $script:writeUuid,
    [Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached
  ))
  $notifyResult = Await-WinRt ($script:service.GetCharacteristicsForUuidAsync(
    $script:notifyUuid,
    [Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached
  ))
  $script:writeCharacteristic = Get-FirstGattCharacteristic $writeResult $script:writeUuid
  $script:notifyCharacteristic = Get-FirstGattCharacteristic $notifyResult $script:notifyUuid

  $script:notifyHandler = [Windows.Foundation.TypedEventHandler[Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristic, Windows.Devices.Bluetooth.GenericAttributeProfile.GattValueChangedEventArgs]]{
    param($sender, $args)
    $bytes = Convert-BufferToBytes $args.CharacteristicValue
    Emit-Json ([ordered]@{
      event = 'notification'
      characteristic = $sender.Uuid.ToString().ToLowerInvariant()
      payloadHex = Convert-BytesToHex $bytes
    })
  }
  $script:notifyCharacteristic.add_ValueChanged($script:notifyHandler)
  $script:writeCharacteristic.add_ValueChanged($script:notifyHandler)
  Enable-Notifications $script:notifyCharacteristic
  Enable-Notifications $script:writeCharacteristic
  $script:ready = $true
  Respond $id $true 'ready' $null $null $deviceInfo.Name
}

function Write-Dji([string]$id, $request) {
  if (-not $script:ready) { throw 'DJI Bluetooth is not ready' }
  $bytes = Convert-HexToBytes $request.payloadHex
  $buffer = [Windows.Security.Cryptography.CryptographicBuffer]::CreateFromByteArray($bytes)
  $status = Await-WinRt ($script:writeCharacteristic.WriteValueAsync(
    $buffer,
    [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]::WriteWithoutResponse
  ))
  if ($status -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]::Success) {
    throw 'DJI Bluetooth write failed'
  }
  Respond $id $true
}

function Arm-Dji([string]$id) {
  if (-not $script:ready) { throw 'DJI Bluetooth is not ready' }
  $bytes = [byte[]](0x01, 0x00)
  $buffer = [Windows.Security.Cryptography.CryptographicBuffer]::CreateFromByteArray($bytes)
  $status = Await-WinRt ($script:notifyCharacteristic.WriteValueAsync(
    $buffer,
    [Windows.Devices.Bluetooth.GenericAttributeProfile.GattWriteOption]::WriteWithResponse
  ))
  if ($status -ne [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]::Success) {
    throw 'DJI Bluetooth arm failed'
  }
  Respond $id $true
}

function Close-Dji([string]$id) {
  if ($script:notifyCharacteristic -and $script:notifyHandler) {
    $script:notifyCharacteristic.remove_ValueChanged($script:notifyHandler)
  }
  if ($script:writeCharacteristic -and $script:notifyHandler) {
    $script:writeCharacteristic.remove_ValueChanged($script:notifyHandler)
  }
  if ($script:device) { $script:device.Dispose() }
  $script:ready = $false
  Respond $id $true
  [Environment]::Exit(0)
}

function Handle-Request($request) {
  try {
    switch ([string]$request.command) {
      'connect' { Connect-Dji ([string]$request.id) $request; break }
      'arm' { Arm-Dji ([string]$request.id); break }
      'write' { Write-Dji ([string]$request.id) $request; break }
      'close' { Close-Dji ([string]$request.id); break }
      default { Respond ([string]$request.id) $false $null "Unknown command: $($request.command)" 'INVALID_COMMAND' }
    }
  } catch {
    Respond ([string]$request.id) $false $null $_.Exception.Message 'BLE_OPERATION_FAILED'
  }
}

while ($null -ne ($line = [Console]::ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    Handle-Request ($line | ConvertFrom-Json)
  } catch {
    Emit-Json ([ordered]@{ event = 'error'; message = $_.Exception.Message })
  }
}

if ($script:device) { $script:device.Dispose() }
