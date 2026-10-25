extern crate std;

use super::*;
use token::{Token, TokenClient};
use soroban_sdk::{symbol_short, testutils::Address as _, Address, BytesN, Env, String};

struct Ctx<'a> {
    e: Env,
    reg: LotRegistryClient<'a>,
    token: TokenClient<'a>,
    owner: Address,
}

fn setup<'a>() -> Ctx<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let custodian = Address::generate(&e);
    let owner = Address::generate(&e);
    let token_id = e.register(Token, (admin.clone(), String::from_str(&e, "Vault17 NdPr"), String::from_str(&e, "V17NDPR"), 0u32, true));
    let token = TokenClient::new(&e, &token_id);
    let reg_id = e.register(LotRegistry, (admin.clone(), custodian, token_id.clone()));
    token.set_minter(&reg_id);
    token.allow_user(&owner, &admin);
    let reg = LotRegistryClient::new(&e, &reg_id);
    Ctx { e, reg, token, owner }
}

fn hash(e: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(e, &[b; 32])
}

fn register(c: &Ctx, warrant: &str) -> u32 {
    c.reg.register_lot(
        &c.owner,
        &symbol_short!("NDPR"),
        &1_000,
        &9_950,
        &String::from_str(&c.e, "Armazem Demo - Santos/SP"),
        &String::from_str(&c.e, warrant),
        &hash(&c.e, 7),
    )
}

#[test]
fn cadastro_e_atestacao_emitem_tokens() {
    let c = setup();
    let id = register(&c, "WRT-DEMO-001");
    assert_eq!(id, 1);
    assert_eq!(c.reg.lot(&id).status, LotStatus::Registered);
    assert_eq!(c.token.balance(&c.owner), 0);

    c.reg.attest(&id);
    let lot = c.reg.lot(&id);
    assert_eq!(lot.status, LotStatus::Attested);
    assert_eq!(c.token.balance(&c.owner), 1_000);
    assert_eq!(c.reg.lot_by_warrant(&String::from_str(&c.e, "WRT-DEMO-001")), 1);
}

#[test]
fn warrant_duplicado_e_recusado() {
    let c = setup();
    register(&c, "WRT-DEMO-001");
    let r = c.reg.try_register_lot(
        &c.owner,
        &symbol_short!("NDPR"),
        &500,
        &9_900,
        &String::from_str(&c.e, "Outro armazem"),
        &String::from_str(&c.e, "WRT-DEMO-001"),
        &hash(&c.e, 9),
    );
    assert!(r.is_err());
    assert_eq!(c.reg.lot_count(), 1);
}

#[test]
fn atestar_duas_vezes_falha() {
    let c = setup();
    let id = register(&c, "WRT-DEMO-002");
    c.reg.attest(&id);
    assert!(c.reg.try_attest(&id).is_err());
    assert_eq!(c.token.balance(&c.owner), 1_000);
}

#[test]
fn sem_atestacao_nao_ha_tokens() {
    let c = setup();
    register(&c, "WRT-DEMO-003");
    assert_eq!(c.token.balance(&c.owner), 0);
    assert_eq!(c.token.total_supply(), 0);
}

#[test]
fn so_o_custodiante_atesta() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let custodian = Address::generate(&e);
    let owner = Address::generate(&e);
    e.mock_all_auths();
    let token_id = e.register(Token, (admin.clone(), String::from_str(&e, "N"), String::from_str(&e, "S"), 0u32, true));
    let reg_id = e.register(LotRegistry, (admin.clone(), custodian.clone(), token_id.clone()));
    TokenClient::new(&e, &token_id).set_minter(&reg_id);
    TokenClient::new(&e, &token_id).allow_user(&owner, &admin);
    let reg = LotRegistryClient::new(&e, &reg_id);
    let id = reg.register_lot(
        &owner,
        &symbol_short!("NDPR"),
        &10,
        &9_000,
        &String::from_str(&e, "A"),
        &String::from_str(&e, "W"),
        &hash(&e, 1),
    );
    reg.attest(&id);
    // A autorização exigida foi a do custodiante, não a do dono.
    let auths = e.auths();
    assert_eq!(auths[0].0, custodian);
}

#[test]
fn valores_invalidos_sao_recusados() {
    let c = setup();
    let base = |kg: i128, p: u32| {
        c.reg.try_register_lot(
            &c.owner,
            &symbol_short!("NDPR"),
            &kg,
            &p,
            &String::from_str(&c.e, "A"),
            &String::from_str(&c.e, "W-X"),
            &hash(&c.e, 2),
        )
    };
    assert!(base(0, 9_000).is_err());
    assert!(base(10, 0).is_err());
    assert!(base(10, 10_001).is_err());
}
