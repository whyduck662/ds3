$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  node --input-type=module -e "import { ensureEnv } from './scripts/env.mjs'; console.log('Added configuration keys: ' + ensureEnv().length);"
  if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc cau hinh .env' }
} finally { Pop-Location }
