# Reset co chu dich: chi xoa du lieu cua Compose project ds03.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
docker compose down --volumes
if ($LASTEXITCODE -ne 0) { throw 'Reset that bai' }
& "$PSScriptRoot/start.ps1"
