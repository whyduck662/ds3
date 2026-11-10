param([Parameter(Mandatory=$true)][ValidateSet('identity-service','notification-service','api-gateway','trip-service','payment-service','driver-service','matching-service','matching-service-2','rabbitmq')][string]$Service)
Set-Location (Join-Path $PSScriptRoot '..')
docker compose kill $Service
if ($LASTEXITCODE -ne 0) { throw 'Khong kill duoc service' }
Write-Host "Khoi phuc bang: docker compose up -d $Service"
