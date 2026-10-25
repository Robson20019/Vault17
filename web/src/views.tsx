import { Buffer } from "buffer";
import { useEffect, useState, type FormEvent } from "react";
import type { ViewProps } from "./App";
import { ASSET, CONTRACTS, EXPLORER_CONTRACT, EXPLORER_TX, PRICE_SOURCES } from "./lib/config";
import { fetchEvents, type ChainEvent, type Lot } from "./lib/contracts";
import { dateTime, fromUnits, hex, kg, pct, sha256, shortAddr, toUnits, usd } from "./lib/format";
import { Button, Field, HealthBadge, LtvScale, Panel, Stat, inputCls } from "./ui";

// ================================================================ visão geral

const DEMO_STEPS: { text: string; view: string }[] = [
  { text: "O dono cadastra o lote e anexa o laudo (só o hash vai para a rede).", view: "lots" },
  { text: "O custodiante atesta o lote; 1 token é emitido por kg.", view: "custodian" },
  { text: "O tomador deposita os tokens como garantia no vault.", view: "borrower" },
  { text: "Pede 50% do valor: o contrato recusa. Pede 40%: aprovado.", view: "borrower" },
  { text: "O admin derruba o preço em 30%: a régua vai para alerta.", view: "admin" },
  { text: "O tomador quita e retira a garantia.", view: "borrower" },
];

export function Overview({ snap, go }: ViewProps & { go: (v: string) => void }) {
  const { cfg, price, lots, liquidity, totalDebt } = snap;
  const attested = lots.filter((l) => l.status === 1);
  const totalKg = attested.reduce((s, l) => s + BigInt(l.kg), 0n);
  return (
    <div className="space-y-4">
      <Panel
        title="Estoque físico vira garantia on-chain"
        intro="Lotes auditados de óxido de terras raras são registrados na Stellar, tokenizados (1 token = 1 kg) e usados como garantia para tomar tUSDC, sem vender o material."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Lotes atestados" value={`${attested.length} de ${lots.length}`} sub={kg(totalKg)} />
          <Stat
            label={`Preço ${ASSET} (mediana)`}
            value={price ? usd(price.price) : "—"}
            sub={price ? `por kg · ${price.sources_used} fontes · ${dateTime(price.timestamp)}` : "sem preço publicado"}
          />
          <Stat label="Liquidez no vault" value={usd(liquidity, 0)} />
          <Stat label="Emprestado" value={usd(totalDebt, 0)} />
        </div>
      </Panel>

      <Panel title="Regras do crédito" intro="Aplicadas pelo contrato; o painel só mostra.">
        {cfg ? (
          <dl className="grid gap-x-8 gap-y-2 text-[15px] sm:grid-cols-2">
            <Rule k="LTV máximo para tomar" v={pct(cfg.max_ltv_bps)} />
            <Rule k="Alerta acima de" v={pct(cfg.alert_ltv_bps)} />
            <Rule k="Congelado acima de" v={pct(cfg.freeze_ltv_bps)} />
            <Rule k="Liquidável acima de" v={`${pct(cfg.liquidation_ltv_bps)} (liquidação fora do MVP)`} />
            <Rule k="Juros simples" v={`${pct(cfg.rate_bps)} ao ano`} />
            <Rule k="Preço vence após" v={`${Number(cfg.max_price_age) / 3600} horas`} />
          </dl>
        ) : (
          <p className="text-ink-soft">Carregando configuração do vault…</p>
        )}
      </Panel>

      <Panel title="Roteiro da demonstração" intro="Seis passos, na ordem. Clique para abrir a tela de cada um.">
        <ol className="space-y-2">
          {DEMO_STEPS.map((s, i) => (
            <li key={i}>
              <button onClick={() => go(s.view)} className="flex w-full gap-3 rounded px-2 py-1 text-left hover:bg-mist">
                <span className="font-cond w-5 font-bold text-nd">{i + 1}</span>
                <span>{s.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Contratos na testnet">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {Object.entries({
            "Registro de lotes": CONTRACTS.registry,
            "Token do lote": CONTRACTS.lotToken,
            "Oráculo de preço": CONTRACTS.oracle,
            Vault: CONTRACTS.vault,
            tUSDC: CONTRACTS.usdc,
          }).map(([k, id]) => (
            <li key={k}>
              {k}:{" "}
              <a className="underline" href={EXPLORER_CONTRACT(id)} target="_blank" rel="noreferrer">
                {shortAddr(id)}
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule/70 py-1">
      <dt className="text-ink-soft">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}

// ================================================================ lotes

export function Lots({ address, snap, run, busy }: ViewProps) {
  const [form, setForm] = useState({
    kg: "1000",
    purity: "99,5",
    warehouse: "Armazém Demo — Santos/SP",
    warrant: `WRT-DEMO-${String(Date.now()).slice(-5)}`,
  });
  const [file, setFile] = useState<File>();
  const [hash, setHash] = useState<Uint8Array>();
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (!file) return setHash(undefined);
    sha256(file).then(setHash);
  }, [file]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!hash) return setErr("Anexe o laudo (PDF ou imagem). Só o hash SHA-256 vai para a rede.");
    const purity = Math.round(Number(form.purity.replace(",", ".")) * 100);
    if (!Number.isFinite(purity)) return setErr("Teor inválido. Ex.: 99,5");
    const ok = await run("Cadastro do lote", CONTRACTS.registry, "register_lot", {
      owner: address,
      oxide: ASSET,
      kg: BigInt(form.kg.replace(/\D/g, "") || "0"),
      purity_bps: purity,
      warehouse: form.warehouse,
      warrant_id: form.warrant,
      doc_hash: Buffer.from(hash),
    });
    if (ok) setForm((f) => ({ ...f, warrant: `WRT-DEMO-${String(Date.now()).slice(-5)}` }));
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Cadastrar lote"
        intro="O documento fica com você; a rede guarda só a impressão digital (hash) dele. Qualquer pessoa pode depois conferir se o arquivo é o mesmo."
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Óxido">
            <input className={inputCls} value="NdPr — óxido de neodímio-praseodímio" disabled />
          </Field>
          <Field label="Quantidade (kg)">
            <input className={inputCls} inputMode="numeric" value={form.kg} onChange={(e) => setForm({ ...form, kg: e.target.value })} />
          </Field>
          <Field label="Teor (%)" hint="Do laudo de laboratório.">
            <input className={inputCls} value={form.purity} onChange={(e) => setForm({ ...form, purity: e.target.value })} />
          </Field>
          <Field label="Armazém credenciado">
            <input className={inputCls} value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} />
          </Field>
          <Field label="Nº do warrant" hint="O contrato recusa um número já usado.">
            <input className={inputCls} value={form.warrant} onChange={(e) => setForm({ ...form, warrant: e.target.value })} />
          </Field>
          <Field label="Laudo / certificado" hint={hash ? `SHA-256: ${hex(hash).slice(0, 24)}…` : "PDF ou imagem; não é enviado."}>
            <input className={inputCls} type="file" onChange={(e) => setFile(e.target.files?.[0])} />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-4">
            <Button type="submit" disabled={busy || !address}>Cadastrar lote</Button>
            {!address && <span className="text-sm text-ink-soft">Conecte a carteira do dono do lote.</span>}
            {err && <span className="text-sm text-oxide">{err}</span>}
          </div>
        </form>
      </Panel>
      <LotTable lots={snap.lots} />
      <VerifyDoc lots={snap.lots} />
    </div>
  );
}

function LotTable({ lots }: { lots: Lot[] }) {
  return (
    <Panel title="Lotes registrados">
      {lots.length === 0 ? (
        <p className="text-ink-soft">Nenhum lote ainda. Cadastre o primeiro acima.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-soft">
              <tr>
                <th className="py-2 pr-4 font-medium">Lote</th>
                <th className="py-2 pr-4 font-medium">Quantidade</th>
                <th className="py-2 pr-4 font-medium">Teor</th>
                <th className="py-2 pr-4 font-medium">Warrant</th>
                <th className="py-2 pr-4 font-medium">Dono</th>
                <th className="py-2 pr-4 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className="border-t border-rule">
                  <td className="py-2 pr-4 font-semibold">#{l.id}</td>
                  <td className="py-2 pr-4">{kg(l.kg)}</td>
                  <td className="py-2 pr-4">{pct(l.purity_bps)}</td>
                  <td className="py-2 pr-4">{l.warrant_id}</td>
                  <td className="py-2 pr-4" title={l.owner}>{shortAddr(l.owner)}</td>
                  <td className="py-2 pr-4">
                    {l.status === 1 ? (
                      <span className="text-pr font-semibold">Atestado em {dateTime(l.attested_at)}</span>
                    ) : (
                      <span className="text-assay font-semibold">Aguardando custodiante</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function VerifyDoc({ lots }: { lots: Lot[] }) {
  const [lotId, setLotId] = useState<number>();
  const [result, setResult] = useState<"ok" | "diff">();
  async function check(file?: File) {
    setResult(undefined);
    const lot = lots.find((l) => l.id === lotId);
    if (!file || !lot) return;
    const h = hex(await sha256(file));
    setResult(h === hex(lot.doc_hash) ? "ok" : "diff");
  }
  if (!lots.length) return null;
  return (
    <Panel title="Conferir documento" intro="Escolha um lote e o arquivo: o painel calcula o hash e compara com o registrado na rede.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lote">
          <select className={inputCls} value={lotId ?? ""} onChange={(e) => { setLotId(Number(e.target.value)); setResult(undefined); }}>
            <option value="">Escolha…</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>#{l.id} · {l.warrant_id}</option>
            ))}
          </select>
        </Field>
        <Field label="Arquivo">
          <input className={inputCls} type="file" disabled={!lotId} onChange={(e) => check(e.target.files?.[0])} />
        </Field>
      </div>
      {result === "ok" && <p className="mt-3 font-semibold text-pr">Confere: é o mesmo documento registrado no lote.</p>}
      {result === "diff" && <p className="mt-3 font-semibold text-oxide">Não confere: este arquivo é diferente do registrado.</p>}
    </Panel>
  );
}

// ================================================================ custodiante

export function Custodian({ address, snap, run, busy }: ViewProps) {
  const isCustodian = !!address && address === snap.custodian;
  const pending = snap.lots.filter((l) => l.status === 0);
  return (
    <div className="space-y-4">
      <Panel
        title="Atestar lotes"
        intro="O custodiante confirma que o material está no armazém e confere o laudo. Só depois disso os tokens são emitidos para o dono."
        aside={<span className="text-sm text-ink-soft">Custodiante: {shortAddr(snap.custodian)}</span>}
      >
        {!isCustodian && (
          <p className="mb-3 text-sm text-assay">
            A carteira conectada não é a do custodiante; o contrato vai recusar a atestação.
          </p>
        )}
        {pending.length === 0 ? (
          <p className="text-ink-soft">Nenhum lote aguardando atestação.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {pending.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-semibold">Lote #{l.id} · {kg(l.kg)} de {l.oxide} · teor {pct(l.purity_bps)}</div>
                  <div className="text-sm text-ink-soft">
                    {l.warehouse} · warrant {l.warrant_id} · laudo {hex(l.doc_hash).slice(0, 16)}…
                  </div>
                </div>
                <Button
                  disabled={busy || !address}
                  onClick={() => run(`Atestação do lote #${l.id}`, CONTRACTS.registry, "attest", { lot_id: l.id })}
                >
                  Atestar e emitir {kg(l.kg)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <LotTable lots={snap.lots} />
    </div>
  );
}

// ================================================================ tomador

export function Borrower({ address, snap, run, busy }: ViewProps) {
  const { position: p, cfg } = snap;
  const marks = cfg
    ? [
        { bps: cfg.max_ltv_bps, label: "máximo" },
        { bps: cfg.alert_ltv_bps, label: "alerta" },
        { bps: cfg.freeze_ltv_bps, label: "congela" },
        { bps: cfg.liquidation_ltv_bps, label: "liquida" },
      ]
    : [];
  return (
    <div className="space-y-4">
      <Panel
        title="Seu empréstimo"
        intro="A régua mostra quanto da garantia já está comprometido. O contrato não deixa passar da primeira marca."
        aside={p && <HealthBadge health={p.health} />}
      >
        {!address ? (
          <p className="text-ink-soft">Conecte a carteira do tomador para ver a posição.</p>
        ) : !p ? (
          <p className="text-ink-soft">Carregando posição…</p>
        ) : (
          <div className="space-y-6">
            <LtvScale ltvBps={Number(p.ltv_bps)} health={p.health} marks={marks} />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Garantia no vault" value={kg(p.collateral)} sub={`vale ${usd(p.collateral_value, 0)}`} />
              <Stat label="Dívida (com juros)" value={usd(p.debt)} />
              <Stat label="Ainda pode tomar" value={usd(p.available_to_borrow)} />
              <Stat
                label={`Preço ${ASSET}`}
                value={usd(p.price)}
                sub={p.price_is_stale ? "vencido: empréstimos bloqueados" : `atualizado ${dateTime(p.price_timestamp)}`}
              />
            </div>
            {snap.allowed === false && (
              <p className="text-sm text-assay">
                Esta carteira ainda não foi liberada no token do lote (KYC simulado). Peça ao admin.
              </p>
            )}
            <p className="text-sm text-ink-soft">
              Na carteira: {kg(snap.lotBalance)} em tokens do lote · {usd(snap.usdcBalance)}
            </p>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <AmountAction
          title="Depositar garantia"
          unit="kg"
          disabled={busy || !address}
          suggestion={snap.lotBalance ? String(snap.lotBalance) : ""}
          button="Depositar"
          onRun={(v) => run("Depósito de garantia", CONTRACTS.vault, "deposit", { borrower: address, kg: BigInt(v.replace(/\D/g, "")) })}
        />
        <AmountAction
          title="Tomar empréstimo"
          unit="tUSDC"
          disabled={busy || !address}
          suggestion={p?.available_to_borrow ? fromUnits(p.available_to_borrow, 0).replace(/\./g, "") : ""}
          button="Tomar empréstimo"
          hint={p ? `Limite agora: ${usd(p.available_to_borrow)}. Tente pedir mais para ver o contrato recusar.` : undefined}
          onRun={(v) => run("Empréstimo", CONTRACTS.vault, "borrow", { borrower: address, amount: toUnits(v) })}
        />
        <AmountAction
          title="Quitar"
          unit="tUSDC"
          disabled={busy || !address || !p?.debt}
          suggestion={p?.debt ? fromUnits(p.debt + p.debt / 1000n + 1n, 7).replace(/\./g, "") : ""}
          button="Pagar"
          hint="Pagar a mais é seguro: o contrato cobra só a dívida."
          onRun={(v) => run("Pagamento", CONTRACTS.vault, "repay", { borrower: address, amount: toUnits(v) })}
        />
        <AmountAction
          title="Retirar garantia"
          unit="kg"
          disabled={busy || !address || !p?.collateral}
          suggestion={p?.collateral ? String(p.collateral) : ""}
          button="Retirar"
          hint="Com dívida, só sai o que mantém o LTV dentro do máximo."
          onRun={(v) => run("Retirada de garantia", CONTRACTS.vault, "withdraw", { borrower: address, kg: BigInt(v.replace(/\D/g, "")) })}
        />
      </div>
    </div>
  );
}

function AmountAction({ title, unit, suggestion, button, hint, disabled, onRun }: {
  title: string;
  unit: string;
  suggestion: string;
  button: string;
  hint?: string;
  disabled: boolean;
  onRun: (v: string) => Promise<boolean>;
}) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string>();
  return (
    <Panel title={title}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(undefined);
          try {
            if (await onRun(v || suggestion)) setV("");
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <Field label={`Quantidade (${unit})`} hint={hint}>
          <input className={inputCls} inputMode="decimal" placeholder={suggestion} value={v} onChange={(e) => setV(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={disabled || !(v || suggestion)}>{button}</Button>
          {err && <span className="text-sm text-oxide">{err}</span>}
        </div>
      </form>
    </Panel>
  );
}

// ================================================================ investidor

export function Investor({ address, snap, run, busy }: ViewProps) {
  return (
    <div className="space-y-4">
      <Panel title="Liquidez do vault" intro="Investidores depositam tUSDC; os juros pagos pelos tomadores remuneram esse capital.">
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat label="Disponível para emprestar" value={usd(snap.liquidity, 0)} />
          <Stat label="Emprestado agora" value={usd(snap.totalDebt, 0)} />
          <Stat label="Seu saldo" value={usd(snap.usdcBalance, 0)} />
        </div>
      </Panel>
      <AmountAction
        title="Depositar liquidez"
        unit="tUSDC"
        disabled={busy || !address}
        suggestion="10000"
        button="Depositar"
        onRun={(v) => run("Depósito de liquidez", CONTRACTS.vault, "supply", { provider: address, amount: toUnits(v) })}
      />
    </div>
  );
}

// ================================================================ admin

export function Admin({ address, snap, run, busy }: ViewProps) {
  const isAdmin = !!address && address === snap.cfg?.admin;
  const current = snap.price?.reported?.map((p) => fromUnits(p, 2)) ?? ["80,00", "80,50", "79,50", "80,20"];
  const [prices, setPrices] = useState<string[]>(current);
  const [allow, setAllow] = useState("");
  const [mintTo, setMintTo] = useState("");
  const [mintAmt, setMintAmt] = useState("10000");

  useEffect(() => {
    if (snap.price) setPrices(snap.price.reported.map((p) => fromUnits(p, 2)));
  }, [snap.price?.timestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const publish = (vals: string[], label: string) =>
    run(label, CONTRACTS.oracle, "set_prices", { asset: ASSET, prices: vals.map(toUnits) });

  const base = 80;
  const shock = (factor: number) =>
    [80, 80.5, 79.5, 80.2].map((p) => (p * factor).toFixed(2).replace(".", ","));

  return (
    <div className="space-y-4">
      {!isAdmin && (
        <p className="rounded border-l-4 border-assay bg-assay-soft px-4 py-3 text-sm">
          A carteira conectada não é a do admin ({shortAddr(snap.cfg?.admin)}); o contrato vai recusar estas operações.
        </p>
      )}
      <Panel
        title="Publicar preço do NdPr"
        intro="Na demo, as 4 fontes são simuladas. O contrato usa a mediana e descarta fonte a mais de 15% dela."
      >
        <div className="grid gap-4 sm:grid-cols-4">
          {PRICE_SOURCES.map((s, i) => (
            <Field key={s} label={s} hint="tUSDC por kg">
              <input
                className={inputCls}
                value={prices[i] ?? ""}
                onChange={(e) => setPrices(prices.map((p, j) => (j === i ? e.target.value : p)))}
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled={busy || !address} onClick={() => publish(prices, "Publicação de preço")}>Publicar preços</Button>
          <Button kind="quiet" disabled={busy || !address} onClick={() => publish(shock(1), `Preço base (US$ ${base}/kg)`)}>
            Voltar ao preço base
          </Button>
          <Button kind="danger" disabled={busy || !address} onClick={() => publish(shock(0.7), "Queda de 30% no preço")}>
            Simular queda de 30%
          </Button>
          <Button kind="danger" disabled={busy || !address} onClick={() => publish(shock(0.6), "Queda de 40% no preço")}>
            Simular queda de 40%
          </Button>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Liberar carteira (KYC simulado)" intro="Só carteiras liberadas recebem e enviam tokens do lote.">
          <div className="space-y-3">
            <Field label="Endereço G…">
              <input className={inputCls} value={allow} onChange={(e) => setAllow(e.target.value.trim())} />
            </Field>
            <Button
              disabled={busy || !address || !allow.startsWith("G")}
              onClick={() => run("Liberação de carteira", CONTRACTS.lotToken, "allow_user", { user: allow, operator: address })}
            >
              Liberar carteira
            </Button>
          </div>
        </Panel>
        <Panel title="Emitir tUSDC de teste" intro="Para abastecer investidores e tomadores na demo.">
          <div className="space-y-3">
            <Field label="Endereço G…">
              <input className={inputCls} value={mintTo} placeholder={address} onChange={(e) => setMintTo(e.target.value.trim())} />
            </Field>
            <Field label="Quantidade (tUSDC)">
              <input className={inputCls} value={mintAmt} onChange={(e) => setMintAmt(e.target.value)} />
            </Field>
            <Button
              disabled={busy || !address}
              onClick={() => run("Emissão de tUSDC", CONTRACTS.usdc, "mint", { to: mintTo || address, amount: toUnits(mintAmt) })}
            >
              Emitir tUSDC
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ================================================================ histórico

const EVENT_NAMES: Record<string, string> = {
  lot_registered: "Lote cadastrado",
  lot_attested: "Lote atestado e tokens emitidos",
  price_updated: "Preço publicado",
  supplied: "Liquidez depositada",
  collateral_deposited: "Garantia depositada",
  borrowed: "Empréstimo concedido",
  repaid: "Pagamento recebido",
  collateral_withdrawn: "Garantia liberada",
};

function describe(ev: ChainEvent): string {
  const d = (ev.data ?? {}) as Record<string, bigint | number>;
  switch (ev.name) {
    case "lot_registered":
      return `Lote #${ev.topics[0]} · ${kg(d.kg)}`;
    case "lot_attested":
      return `Lote #${ev.topics[0]} · ${kg(d.tokens_minted)} em tokens`;
    case "price_updated":
      return `${ev.topics[0]} a ${usd(d.price)} por kg · ${d.sources_used} fontes`;
    case "supplied":
      return usd(d.amount, 0);
    case "collateral_deposited":
    case "collateral_withdrawn":
      return `${kg(d.kg)} · total na garantia ${kg(d.total_collateral)}`;
    case "borrowed":
      return `${usd(d.amount)} · dívida ${usd(d.debt)} · LTV ${pct(d.ltv_bps)}`;
    case "repaid":
      return `${usd(d.amount)} · dívida restante ${usd(d.debt)}`;
    default:
      return "";
  }
}

export function History(_: ViewProps) {
  const [events, setEvents] = useState<ChainEvent[]>();
  const [err, setErr] = useState<string>();
  const load = () => {
    setErr(undefined);
    fetchEvents().then(setEvents).catch((e) => setErr(String(e?.message ?? e)));
  };
  useEffect(load, []);
  return (
    <Panel
      title="Histórico on-chain"
      intro="Eventos emitidos pelos contratos nos últimos dias, lidos direto da rede. Cada linha leva à transação."
      aside={<Button kind="quiet" onClick={load}>Atualizar</Button>}
    >
      {err && <p className="text-oxide">{err}</p>}
      {!events && !err && <p className="text-ink-soft">Lendo eventos…</p>}
      {events?.length === 0 && <p className="text-ink-soft">Nenhum evento ainda.</p>}
      {events && events.length > 0 && (
        <ol className="divide-y divide-rule">
          {events.map((ev) => (
            <li key={ev.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div>
                <span className="font-semibold">{EVENT_NAMES[ev.name] ?? ev.name}</span>
                <span className="ml-2 text-ink-soft">{describe(ev)}</span>
              </div>
              <a className="text-sm underline" href={EXPLORER_TX(ev.txHash)} target="_blank" rel="noreferrer">
                {new Date(ev.time).toLocaleString("pt-BR")}
              </a>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
