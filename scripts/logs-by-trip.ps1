param([Parameter(Mandatory=$true)][guid]$TripId)
Set-Location (Join-Path $PSScriptRoot '..')
docker compose logs --no-color --since 30m | Select-String -SimpleMatch $TripId.ToString()
