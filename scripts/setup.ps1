$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
if (-not (Test-Path -LiteralPath '.docker.env')) {
  @("POSTGRES_PASSWORD=$(New-Secret)", "APP_DB_PASSWORD=$(New-Secret)", "TOTP_ENCRYPTION_KEY=$(New-Secret)", "TEST_DB_PASSWORD=$(New-Secret)", 'WALLET_PORT=3080') | Set-Content -LiteralPath '.docker.env' -Encoding ascii
}
if (-not (Test-Path -LiteralPath '.local')) { New-Item -ItemType Directory -Path '.local' | Out-Null }
if (-not (Test-Path -LiteralPath '.local/master.json')) {
  @{name='Auditor master'; email='master@carteira.local'; password=(New-Secret)} | ConvertTo-Json | Set-Content -LiteralPath '.local/master.json' -Encoding utf8
}
docker compose --env-file .docker.env up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar os serviços.' }
Get-Content -LiteralPath '.local/master.json' -Raw | docker compose --env-file .docker.env exec -T api node dist/operator.js master
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível provisionar o master.' }
Write-Output 'Carteira disponível em http://localhost:3080. Credenciais master: .local/master.json. Configure o 2FA no primeiro acesso.'
