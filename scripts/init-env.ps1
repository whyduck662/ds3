$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot '..\.env'
if (Test-Path -LiteralPath $target) { Write-Host '.env da ton tai, giu nguyen.'; exit 0 }
$keys = @('JWT_SECRET','RABBITMQ_PASSWORD','IDENTITY_DB_PASSWORD','DRIVER_DB_PASSWORD','TRIP_DB_PASSWORD','MATCHING_DB_PASSWORD','PAYMENT_DB_PASSWORD','NOTIFICATION_DB_PASSWORD')
$lines = foreach ($key in $keys) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $value = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  "$key=$value"
}
[System.IO.File]::WriteAllLines($target, $lines)
Write-Host 'Da tao .env voi secret ngau nhien.'
