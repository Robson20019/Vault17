# redeploy-vault.ps1 — publica de novo SÓ o contrato do vault (mantém token, tUSDC,
# oráculo e registro de lotes) e atualiza VITE_VAULT em web\.env.local.
#
# Uso (na raiz do projeto, PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\redeploy-vault.ps1
#
# Motivo (25/10/2026): a quitação transferia o valor da dívida, que muda a cada
# segundo por causa dos juros. A autorização gravada na simulação não batia com a
# execução e a rede rejeitava (InvokeHostFunction Trapped). O vault novo recebe o
# valor pedido (fixo) e devolve o excedente.

$ErrorActionPreference = "Continue"
$NET = "testnet"
$env:STELLAR_INCLUSION_FEE = "100000"
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT
$envFile = Join-Path $ROOT "web\.env.local"

function Say($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Check($what) {
  if ($LASTEXITCODE -ne 0) { Write-Host "Falhou: $what (código $LASTEXITCODE)." -ForegroundColor Red; exit 1 }
}
function EnvValue($key) {
  $line = Get-Content $envFile | Where-Object { $_ -like "$key=*" } | Select-Object -First 1
  if (-not $line) { Write-Host "Não achei $key em web\.env.local" -ForegroundColor Red; exit 1 }
  return ($line -split "=", 2)[1].Trim()
}

$ADMIN     = (stellar keys address vault17-admin).Trim()
$LOT_TOKEN = EnvValue "VITE_LOT_TOKEN"
$USDC      = EnvValue "VITE_USDC"
$ORACLE    = EnvValue "VITE_ORACLE"
$OLD_VAULT = EnvValue "VITE_VAULT"
Write-Host "   vault antigo: $OLD_VAULT"

Say "Compilando"
stellar contract build --package vault
Check "compilar o vault"

Say "Enviando o código do vault"
$out = stellar contract upload --wasm "target\wasm32v1-none\release\vault.wasm" --source vault17-admin --network $NET
Check "enviar o código"
$HASH = ($out | Select-Object -Last 1).ToString().Trim()

Say "Publicando o vault novo"
$out = stellar contract deploy --wasm-hash $HASH --source vault17-admin --network $NET -- `
  --admin $ADMIN --lot_token $LOT_TOKEN --usdc $USDC --oracle $ORACLE --asset NDPR `
  --max_ltv_bps 4000 --alert_ltv_bps 5500 --freeze_ltv_bps 6500 --liquidation_ltv_bps 7500 `
  --rate_bps 1200 --max_price_age 172800
Check "publicar o vault"
$VAULT = ($out | Select-Object -Last 1).ToString().Trim()
Write-Host "   vault novo: $VAULT"

(Get-Content $envFile) | ForEach-Object { if ($_ -like "VITE_VAULT=*") { "VITE_VAULT=$VAULT" } else { $_ } } |
  Set-Content -Encoding ascii $envFile
Write-Host "   web\.env.local atualizado"

Say "Ligando o vault novo"
stellar contract invoke --id $LOT_TOKEN --source vault17-admin --network $NET -- allow_user --user $VAULT --operator $ADMIN | Out-Null
Check "liberar o vault no token do lote"
Write-Host "   ok: vault liberado no token do lote"
stellar contract invoke --id $USDC --source vault17-admin --network $NET -- mint --to $ADMIN --amount 1000000000000 | Out-Null
Check "emitir 100.000 tUSDC para o admin"
stellar contract invoke --id $VAULT --source vault17-admin --network $NET -- supply --provider $ADMIN --amount 1000000000000 | Out-Null
Check "depositar liquidez"
Write-Host "   ok: 100.000 tUSDC de liquidez no vault novo"

Say "Pronto"
Write-Host "Reinicie o painel (Ctrl+C e npm run dev na pasta web) para ler o novo VITE_VAULT."
Write-Host "Os tokens do lote #1 ficaram no vault antigo: cadastre e ateste um lote novo para a demo."
