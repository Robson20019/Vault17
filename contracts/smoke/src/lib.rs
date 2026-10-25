#![no_std]
//! Contrato descartavel: so valida a toolchain (build, teste e deploy na testnet).
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct Smoke;

#[contractimpl]
impl Smoke {
    pub fn ping(_e: Env) -> Symbol {
        soroban_sdk::symbol_short!("pong")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn ping_responde_pong() {
        let e = Env::default();
        let id = e.register(Smoke, ());
        let c = SmokeClient::new(&e, &id);
        assert_eq!(c.ping(), soroban_sdk::symbol_short!("pong"));
    }
}
