$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
docker compose -f deploy/compose.test.yaml up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Khong khoi dong duoc DB/MQ test; kiem tra Docker Desktop' }
try {
  npm.cmd run test:integration
  if ($LASTEXITCODE -ne 0) { throw 'Integration TV1 that bai, xem artifacts/integration.json' }
} finally {
  docker compose -f deploy/compose.test.yaml down --volumes
}
