extern crate std;

use super::*;
use lot_registry::{LotRegistry, LotRegistryClient};
use token::{Token, TokenClient};
use price_oracle::{PriceOracle, PriceOracleClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    vec, Address, BytesN, Env, String,
};

const UNIT: i128 = 10_000_000; // 7 casas decimais
const PRICE: i128 = 80 * UNIT; // US$ 80/kg (hipotético)
const KG: i128 = 1_000;
const T0: u64 = 1_800_000_000;

struct Ctx<'a> {
    e: Env,
    vault: VaultClient<'a>,
    vault_id: Address,
    token: TokenClient<'a>,
    usdc: TokenClient<'a>,
    oracle: PriceOracleClient<'a>,
    borrower: Address,
    investor: Address,
}

fn set_price(c: &Ctx, p: i128) {
    c.oracle.set_prices(&symbol_short!("NDPR"), &vec![&c.e, p, p, p, p]);
}

/// Monta todos os contratos, cadastra e atesta um lote de 1.000 kg,
/// abastece o vault com 100.000 tUSDC e deposita a garantia.
fn setup<'a>() -> Ctx<'a> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(T0);
    let admin = Address::generate(&e);
    let custodian = Address::generate(&e);
    let borrower = Address::generate(&e);
    let investor = Address::generate(&e);

    let token_id = e.register(Token, (admin.clone(), String::from_str(&e, "Vault17 NdPr"), String::from_str(&e, "V17NDPR"), 0u32, true));
    let token = TokenClient::new(&e, &token_id);
    let usdc_id = e.register(Token, (admin.clone(), String::from_str(&e, "Test USD Coin"), String::from_str(&e, "tUSDC"), 7u32, false));
    let usdc = TokenClient::new(&e, &usdc_id);
    let oracle_id = e.register(PriceOracle, (admin.clone(),));
    let oracle = PriceOracleClient::new(&e, &oracle_id);
    let reg_id = e.register(LotRegistry, (admin.clone(), custodian, token_id.clone()));
    let reg = LotRegistryClient::new(&e, &reg_id);
    let vault_id = e.register(
        Vault,
        (
            admin.clone(),
            token_id.clone(),
            usdc_id.clone(),
            oracle_id.clone(),
            symbol_short!("NDPR"),
            4_000u32,
            5_500u32,
            6_500u32,
            7_500u32,
            1_200u32,
            172_800u64,
        ),
    );
    let vault = VaultClient::new(&e, &vault_id);

    token.set_minter(&reg_id);
    token.allow_user(&borrower, &admin);
    token.allow_user(&vault_id, &admin);

    let c = Ctx { e, vault, vault_id, token, usdc, oracle, borrower, investor };
    set_price(&c, PRICE);

    let id = reg.register_lot(
        &c.borrower,
        &symbol_short!("NDPR"),
        &KG,
        &9_950,
        &String::from_str(&c.e, "Armazem Demo"),
        &String::from_str(&c.e, "WRT-DEMO-001"),
        &BytesN::from_array(&c.e, &[7; 32]),
    );
    reg.attest(&id);

    c.usdc.mint(&c.investor, &(100_000 * UNIT));
    c.vault.supply(&c.investor, &(100_000 * UNIT));
    c.vault.deposit(&c.borrower, &KG);
    c
}

#[test]
fn valor_e_limite_de_credito() {
    let c = setup();
    let p = c.vault.position(&c.borrower);
    assert_eq!(p.collateral, KG);
    assert_eq!(p.collateral_value, 80_000 * UNIT);
    assert_eq!(p.available_to_borrow, 32_000 * UNIT); // 40%
    assert_eq!(p.health, Health::NoDebt);
    assert_eq!(c.token.balance(&c.vault_id), KG);
}

#[test]
fn emprestimo_ate_40_porcento_e_aprovado() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(32_000 * UNIT));
    assert_eq!(c.usdc.balance(&c.borrower), 32_000 * UNIT);
    let p = c.vault.position(&c.borrower);
    assert_eq!(p.ltv_bps, 4_000);
    assert_eq!(p.available_to_borrow, 0);
    assert_eq!(p.health, Health::Healthy);
}

#[test]
fn emprestimo_acima_do_ltv_e_recusado() {
    let c = setup();
    // 50% do valor
    assert_eq!(
        c.vault.try_borrow(&c.borrower, &(40_000 * UNIT)),
        Err(Ok(VaultError::LtvExceeded.into()))
    );
    // 40% passa, e 1 tUSDC a mais é recusado
    c.vault.borrow(&c.borrower, &(32_000 * UNIT));
    assert!(c.vault.try_borrow(&c.borrower, &UNIT).is_err());
    assert_eq!(c.usdc.balance(&c.borrower), 32_000 * UNIT);
}

#[test]
fn quitacao_libera_a_garantia() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(32_000 * UNIT));
    // Sem quitar, não dá para retirar a garantia toda.
    assert!(c.vault.try_withdraw(&c.borrower, &KG).is_err());

    let pago = c.vault.repay(&c.borrower, &(32_000 * UNIT));
    assert_eq!(pago, 32_000 * UNIT);
    assert_eq!(c.vault.position(&c.borrower).debt, 0);

    c.vault.withdraw(&c.borrower, &KG);
    assert_eq!(c.token.balance(&c.borrower), KG);
    assert_eq!(c.token.balance(&c.vault_id), 0);
    assert_eq!(c.vault.position(&c.borrower).collateral, 0);
    assert_eq!(c.vault.total_debt(), 0);
}

#[test]
fn saque_parcial_respeita_o_ltv() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(16_000 * UNIT)); // 20%
    c.vault.withdraw(&c.borrower, &500); // fica 500 kg -> LTV 40%: ok
    assert!(c.vault.try_withdraw(&c.borrower, &1).is_err()); // passaria de 40%
}

#[test]
fn queda_de_preco_muda_o_estado() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(32_000 * UNIT));
    set_price(&c, PRICE * 70 / 100); // -30% -> LTV 57%
    assert_eq!(c.vault.position(&c.borrower).health, Health::Alert);
    assert!(c.vault.try_borrow(&c.borrower, &UNIT).is_err());
    set_price(&c, PRICE * 60 / 100); // -40% -> LTV 66,7%
    assert_eq!(c.vault.position(&c.borrower).health, Health::Frozen);
    set_price(&c, PRICE * 50 / 100); // -50% -> LTV 80%
    assert_eq!(c.vault.position(&c.borrower).health, Health::Liquidatable);
}

#[test]
fn preco_vencido_bloqueia_emprestimo() {
    let c = setup();
    c.e.ledger().set_timestamp(T0 + 172_801); // 48h + 1s
    let p = c.vault.position(&c.borrower);
    assert!(p.price_is_stale);
    assert_eq!(p.available_to_borrow, 0);
    assert_eq!(
        c.vault.try_borrow(&c.borrower, &UNIT),
        Err(Ok(VaultError::StalePrice.into()))
    );
}

#[test]
fn juros_simples_acumulam() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(10_000 * UNIT));
    c.e.ledger().set_timestamp(T0 + 31_536_000); // 1 ano
    let p = c.vault.position(&c.borrower);
    assert_eq!(p.debt, 11_200 * UNIT); // +12%
}

#[test]
fn quitacao_maior_que_a_divida_cobra_so_a_divida() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(1_000 * UNIT));
    c.usdc.mint(&c.borrower, &(5_000 * UNIT));
    let pago = c.vault.repay(&c.borrower, &(5_000 * UNIT));
    assert_eq!(pago, 1_000 * UNIT);
    assert_eq!(c.usdc.balance(&c.borrower), 5_000 * UNIT);
}

#[test]
fn quitacao_assina_valor_fixo_mesmo_com_juros_correndo() {
    let c = setup();
    c.vault.borrow(&c.borrower, &(32_000 * UNIT));
    c.usdc.mint(&c.borrower, &(1_000 * UNIT));
    c.e.ledger().set_timestamp(T0 + 3_600); // juros de 1h
    let pedido = 32_100 * UNIT;
    let pago = c.vault.repay(&c.borrower, &pedido);
    assert!(pago > 32_000 * UNIT && pago < pedido);
    // A autorização do tomador cobre a transferência do valor pedido (fixo), não da dívida.
    let auths = c.e.auths();
    let (who, inv) = &auths[0];
    assert_eq!(who, &c.borrower);
    let sub = &inv.sub_invocations[0];
    match &sub.function {
        soroban_sdk::testutils::AuthorizedFunction::Contract((_, name, args)) => {
            assert_eq!(name, &soroban_sdk::Symbol::new(&c.e, "transfer"));
            let amt: i128 = soroban_sdk::TryFromVal::try_from_val(&c.e, &args.get(2).unwrap()).unwrap();
            assert_eq!(amt, pedido);
        }
        _ => panic!("esperava transferência de tUSDC"),
    }
    assert_eq!(c.vault.position(&c.borrower).debt, 0);
    assert_eq!(c.vault.total_debt(), 0);
    c.vault.withdraw(&c.borrower, &KG);
}

#[test]
fn sem_liquidez_nao_empresta() {
    let c = setup();
    // Preço 10x: o limite (320.000) passa a ser maior que o caixa (100.000).
    set_price(&c, PRICE * 10);
    assert!(c.vault.position(&c.borrower).available_to_borrow > c.vault.liquidity());
    let _ = &c.investor;
    assert_eq!(
        c.vault.try_borrow(&c.borrower, &(150_000 * UNIT)),
        Err(Ok(VaultError::InsufficientLiquidity.into()))
    );
}

#[test]
fn configuracao_invalida_e_recusada() {
    let e = Env::default();
    let a = Address::generate(&e);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        e.register(
            Vault,
            (
                a.clone(),
                a.clone(),
                a.clone(),
                a.clone(),
                symbol_short!("NDPR"),
                6_000u32,
                5_500u32,
                6_500u32,
                7_500u32,
                1_200u32,
                172_800u64,
            ),
        )
    }));
    assert!(r.is_err());
}
