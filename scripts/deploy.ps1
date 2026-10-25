# deploy.ps1 — publica e configura os contratos do Vault17 na TESTNET da Stellar
# e grava os IDs em web\.env.local.
#
# Uso (na raiz do projeto, PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
#
# Rodar de novo publica tudo do zero (contratos novos; ok para testnet).
# Contas (só testnet, guardadas pelo Stellar CLI na sua máquina):
#   vault17-admin   -> admin dos contratos, custodiante, oráculo e investidor da demo
#   vault17-tomador -> trader/tomador do empréstimo
# Nenhuma chave é impressa ou gravada no repositório.
#
# Observação: em out/2026 o aluguel de armazenamento na testnet está caro. Por isso
# o admin é reabastecido com contas extras do Friendbot antes de publicar.

# "Continue": no Windows PowerShell 5.1, "Stop" transforma avisos do CLI (stderr) em erro.
$ErrorActionPreference = "Continue"
$NET = "testnet"
$env:STELLAR_INCLUSION_FEE = "100000"   # taxa de prioridade: 0,01 XLM por transação
$WASM = "target\wasm32v1-none\release"
$GAS_ACCOUNTS = 3                        # cada uma traz 10.000 XLM de teste
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

function Say($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Check($what) {
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Falhou: $what (código $LASTEXITCODE). Veja a mensagem acima." -ForegroundColor Red
    exit 1
  }
}

function EnsureKey($name) {
  stellar keys address $name *> $null
  if ($LASTEXITCODE -ne 0) {
    stellar keys generate $name --network $NET --fund
    Check "criar a conta $name"
  }
  return (stellar keys address $name).Trim()
}

function TopUp($target, $count) {
  for ($i = 1; $i -le $count; $i++) {
    $gas = "vault17-gas-" + (Get-Date -Format "HHmmssfff")
    stellar keys generate $gas --network $NET --fund *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host "   Friendbot falhou (conta $i); seguindo." -ForegroundColor Yellow; continue }
    stellar tx new account-merge --source $gas --account $target --network $NET *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "   +10.000 XLM ($i/$count)" } else { Write-Host "   Transferência $i falhou; seguindo." -ForegroundColor Yellow }
  }
}

function Upload($wasmName) {
  $out = stellar contract upload --wasm "$WASM\$wasmName.wasm" --source vault17-admin --network $NET
  Check "enviar o código de $wasmName"
  return ($out | Select-Object -Last 1).ToString().Trim()
}

function Deploy($label, $hash, [string[]]$ctorArgs) {
  $out = stellar contract deploy --wasm-hash $hash --source vault17-admin --network $NET -- @ctorArgs
  Check "publicar $label"
  $id = ($out | Select-Object -Last 1).ToString().Trim()
  Write-Host "   $label -> $id"
  return $id
}

function Invoke-Contract($label, $id, [string[]]$fnArgs) {
  stellar contract invoke --id $id --source vault17-admin --network $NET -- @fnArgs | Out-Null
  Check $label
  Write-Host "   ok: $label"
}

# ---------------------------------------------------------------- contas
Say "Contas de teste"
$ADMIN = EnsureKey "vault17-admin"
$TOMADOR = EnsureKey "vault17-tomador"
Write-Host "   admin/custodiante/investidor: $ADMIN"
Write-Host "   tomador:                      $TOMADOR"

Say "Reabastecendo o admin com XLM de teste"
TopUp $ADMIN $GAS_ACCOUNTS

# ---------------------------------------------------------------- build
Say "Compilando os contratos"
stellar contract build
Check "compilar"

# ---------------------------------------------------------------- deploy
Say "Enviando o código dos contratos"
$H_TOKEN    = Upload "token"
$H_ORACLE   = Upload "price_oracle"
$H_REGISTRY = Upload "lot_registry"
$H_VAULT    = Upload "vault"

Say "Publicando os contratos"
$LOT_TOKEN = Deploy "token do lote" $H_TOKEN @("--admin", $ADMIN, "--name", "Vault17 NdPr Lot", "--symbol", "V17NDPR", "--decimals", "0", "--restricted", "true")
$USDC      = Deploy "tUSDC" $H_TOKEN @("--admin", $ADMIN, "--name", "Test USD Coin (Vault17 demo)", "--symbol", "tUSDC", "--decimals", "7", "--restricted", "false")
$ORACLE    = Deploy "oraculo" $H_ORACLE @("--admin", $ADMIN)
$REGISTRY  = Deploy "registro de lotes" $H_REGISTRY @("--admin", $ADMIN, "--custodian", $ADMIN, "--token", $LOT_TOKEN)
$VAULT     = Deploy "vault" $H_VAULT @(
  "--admin", $ADMIN, "--lot_token", $LOT_TOKEN, "--usdc", $USDC, "--oracle", $ORACLE,
  "--asset", "NDPR",
  "--max_ltv_bps", "4000", "--alert_ltv_bps", "5500", "--freeze_ltv_bps", "6500",
  "--liquidation_ltv_bps", "7500", "--rate_bps", "1200", "--max_price_age", "172800"
)

# Grava os IDs já agora, para o painel funcionar mesmo se um passo abaixo falhar
$envFile = Join-Path $ROOT "web\.env.local"
@"
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_LOT_TOKEN=$LOT_TOKEN
VITE_USDC=$USDC
VITE_ORACLE=$ORACLE
VITE_REGISTRY=$REGISTRY
VITE_VAULT=$VAULT
"@ | Set-Content -Encoding ascii $envFile
Write-Host "   IDs gravados em web\.env.local"

# ---------------------------------------------------------------- ligações e dados de demo
Say "Ligando os contratos e preparando a demo"
Invoke-Contract "registry vira minter do token do lote" $LOT_TOKEN @("set_minter", "--new_minter", $REGISTRY)
Invoke-Contract "liberar tomador no token do lote" $LOT_TOKEN @("allow_user", "--user", $TOMADOR, "--operator", $ADMIN)
Invoke-Contract "liberar vault no token do lote" $LOT_TOKEN @("allow_user", "--user", $VAULT, "--operator", $ADMIN)

$pricesFile = Join-Path $env:TEMP "vault17-prices.json"
'["800000000","805000000","795000000","802000000"]' | Set-Content -Encoding ascii $pricesFile
stellar contract invoke --id $ORACLE --source vault17-admin --network $NET -- set_prices --asset NDPR --prices-file-path $pricesFile | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "   Aviso: preço inicial não publicado. Publique pela tela 'Oráculo e acessos'." -ForegroundColor Yellow
} else { Write-Host "   ok: preço inicial do NdPr (~80 tUSDC/kg)" }

Invoke-Contract "emitir 100.000 tUSDC para o admin" $USDC @("mint", "--to", $ADMIN, "--amount", "1000000000000")
Invoke-Contract "emitir 5.000 tUSDC para o tomador" $USDC @("mint", "--to", $TOMADOR, "--amount", "50000000000")
Invoke-Contract "depositar 100.000 tUSDC de liquidez no vault" $VAULT @("supply", "--provider", $ADMIN, "--amount", "1000000000000")

Say "Pronto"
Write-Host "Próximo: cd web; npm run dev"
Write-Host "Importe no Freighter (rede Testnet) as contas de teste:"
Write-Host "  stellar keys show vault17-admin"
Write-Host "  stellar keys show vault17-tomador"
Write-Host "Use essas chaves SOMENTE na testnet."
