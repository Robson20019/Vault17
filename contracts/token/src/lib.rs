#![no_std]
//! Token fungível mínimo (interface SEP-41) usado duas vezes no Vault17:
//! - **token do lote** (`restricted = true`, 0 casas): 1 token = 1 kg atestado;
//!   só carteiras liberadas pelo admin (KYC simulado) enviam ou recebem;
//! - **tUSDC** (`restricted = false`, 7 casas): stablecoin de teste.
//!
//! Por que não a OpenZeppelin: na testnet de out/2026 o aluguel de armazenamento
//! ficou muito caro, e a biblioteca estende o prazo (TTL) de cada saldo por 30 dias
//! a cada leitura, custando milhares de XLM por transação. Aqui nenhum dado tem o
//! prazo estendido: tudo usa o TTL mínimo da rede, suficiente para a demo.
//!
//! DEMONSTRAÇÃO: o token do lote representa um direito simulado; tUSDC não tem valor.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, MuxedAddress, String,
};

#[contracttype]
enum DataKey {
    Admin,
    Minter,
    Restricted,
    Decimals,
    Name,
    Symbol,
    Supply,
    Balance(Address),
    Allowed(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TokenError {
    InvalidAmount = 1,
    NotAllowed = 2,
    InsufficientBalance = 3,
    NotAdmin = 4,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserAllowed {
    #[topic]
    pub user: Address,
}

#[contract]
pub struct Token;

#[contractimpl]
impl Token {
    pub fn __constructor(
        e: &Env,
        admin: Address,
        name: String,
        symbol: String,
        decimals: u32,
        restricted: bool,
    ) {
        let s = e.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Minter, &admin);
        s.set(&DataKey::Name, &name);
        s.set(&DataKey::Symbol, &symbol);
        s.set(&DataKey::Decimals, &decimals);
        s.set(&DataKey::Restricted, &restricted);
        s.set(&DataKey::Supply, &0i128);
        if restricted {
            e.storage().persistent().set(&DataKey::Allowed(admin), &true);
        }
    }

    // ------------------------------------------------------------ admin

    pub fn admin(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn minter(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Minter).unwrap()
    }

    pub fn set_minter(e: &Env, new_minter: Address) {
        Self::admin(e).require_auth();
        e.storage().instance().set(&DataKey::Minter, &new_minter);
    }

    pub fn mint(e: &Env, to: Address, amount: i128) {
        Self::minter(e).require_auth();
        positive(e, amount);
        check_allowed(e, &to);
        set_balance(e, &to, balance_of(e, &to) + amount);
        let supply: i128 = e.storage().instance().get(&DataKey::Supply).unwrap_or(0);
        e.storage().instance().set(&DataKey::Supply, &(supply + amount));
        Mint { to, amount }.publish(e);
    }

    /// Libera uma carteira (KYC simulado). `operator` precisa ser o admin.
    pub fn allow_user(e: &Env, user: Address, operator: Address) {
        assert_admin(e, &operator);
        e.storage().persistent().set(&DataKey::Allowed(user.clone()), &true);
        UserAllowed { user }.publish(e);
    }

    pub fn disallow_user(e: &Env, user: Address, operator: Address) {
        assert_admin(e, &operator);
        e.storage().persistent().remove(&DataKey::Allowed(user));
    }

    /// Para tokens sem restrição, toda carteira é considerada liberada.
    pub fn allowed(e: &Env, account: Address) -> bool {
        is_allowed(e, &account)
    }

    pub fn restricted(e: &Env) -> bool {
        e.storage().instance().get(&DataKey::Restricted).unwrap_or(false)
    }

    // ------------------------------------------------------------ SEP-41

    pub fn balance(e: &Env, id: Address) -> i128 {
        balance_of(e, &id)
    }

    pub fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        move_tokens(e, &from, &to.address(), amount);
    }

    pub fn decimals(e: &Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    pub fn name(e: &Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(e: &Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn total_supply(e: &Env) -> i128 {
        e.storage().instance().get(&DataKey::Supply).unwrap_or(0)
    }
}

fn positive(e: &Env, v: i128) {
    if v <= 0 {
        panic_with_error!(e, TokenError::InvalidAmount);
    }
}

fn balance_of(e: &Env, who: &Address) -> i128 {
    e.storage().persistent().get(&DataKey::Balance(who.clone())).unwrap_or(0)
}

fn set_balance(e: &Env, who: &Address, v: i128) {
    let k = DataKey::Balance(who.clone());
    if v == 0 {
        e.storage().persistent().remove(&k);
    } else {
        e.storage().persistent().set(&k, &v);
    }
}

fn is_allowed(e: &Env, who: &Address) -> bool {
    let restricted: bool = e.storage().instance().get(&DataKey::Restricted).unwrap_or(false);
    !restricted || e.storage().persistent().has(&DataKey::Allowed(who.clone()))
}

fn check_allowed(e: &Env, who: &Address) {
    if !is_allowed(e, who) {
        panic_with_error!(e, TokenError::NotAllowed);
    }
}

fn move_tokens(e: &Env, from: &Address, to: &Address, amount: i128) {
    positive(e, amount);
    check_allowed(e, from);
    check_allowed(e, to);
    let fb = balance_of(e, from);
    if fb < amount {
        panic_with_error!(e, TokenError::InsufficientBalance);
    }
    set_balance(e, from, fb - amount);
    set_balance(e, to, balance_of(e, to) + amount);
    Transfer { from: from.clone(), to: to.clone(), amount }.publish(e);
}

fn assert_admin(e: &Env, operator: &Address) {
    let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
    if *operator != admin {
        panic_with_error!(e, TokenError::NotAdmin);
    }
    operator.require_auth();
}

#[cfg(test)]
mod test;
