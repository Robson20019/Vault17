import { useCallback, useEffect, useState } from "react";
import { ASSET, CONTRACTS, IS_CONFIGURED } from "./lib/config";
import {
  explainError,
  read,
  write,
  type Lot,
  type PositionView,
  type PriceData,
  type VaultConfig,
} from "./lib/contracts";
import { shortAddr } from "./lib/format";
import { connect, disconnect, restore } from "./lib/wallet";
import { NoticeBar, type Notice } from "./ui";
import { Admin, Borrower, Custodian, History, Investor, Lots, Overview } from "./views";

export interface Snapshot {
  cfg?: VaultConfig;
  custodian?: string;
  price?: PriceData;
  lots: Lot[];
  position?: PositionView;
  lotBalance?: bigint;
  usdcBalance?: bigint;
  allowed?: boolean;
  liquidity?: bigint;
  totalDebt?: bigint;
  loadError?: string;
}

export type Run = (
  label: string,
  contractId: string,
  method: string,
  args: object,
) => Promise<boolean>;

export interface ViewProps {
  address?: string;
  snap: Snapshot;
  run: Run;
  busy: boolean;
  refresh: () => Promise<void>;
}

const VIEWS = [
  { id: "overview", label: "Visão geral", who: "Todos" },
  { id: "lots", label: "Lotes e evidências", who: "Dono do lote" },
  { id: "custodian", label: "Atestação", who: "Custodiante" },
  { id: "borrower", label: "Empréstimo", who: "Tomador" },
  { id: "investor", label: "Liquidez", who: "Investidor" },
  { id: "admin", label: "Oráculo e acessos", who: "Admin" },
  { id: "history", label: "Histórico on-chain", who: "Todos" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

export default function App() {
  const [address, setAddress] = useState<string>();
  const [view, setView] = useState<ViewId>("overview");
  const [snap, setSnap] = useState<Snapshot>({ lots: [] });
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    restore().then((a) => a && setAddress(a));
  }, []);

  const refresh = useCallback(async () => {
    if (!IS_CONFIGURED) return;
    const safe = <T,>(p: Promise<T>) => p.catch(() => undefined);
    try {
      const [cfg, custodian, price, count, liquidity, totalDebt] = await Promise.all([
        safe(read<VaultConfig>(CONTRACTS.vault, "config")),
        safe(read<string>(CONTRACTS.registry, "custodian")),
        safe(read<PriceData>(CONTRACTS.oracle, "price", { asset: ASSET })),
        safe(read<number>(CONTRACTS.registry, "lot_count")),
        safe(read<bigint>(CONTRACTS.vault, "liquidity")),
        safe(read<bigint>(CONTRACTS.vault, "total_debt")),
      ]);
      const ids = Array.from({ length: Number(count ?? 0) }, (_, i) => i + 1);
      const lots = (await Promise.all(ids.map((id) => safe(read<Lot>(CONTRACTS.registry, "lot", { lot_id: id }))))).filter(
        (l): l is Lot => !!l,
      );
      let position, lotBalance, usdcBalance, allowed;
      if (address) {
        [position, lotBalance, usdcBalance, allowed] = await Promise.all([
          safe(read<PositionView>(CONTRACTS.vault, "position", { borrower: address })),
          safe(read<bigint>(CONTRACTS.lotToken, "balance", { id: address })),
          safe(read<bigint>(CONTRACTS.usdc, "balance", { id: address })),
          safe(read<boolean>(CONTRACTS.lotToken, "allowed", { account: address })),
        ]);
      }
      setSnap({
        cfg,
        custodian,
        price,
        lots,
        position,
        lotBalance,
        usdcBalance,
        allowed,
        liquidity,
        totalDebt,
        loadError: cfg ? undefined : "Não foi possível ler o vault na testnet. Confira os IDs em web/.env.local.",
      });
    } catch (e) {
      setSnap((s) => ({ ...s, loadError: explainError(e) }));
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const run: Run = async (label, contractId, method, args) => {
    if (!address) {
      setNotice({ kind: "error", text: "Conecte uma carteira para assinar a operação." });
      return false;
    }
    setBusy(true);
    setNotice({ kind: "pending", text: `${label}: confirme na carteira e aguarde a rede…` });
    try {
      const { hash } = await write(contractId, method, args, address);
      setNotice({ kind: "ok", text: `${label}: concluído.`, hash });
      await refresh();
      return true;
    } catch (e) {
      console.error(`[vault17] ${label}`, e);
      setNotice({ kind: "error", text: `${label}: ${explainError(e, contractId)}` });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const roles: string[] = [];
  if (address && snap.cfg?.admin === address) roles.push("admin");
  if (address && snap.custodian === address) roles.push("custodiante");
  if (address && snap.allowed) roles.push("carteira liberada");

  const props: ViewProps = { address, snap, run, busy, refresh };

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-3">
            <span className="font-cond text-2xl font-bold tracking-tight">Vault17</span>
            <span className="hidden text-sm text-white/70 sm:inline">
              Crédito em stablecoin com estoque de terras raras como garantia
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded bg-white/10 px-2 py-1">Testnet · demonstração</span>
            {address ? (
              <>
                <span title={address} className="font-semibold">{shortAddr(address)}</span>
                <button
                  className="rounded border border-white/30 px-3 py-1 hover:border-white"
                  onClick={async () => {
                    await disconnect();
                    setAddress(undefined);
                  }}
                >
                  Desconectar
                </button>
              </>
            ) : (
              <button
                className="rounded bg-white px-3 py-1 font-semibold text-ink hover:bg-nd-soft"
                onClick={async () => {
                  try {
                    setAddress(await connect());
                  } catch (e) {
                    setNotice({ kind: "error", text: `Carteira: ${explainError(e)}` });
                  }
                }}
              >
                Conectar carteira
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 md:grid-cols-[220px_1fr]">
        <nav aria-label="Seções" className="min-w-0 md:sticky md:top-6 md:self-start">
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {VIEWS.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setView(v.id)}
                  aria-current={view === v.id ? "page" : undefined}
                  className={`w-full whitespace-nowrap rounded px-3 py-2 text-left ${
                    view === v.id ? "bg-paper font-semibold shadow-[inset_3px_0_0_var(--color-nd)]" : "hover:bg-paper/60"
                  }`}
                >
                  <span className="block text-[15px]">{v.label}</span>
                  <span className="hidden text-xs text-ink-soft md:block">{v.who}</span>
                </button>
              </li>
            ))}
          </ul>
          {address && (
            <p className="mt-4 hidden text-xs text-ink-soft md:block">
              Sua carteira: {roles.length ? roles.join(", ") : "sem papéis especiais"}.
            </p>
          )}
        </nav>

        <main className="min-w-0 space-y-4">
          <NoticeBar notice={notice} onClose={() => setNotice(undefined)} />
          {!IS_CONFIGURED && (
            <div className="rounded border-l-4 border-assay bg-assay-soft px-4 py-3">
              Os contratos ainda não foram configurados. Rode <code>scripts\deploy.ps1</code> na raiz do
              projeto: ele publica os contratos na testnet e grava os IDs em <code>web\.env.local</code>.
            </div>
          )}
          {snap.loadError && IS_CONFIGURED && (
            <div className="rounded border-l-4 border-oxide bg-oxide-soft px-4 py-3">{snap.loadError}</div>
          )}
          {view === "overview" && <Overview {...props} go={(v) => setView(v as ViewId)} />}
          {view === "lots" && <Lots {...props} />}
          {view === "custodian" && <Custodian {...props} />}
          {view === "borrower" && <Borrower {...props} />}
          {view === "investor" && <Investor {...props} />}
          {view === "admin" && <Admin {...props} />}
          {view === "history" && <History {...props} />}
          <footer className="pt-4 text-xs text-ink-soft">
            Protótipo do HackMeridian 2026. Todos os dados são fictícios; o token representa um direito simulado,
            não propriedade legal do material. tUSDC é uma moeda de teste sem valor.
          </footer>
        </main>
      </div>
    </div>
  );
}
