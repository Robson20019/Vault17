#![no_std]
//! PriceOracle — preço de referência por kg de cada óxido (ex.: `NDPR`).
//!
//! O admin publica de uma vez as cotações de 4 fontes (na demo: valores
//! simulados que representam Fastmarkets, Metal Pages, SMM e Baotou).
//! O contrato:
//! - calcula a mediana;
//! - descarta fontes a mais de 15% da mediana e recalcula com as restantes;
//! - exige pelo menos 3 fontes válidas;
//! - guarda o horário da publicação para quem consome checar se está velho.
//!
//! Preços em unidades de tUSDC (7 casas decimais) por kg.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, Symbol, Vec,
};

pub const MAX_DEVIATION_BPS: i128 = 1_500; // 15%
pub const MIN_SOURCES: u32 = 3;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    /// Mediana das fontes válidas (tUSDC 7 casas por kg).
    pub price: i128,
    /// Timestamp do ledger quando o preço foi publicado.
    pub timestamp: u64,
    /// Quantas fontes entraram na mediana final.
    pub sources_used: u32,
    /// Cotações enviadas, na ordem das fontes.
    pub reported: Vec<i128>,
}

#[contracttype]
enum DataKey {
    Admin,
    Price(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OracleError {
    NoPrice = 1,
    NotEnoughSources = 2,
    InvalidPrice = 3,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceUpdated {
    #[topic]
    pub asset: Symbol,
    pub price: i128,
    pub sources_used: u32,
}

#[contract]
pub struct PriceOracle;

#[contractimpl]
impl PriceOracle {
    pub fn __constructor(e: &Env, admin: Address) {
        e.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn admin(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Publica as cotações das fontes para `asset` e grava a mediana.
    pub fn set_prices(e: &Env, asset: Symbol, prices: Vec<i128>) -> PriceData {
        Self::admin(e).require_auth();
        if prices.len() < MIN_SOURCES {
            panic_with_error!(e, OracleError::NotEnoughSources);
        }
        for p in prices.iter() {
            if p <= 0 {
                panic_with_error!(e, OracleError::InvalidPrice);
            }
        }
        let first = median(e, &prices);
        let mut kept: Vec<i128> = Vec::new(e);
        for p in prices.iter() {
            let diff = if p > first { p - first } else { first - p };
            if diff * 10_000 <= first * MAX_DEVIATION_BPS {
                kept.push_back(p);
            }
        }
        if kept.len() < MIN_SOURCES {
            panic_with_error!(e, OracleError::NotEnoughSources);
        }
        let data = PriceData {
            price: median(e, &kept),
            timestamp: e.ledger().timestamp(),
            sources_used: kept.len(),
            reported: prices,
        };
        // Sem extensão de TTL: o aluguel na testnet está caro; o TTL mínimo basta para a demo.
        e.storage().persistent().set(&DataKey::Price(asset.clone()), &data);
        PriceUpdated { asset, price: data.price, sources_used: data.sources_used }.publish(e);
        data
    }

    /// Último preço de `asset`.
    pub fn price(e: &Env, asset: Symbol) -> PriceData {
        match e.storage().persistent().get(&DataKey::Price(asset)) {
            Some(d) => d,
            None => panic_with_error!(e, OracleError::NoPrice),
        }
    }
}

/// Mediana com ordenação por inserção (no máximo poucas fontes).
fn median(e: &Env, values: &Vec<i128>) -> i128 {
    let mut sorted: Vec<i128> = Vec::new(e);
    for v in values.iter() {
        let mut i = 0u32;
        while i < sorted.len() && sorted.get_unchecked(i) < v {
            i += 1;
        }
        sorted.insert(i, v);
    }
    let n = sorted.len();
    if n % 2 == 1 {
        sorted.get_unchecked(n / 2)
    } else {
        (sorted.get_unchecked(n / 2 - 1) + sorted.get_unchecked(n / 2)) / 2
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _, vec};

    fn setup(e: &Env) -> PriceOracleClient<'_> {
        e.mock_all_auths();
        let admin = Address::generate(e);
        let id = e.register(PriceOracle, (admin,));
        PriceOracleClient::new(e, &id)
    }

    #[test]
    fn mediana_de_quatro_fontes() {
        let e = Env::default();
        let o = setup(&e);
        let d = o.set_prices(&symbol_short!("NDPR"), &vec![&e, 78, 80, 82, 81]);
        assert_eq!(d.price, 80); // (80 + 81) / 2
        assert_eq!(d.sources_used, 4);
        assert_eq!(o.price(&symbol_short!("NDPR")).price, 80);
    }

    #[test]
    fn fonte_fora_da_curva_e_descartada() {
        let e = Env::default();
        let o = setup(&e);
        // 120 está 50% acima da mediana: sai; mediana de 78, 80, 82 = 80
        let d = o.set_prices(&symbol_short!("NDPR"), &vec![&e, 78, 80, 82, 120]);
        assert_eq!(d.price, 80);
        assert_eq!(d.sources_used, 3);
    }

    #[test]
    fn menos_de_tres_fontes_validas_falha() {
        let e = Env::default();
        let o = setup(&e);
        assert!(o.try_set_prices(&symbol_short!("NDPR"), &vec![&e, 80, 81]).is_err());
        assert!(o.try_set_prices(&symbol_short!("NDPR"), &vec![&e, 10, 80, 200, 400]).is_err());
    }

    #[test]
    fn sem_preco_falha() {
        let e = Env::default();
        let o = setup(&e);
        assert!(o.try_price(&symbol_short!("DY")).is_err());
    }
}
