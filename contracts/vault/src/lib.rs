#![no_std]
//! Vault — crédito em tUSDC com LotTokens (kg de óxido atestado) como garantia.
//!
//! Regras (valores em pontos-base, 10_000 = 100%):
//! - valor da garantia = kg depositados × preço mediano do oráculo;
//! - empréstimo novo só se a dívida total ficar ≤ `max_ltv_bps` (40%);
//! - preço com mais de `max_price_age` segundos bloqueia novos empréstimos
//!   e saques de garantia enquanto houver dívida;
//! - estados pelo LTV atual: saudável ≤ 55% < alerta ≤ 65% < congelado ≤ 75% < liquidável;
//! - juros simples anuais (`rate_bps`) sobre a dívida, acumulados a cada interação;
//! - quitação devolve o tUSDC ao vault; a garantia só sai se o LTV continuar ≤ 40%
//!   (ou se a dívida for zero).
//!
//! A liquidação em si está FORA do MVP: o estado "liquidável" só é exibido.
//! DEMONSTRAÇÃO: testnet, tUSDC sem valor, dados fictícios.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token::TokenClient, Address, Env, Symbol,
};

pub const BPS: i128 = 10_000;
pub const YEAR_SECONDS: i128 = 31_536_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub lot_token: Address,
    pub usdc: Address,
    pub oracle: Address,
    /// Ativo consultado no oráculo, ex.: NDPR.
    pub asset: Symbol,
    pub max_ltv_bps: u32,
    pub alert_ltv_bps: u32,
    pub freeze_ltv_bps: u32,
    pub liquidation_ltv_bps: u32,
    /// Juros anuais em pontos-base (1200 = 12% a.a.).
    pub rate_bps: u32,
    /// Idade máxima do preço em segundos (172800 = 48h).
    pub max_price_age: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct Position {
    pub collateral: i128,
    pub debt: i128,
    pub last_accrual: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Health {
    NoDebt = 0,
    Healthy = 1,
    Alert = 2,
    Frozen = 3,
    Liquidatable = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionView {
    /// kg depositados como garantia.
    pub collateral: i128,
    /// Dívida com juros acumulados até agora (tUSDC, 7 casas).
    pub debt: i128,
    /// Preço por kg usado (tUSDC, 7 casas).
    pub price: i128,
    pub price_timestamp: u64,
    pub price_is_stale: bool,
    /// Valor da garantia (tUSDC, 7 casas).
    pub collateral_value: i128,
    pub ltv_bps: i128,
    /// Quanto ainda pode tomar sem passar do LTV máximo.
    pub available_to_borrow: i128,
    pub health: Health,
}

#[contracttype]
enum DataKey {
    Config,
    Position(Address),
    TotalDebt,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    InvalidAmount = 1,
    LtvExceeded = 2,
    StalePrice = 3,
    InsufficientCollateral = 4,
    InsufficientLiquidity = 5,
    NoDebt = 6,
    InvalidConfig = 7,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Supplied {
    #[topic]
    pub provider: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralDeposited {
    #[topic]
    pub borrower: Address,
    pub kg: i128,
    pub total_collateral: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Borrowed {
    #[topic]
    pub borrower: Address,
    pub amount: i128,
    pub debt: i128,
    pub ltv_bps: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Repaid {
    #[topic]
    pub borrower: Address,
    pub amount: i128,
    pub debt: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralWithdrawn {
    #[topic]
    pub borrower: Address,
    pub kg: i128,
    pub total_collateral: i128,
}

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        e: &Env,
        admin: Address,
        lot_token: Address,
        usdc: Address,
        oracle: Address,
        asset: Symbol,
        max_ltv_bps: u32,
        alert_ltv_bps: u32,
        freeze_ltv_bps: u32,
        liquidation_ltv_bps: u32,
        rate_bps: u32,
        max_price_age: u64,
    ) {
        if !(max_ltv_bps > 0
            && max_ltv_bps < alert_ltv_bps
            && alert_ltv_bps < freeze_ltv_bps
            && freeze_ltv_bps < liquidation_ltv_bps
            && liquidation_ltv_bps < 10_000)
        {
            panic_with_error!(e, VaultError::InvalidConfig);
        }
        let cfg = Config {
            admin,
            lot_token,
            usdc,
            oracle,
            asset,
            max_ltv_bps,
            alert_ltv_bps,
            freeze_ltv_bps,
            liquidation_ltv_bps,
            rate_bps,
            max_price_age,
        };
        e.storage().instance().set(&DataKey::Config, &cfg);
        e.storage().instance().set(&DataKey::TotalDebt, &0i128);
    }

    pub fn config(e: &Env) -> Config {
        e.storage().instance().get(&DataKey::Config).unwrap()
    }

    /// tUSDC disponível no vault para novos empréstimos.
    pub fn liquidity(e: &Env) -> i128 {
        let cfg = Self::config(e);
        TokenClient::new(e, &cfg.usdc).balance(&e.current_contract_address())
    }

    pub fn total_debt(e: &Env) -> i128 {
        e.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0)
    }

    /// Investidor deposita tUSDC para ser emprestado.
    pub fn supply(e: &Env, provider: Address, amount: i128) {
        provider.require_auth();
        positive(e, amount);
        let cfg = Self::config(e);
        TokenClient::new(e, &cfg.usdc).transfer(&provider, e.current_contract_address(), &amount);
        Supplied { provider, amount }.publish(e);
    }

    /// Tomador deposita LotTokens (kg) como garantia.
    pub fn deposit(e: &Env, borrower: Address, kg: i128) {
        borrower.require_auth();
        positive(e, kg);
        let cfg = Self::config(e);
        let mut p = accrue(e, &cfg, &borrower);
        TokenClient::new(e, &cfg.lot_token).transfer(&borrower, e.current_contract_address(), &kg);
        p.collateral += kg;
        save(e, &borrower, &p);
        CollateralDeposited { borrower, kg, total_collateral: p.collateral }.publish(e);
    }

    /// Toma `amount` tUSDC. Recusa se a dívida passar do LTV máximo.
    pub fn borrow(e: &Env, borrower: Address, amount: i128) {
        borrower.require_auth();
        positive(e, amount);
        let cfg = Self::config(e);
        let mut p = accrue(e, &cfg, &borrower);
        let (price, _) = fresh_price(e, &cfg);
        let value = p.collateral * price;
        let new_debt = p.debt + amount;
        if new_debt * BPS > value * cfg.max_ltv_bps as i128 {
            panic_with_error!(e, VaultError::LtvExceeded);
        }
        if Self::liquidity(e) < amount {
            panic_with_error!(e, VaultError::InsufficientLiquidity);
        }
        TokenClient::new(e, &cfg.usdc).transfer(&e.current_contract_address(), &borrower, &amount);
        p.debt = new_debt;
        save(e, &borrower, &p);
        add_total_debt(e, amount);
        Borrowed { borrower, amount, debt: new_debt, ltv_bps: new_debt * BPS / value }.publish(e);
    }

    /// Paga até `amount` da dívida (o que exceder a dívida não é cobrado).
    /// Retorna o valor efetivamente pago.
    pub fn repay(e: &Env, borrower: Address, amount: i128) -> i128 {
        borrower.require_auth();
        positive(e, amount);
        let cfg = Self::config(e);
        let mut p = accrue(e, &cfg, &borrower);
        if p.debt == 0 {
            panic_with_error!(e, VaultError::NoDebt);
        }
        let pay = if amount > p.debt { p.debt } else { amount };
        TokenClient::new(e, &cfg.usdc).transfer(&borrower, e.current_contract_address(), &pay);
        p.debt -= pay;
        save(e, &borrower, &p);
        add_total_debt(e, -pay);
        Repaid { borrower, amount: pay, debt: p.debt }.publish(e);
        pay
    }

    /// Retira `kg` de garantia. Com dívida, o LTV precisa continuar ≤ máximo.
    pub fn withdraw(e: &Env, borrower: Address, kg: i128) {
        borrower.require_auth();
        positive(e, kg);
        let cfg = Self::config(e);
        let mut p = accrue(e, &cfg, &borrower);
        if kg > p.collateral {
            panic_with_error!(e, VaultError::InsufficientCollateral);
        }
        let remaining = p.collateral - kg;
        if p.debt > 0 {
            let (price, _) = fresh_price(e, &cfg);
            if p.debt * BPS > remaining * price * cfg.max_ltv_bps as i128 {
                panic_with_error!(e, VaultError::LtvExceeded);
            }
        }
        TokenClient::new(e, &cfg.lot_token).transfer(&e.current_contract_address(), &borrower, &kg);
        p.collateral = remaining;
        save(e, &borrower, &p);
        CollateralWithdrawn { borrower, kg, total_collateral: remaining }.publish(e);
    }

    /// Situação do tomador agora (dívida com juros até o momento).
    pub fn position(e: &Env, borrower: Address) -> PositionView {
        let cfg = Self::config(e);
        let p = with_interest(e, &cfg, &load(e, &borrower));
        let price_data = oracle_price(e, &cfg);
        let (price, ts) = match &price_data {
            Some((pr, t)) => (*pr, *t),
            None => (0, 0),
        };
        let stale = price_data.is_none() || e.ledger().timestamp() > ts + cfg.max_price_age;
        let value = p.collateral * price;
        let ltv_bps = if value > 0 { p.debt * BPS / value } else if p.debt > 0 { BPS * 100 } else { 0 };
        let max_debt = value * cfg.max_ltv_bps as i128 / BPS;
        let available = if stale || max_debt <= p.debt { 0 } else { max_debt - p.debt };
        PositionView {
            collateral: p.collateral,
            debt: p.debt,
            price,
            price_timestamp: ts,
            price_is_stale: stale,
            collateral_value: value,
            ltv_bps,
            available_to_borrow: available,
            health: health(&cfg, p.debt, ltv_bps),
        }
    }
}

// ---------------------------------------------------------------- helpers

fn positive(e: &Env, v: i128) {
    if v <= 0 {
        panic_with_error!(e, VaultError::InvalidAmount);
    }
}

fn load(e: &Env, who: &Address) -> Position {
    e.storage().persistent().get(&DataKey::Position(who.clone())).unwrap_or_default()
}

fn save(e: &Env, who: &Address, p: &Position) {
    // Sem extensão de TTL (aluguel caro na testnet); o TTL mínimo basta para a demo.
    e.storage().persistent().set(&DataKey::Position(who.clone()), p);
}

fn add_total_debt(e: &Env, delta: i128) {
    let t: i128 = e.storage().instance().get(&DataKey::TotalDebt).unwrap_or(0);
    e.storage().instance().set(&DataKey::TotalDebt, &(t + delta));
}

/// Dívida com juros simples desde a última interação (não grava).
fn with_interest(e: &Env, cfg: &Config, p: &Position) -> Position {
    let now = e.ledger().timestamp();
    let mut out = p.clone();
    if p.debt > 0 && now > p.last_accrual {
        let dt = (now - p.last_accrual) as i128;
        out.debt = p.debt + p.debt * cfg.rate_bps as i128 * dt / (BPS * YEAR_SECONDS);
    }
    out.last_accrual = now;
    out
}

/// Aplica os juros acumulados e devolve a posição atualizada (a gravar depois).
fn accrue(e: &Env, cfg: &Config, who: &Address) -> Position {
    let before = load(e, who);
    let after = with_interest(e, cfg, &before);
    if after.debt != before.debt {
        add_total_debt(e, after.debt - before.debt);
    }
    after
}

fn oracle_price(e: &Env, cfg: &Config) -> Option<(i128, u64)> {
    let r = price_oracle_client::Client::new(e, &cfg.oracle).try_price(&cfg.asset);
    match r {
        Ok(Ok(d)) => Some((d.price, d.timestamp)),
        _ => None,
    }
}

fn fresh_price(e: &Env, cfg: &Config) -> (i128, u64) {
    match oracle_price(e, cfg) {
        Some((p, t)) if e.ledger().timestamp() <= t + cfg.max_price_age => (p, t),
        _ => panic_with_error!(e, VaultError::StalePrice),
    }
}

fn health(cfg: &Config, debt: i128, ltv_bps: i128) -> Health {
    if debt == 0 {
        Health::NoDebt
    } else if ltv_bps <= cfg.alert_ltv_bps as i128 {
        Health::Healthy
    } else if ltv_bps <= cfg.freeze_ltv_bps as i128 {
        Health::Alert
    } else if ltv_bps <= cfg.liquidation_ltv_bps as i128 {
        Health::Frozen
    } else {
        Health::Liquidatable
    }
}

/// Cliente mínimo do PriceOracle (mesma interface do contrato price_oracle).
mod price_oracle_client {
    use soroban_sdk::{contractclient, contracttype, Env, Symbol, Vec};

    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct PriceData {
        pub price: i128,
        pub timestamp: u64,
        pub sources_used: u32,
        pub reported: Vec<i128>,
    }

    #[contractclient(name = "Client")]
    #[allow(dead_code)]
    pub trait Oracle {
        fn price(e: Env, asset: Symbol) -> PriceData;
    }
}

#[cfg(test)]
mod test;
