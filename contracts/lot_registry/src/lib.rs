#![no_std]
//! LotRegistry — cadastro dos lotes físicos de óxido de terras raras.
//!
//! Fluxo:
//! 1. O dono cadastra o lote: óxido, kg, teor, armazém, nº do warrant e o
//!    hash SHA-256 do laudo (o documento fica fora da blockchain).
//! 2. O mesmo nº de warrant nunca pode ser cadastrado duas vezes
//!    (evita usar o mesmo estoque como garantia duas vezes).
//! 3. Só o custodiante atesta o lote; na atestação o registry emite
//!    1 LotToken por kg para o dono.
//!
//! DEMONSTRAÇÃO: dados fictícios; a atestação é simulada.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, Address, BytesN, Env, String, Symbol,
};

#[contractclient(name = "LotTokenClient")]
pub trait LotTokenInterface {
    fn mint(e: Env, to: Address, amount: i128);
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum LotStatus {
    Registered = 0,
    Attested = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Lot {
    pub id: u32,
    pub owner: Address,
    /// Código do óxido, ex.: NDPR (deve casar com o ativo do oráculo).
    pub oxide: Symbol,
    pub kg: i128,
    /// Teor em pontos-base (9950 = 99,50%).
    pub purity_bps: u32,
    pub warehouse: String,
    pub warrant_id: String,
    /// SHA-256 do laudo/certificado (PDF).
    pub doc_hash: BytesN<32>,
    pub status: LotStatus,
    pub registered_at: u64,
    pub attested_at: u64,
}

#[contracttype]
enum DataKey {
    Admin,
    Custodian,
    Token,
    Count,
    Lot(u32),
    Warrant(String),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    DuplicateWarrant = 1,
    LotNotFound = 2,
    AlreadyAttested = 3,
    InvalidAmount = 4,
    InvalidPurity = 5,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LotRegistered {
    #[topic]
    pub lot_id: u32,
    #[topic]
    pub owner: Address,
    pub kg: i128,
    pub doc_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LotAttested {
    #[topic]
    pub lot_id: u32,
    #[topic]
    pub custodian: Address,
    pub tokens_minted: i128,
}

#[contract]
pub struct LotRegistry;

#[contractimpl]
impl LotRegistry {
    pub fn __constructor(e: &Env, admin: Address, custodian: Address, token: Address) {
        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Custodian, &custodian);
        e.storage().instance().set(&DataKey::Token, &token);
        e.storage().instance().set(&DataKey::Count, &0u32);
    }

    pub fn custodian(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Custodian).unwrap()
    }

    pub fn token(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn set_custodian(e: &Env, custodian: Address) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        e.storage().instance().set(&DataKey::Custodian, &custodian);
    }

    /// Cadastra um lote. Retorna o id.
    #[allow(clippy::too_many_arguments)]
    pub fn register_lot(
        e: &Env,
        owner: Address,
        oxide: Symbol,
        kg: i128,
        purity_bps: u32,
        warehouse: String,
        warrant_id: String,
        doc_hash: BytesN<32>,
    ) -> u32 {
        owner.require_auth();
        if kg <= 0 {
            panic_with_error!(e, RegistryError::InvalidAmount);
        }
        if purity_bps == 0 || purity_bps > 10_000 {
            panic_with_error!(e, RegistryError::InvalidPurity);
        }
        let wkey = DataKey::Warrant(warrant_id.clone());
        if e.storage().persistent().has(&wkey) {
            panic_with_error!(e, RegistryError::DuplicateWarrant);
        }
        let id: u32 = e.storage().instance().get(&DataKey::Count).unwrap_or(0) + 1;
        let lot = Lot {
            id,
            owner: owner.clone(),
            oxide,
            kg,
            purity_bps,
            warehouse,
            warrant_id,
            doc_hash: doc_hash.clone(),
            status: LotStatus::Registered,
            registered_at: e.ledger().timestamp(),
            attested_at: 0,
        };
        e.storage().persistent().set(&wkey, &id);
        save(e, &lot);
        e.storage().instance().set(&DataKey::Count, &id);
        LotRegistered { lot_id: id, owner, kg, doc_hash }.publish(e);
        id
    }

    /// O custodiante atesta o lote; o registry emite 1 token por kg ao dono.
    pub fn attest(e: &Env, lot_id: u32) {
        let custodian = Self::custodian(e);
        custodian.require_auth();
        let mut lot = Self::lot(e, lot_id);
        if lot.status == LotStatus::Attested {
            panic_with_error!(e, RegistryError::AlreadyAttested);
        }
        lot.status = LotStatus::Attested;
        lot.attested_at = e.ledger().timestamp();
        save(e, &lot);
        LotTokenClient::new(e, &Self::token(e)).mint(&lot.owner, &lot.kg);
        LotAttested { lot_id, custodian, tokens_minted: lot.kg }.publish(e);
    }

    pub fn lot(e: &Env, lot_id: u32) -> Lot {
        match e.storage().persistent().get(&DataKey::Lot(lot_id)) {
            Some(l) => l,
            None => panic_with_error!(e, RegistryError::LotNotFound),
        }
    }

    pub fn lot_count(e: &Env) -> u32 {
        e.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Id do lote que usa este warrant (0 se nenhum).
    pub fn lot_by_warrant(e: &Env, warrant_id: String) -> u32 {
        e.storage().persistent().get(&DataKey::Warrant(warrant_id)).unwrap_or(0)
    }
}

/// Sem extensão de TTL (aluguel caro na testnet); o TTL mínimo basta para a demo.
fn save(e: &Env, lot: &Lot) {
    e.storage().persistent().set(&DataKey::Lot(lot.id), lot);
}

#[cfg(test)]
mod test;
