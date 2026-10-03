param(
  [string]$ResourcesDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $ResourcesDir 'ios-usb'
$requiredFiles = @(
  'iproxy.exe',
  'idevice_id.exe',
  'libusbmuxd-2.0.dll',
  'libimobiledevice-1.0.dll',
  'libimobiledevice-glue-1.0.dll',
  'libplist-2.0.dll'
)

foreach ($fileName in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir $fileName) -PathType Leaf)) {
    throw "Missing iPhone connection resource: $fileName. Reinstall the current Windows build."
  }
}

$proxyOutput = & (Join-Path $runtimeDir 'iproxy.exe') --help 2>&1
if ($LASTEXITCODE -ne 0 -or ($proxyOutput -join "`n") -notmatch 'LOCAL_PORT:DEVICE_PORT') {
  throw 'The iPhone connection tool could not run. Check the installation and security software.'
}
Write-Output 'Connection tools: OK'

$services = @(Get-Service | Where-Object {
  $_.Name -like '*Apple*Mobile*Device*' -or $_.DisplayName -like '*Apple*Mobile*Device*'
})
foreach ($service in $services) {
  Write-Output "Apple device service: $($service.Status)"
}

$client = New-Object System.Net.Sockets.TcpClient
try {
  $connection = $client.ConnectAsync('127.0.0.1', 27015)
  if (-not $connection.Wait(1500) -or -not $client.Connected) {
    throw 'Apple device service is not reachable. Install Apple Devices and check its device service.'
  }
} catch {
  throw 'Apple device service is not reachable. Install Apple Devices and check its device service.'
} finally {
  $client.Dispose()
}
Write-Output 'Apple USB connection service: OK'

$deviceOutput = & (Join-Path $runtimeDir 'idevice_id.exe') -l 2>&1
if ($LASTEXITCODE -ne 0) {
  throw 'iPhone detection failed. Check the Apple device service, USB cable and phone trust permission.'
}
$deviceCount = @($deviceOutput | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
Write-Output "USB iPhones detected: $deviceCount"
if ($deviceCount -eq 0) {
  throw 'No USB iPhone detected. Unlock the iPhone, connect a data cable and trust this computer.'
}
Write-Output 'Ready for the phone live-video test.'
