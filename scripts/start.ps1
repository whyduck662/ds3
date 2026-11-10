$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& "$PSScriptRoot/init-env.ps1"
docker compose up --build -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose khoi dong that bai' }
npm.cmd run seed
if ($LASTEXITCODE -ne 0) { throw 'Seed that bai' }
