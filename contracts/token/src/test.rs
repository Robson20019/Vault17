extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn deploy(e: &Env, restricted: bool, decimals: u32) -> (TokenClient<'_>, Address) {
    e.mock_all_auths();
    let admin = Address::generate(e);
    let id = e.register(
        Token,
        (admin.clone(), String::from_str(e, "T"), String::from_str(e, "T"), decimals, restricted),
    );
    (TokenClient::new(e, &id), admin)
}

#[test]
fn lote_mint_so_para_carteira_liberada() {
    let e = Env::default();
    let (t, admin) = deploy(&e, true, 0);
    let user = Address::generate(&e);
    assert!(t.try_mint(&user, &10).is_err());
    t.allow_user(&user, &admin);
    t.mint(&user, &1_000);
    assert_eq!(t.balance(&user), 1_000);
    assert_eq!(t.total_supply(), 1_000);
    assert_eq!(t.decimals(), 0);
}

#[test]
fn lote_transferencia_exige_as_duas_carteiras_liberadas() {
    let e = Env::default();
    let (t, admin) = deploy(&e, true, 0);
    let a = Address::generate(&e);
    let b = Address::generate(&e);
    t.allow_user(&a, &admin);
    t.mint(&a, &100);
    assert!(t.try_transfer(&a, &b, &10).is_err());
    t.allow_user(&b, &admin);
    t.transfer(&a, &b, &10);
    assert_eq!(t.balance(&a), 90);
    assert_eq!(t.balance(&b), 10);
}

#[test]
fn so_admin_libera() {
    let e = Env::default();
    let (t, _admin) = deploy(&e, true, 0);
    let intruso = Address::generate(&e);
    assert!(t.try_allow_user(&intruso, &intruso).is_err());
}

#[test]
fn usdc_sem_restricao() {
    let e = Env::default();
    let (t, _admin) = deploy(&e, false, 7);
    let a = Address::generate(&e);
    let b = Address::generate(&e);
    t.mint(&a, &(5 * 10_000_000));
    t.transfer(&a, &b, &10_000_000);
    assert_eq!(t.balance(&b), 10_000_000);
    assert!(t.allowed(&b));
}

#[test]
fn saldo_insuficiente_e_valor_invalido() {
    let e = Env::default();
    let (t, _admin) = deploy(&e, false, 7);
    let a = Address::generate(&e);
    let b = Address::generate(&e);
    t.mint(&a, &5);
    assert!(t.try_transfer(&a, &b, &6).is_err());
    assert!(t.try_transfer(&a, &b, &0).is_err());
    assert!(t.try_mint(&a, &-1).is_err());
}

#[test]
fn so_minter_emite() {
    let e = Env::default();
    let (t, admin) = deploy(&e, false, 7);
    let outro = Address::generate(&e);
    t.set_minter(&outro);
    t.mint(&admin, &1);
    let auths = e.auths();
    assert_eq!(auths[0].0, outro);
}
