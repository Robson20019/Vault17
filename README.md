# Vault17

Crédito em stablecoin com estoque de terras raras como garantia, na Stellar (Soroban).
Protótipo do **HackMeridian 2026**.

> **Demonstração.** Todos os dados são fictícios. O token do lote representa um direito
> *simulado*, não propriedade legal do material. tUSDC é uma moeda de teste sem valor.
> Roda apenas na testnet.

## O que o protótipo faz

1. O dono cadastra um lote de óxido NdPr (kg, teor, armazém, nº do warrant) e o **hash SHA-256 do laudo**.
2. O mesmo warrant não pode ser cadastrado duas vezes (evita garantia em dobro).
3. O custodiante atesta o lote; só então são emitidos tokens (1 token = 1 kg), e só para carteiras liberadas (KYC simulado).
4. O tomador deposita os tokens como garantia no vault.
5. O vault calcula o valor da garantia pelo **preço mediano de 4 fontes** (oráculo) e libera tUSDC até **40% de LTV**; pedidos acima disso são recusados pelo contrato.
6. Queda de preço muda o estado: saudável → alerta (>55%) → congelado (>65%) → liquidável (>75%, liquidação fora do MVP).
7. Juros simples (12% a.a.); quitação devolve a garantia.
8. Painel web mostra lotes, evidências, empréstimo, régua de LTV e histórico on-chain.

## Estrutura

```text
contracts/
  token/          token SEP-41 mínimo, publicado 2x: token do lote (allowlist, 1 token = 1 kg) e tUSDC
  lot_registry/   cadastro de lotes, trava de warrant duplicado, atestação e emissão
  price_oracle/   mediana de 4 fontes, descarte de fonte fora da curva
  vault/          garantia, LTV, empréstimo, juros, quitação, estados de saúde
  smoke/          contrato descartável de verificação da toolchain
scripts/deploy.ps1  publica e liga tudo na testnet e grava web/.env.local
web/                painel React + Vite + Stellar Wallets Kit
```

## Pré-requisitos (Windows)

- Rust 1.95+ com `rustup target add wasm32v1-none`
- Visual Studio Build Tools com "Desenvolvimento para desktop com C++" (linker `link.exe`)
- Stellar CLI 27 · Node 22 · extensão Freighter no navegador (rede **Testnet**)

## Rodar

```powershell
# 1. testes dos contratos (27 testes; no Windows use o toolchain MSVC — veja abaixo)
cargo test

# 2. publicar na testnet e gerar web\.env.local
.\scripts\deploy.ps1

# 3. painel
cd web
npm install
npm run dev
```

Importe as duas contas de teste criadas pelo script no Freighter
(`stellar keys show vault17-admin` e `stellar keys show vault17-tomador` → Freighter → Importar).
Use essas chaves **somente na testnet** e nunca as cole em chats ou issues.

No Freighter, cada conta precisa autorizar o site separadamente: ao trocar de conta,
clique em **Desconectar** → **Conectar carteira** no painel e aprove com a conta nova
(rede **Test Net**). Sem isso o Freighter deixa o botão "Confirmar" desativado.

| Conta | Papel na demo |
| --- | --- |
| `vault17-admin` | admin dos contratos, custodiante, oráculo e investidor |
| `vault17-tomador` | trader que cadastra o lote e toma o empréstimo |

## Notas de ambiente (out/2026)

- **Aluguel caro na testnet:** os contratos não estendem o TTL dos dados (usam o mínimo da rede, suficiente para a demo). Por isso trocamos os tokens OpenZeppelin, que estendem o TTL de cada saldo por 30 dias a cada leitura, por um token próprio.
- **Windows sem Visual C++:** dá para compilar o WASM com `rustup override set stable-x86_64-pc-windows-gnu`. Os testes nativos (`cargo test`) precisam do toolchain MSVC (Build Tools com C++).

## Roteiro da demo (2 min)

1. **Tomador** → Lotes e evidências: cadastra 1.000 kg de NdPr e anexa o laudo.
2. **Admin** → Atestação: atesta o lote; 1.000 tokens vão para o tomador.
3. **Tomador** → Empréstimo: deposita 1.000 kg; limite = 32.000 tUSDC (40% de 80.000).
4. Pede 40.000 → **recusado pelo contrato**. Pede 32.000 → aprovado.
5. **Admin** → Oráculo: "Simular queda de 30%" → régua em alerta (57%).
6. **Admin** → "Voltar ao preço base". **Tomador** quita e retira a garantia.
7. Histórico on-chain: cada passo com link para a transação.

## Regras de crédito (parâmetros do vault)

| Parâmetro | Valor |
| --- | --- |
| LTV máximo para tomar | 40% |
| Alerta / congelado / liquidável | > 55% / > 65% / > 75% |
| Juros | 12% a.a., simples |
| Preço vencido | > 48h bloqueia empréstimos |
| Oráculo | mediana de 4 fontes; descarta fonte > 15% da mediana; mínimo 3 |
