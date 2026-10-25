import { contract, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { CONTRACTS, NETWORK_PASSPHRASE, RPC_URL } from "./config";
import { signTransaction } from "./wallet";

export const server = new rpc.Server(RPC_URL);

type AnyClient = contract.Client & Record<string, (args?: object) => Promise<contract.AssembledTransaction<unknown>>>;

const cache = new Map<string, Promise<AnyClient>>();

function client(contractId: string, publicKey?: string): Promise<AnyClient> {
  const key = `${contractId}:${publicKey ?? "-"}`;
  let c = cache.get(key);
  if (!c) {
    c = contract.Client.from({
      contractId,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      publicKey,
      signTransaction: publicKey
        ? (txXdr: string) => signTransaction(txXdr, { address: publicKey })
        : undefined,
    }) as Promise<AnyClient>;
    c.catch(() => cache.delete(key));
    cache.set(key, c);
  }
  return c;
}

/** Leitura (simulação, sem assinatura). */
export async function read<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const c = await client(contractId);
  const tx = await c[method](args);
  return tx.result as T;
}

export interface WriteResult<T> {
  result: T;
  hash?: string;
}

/** Escrita: simula, pede assinatura na carteira e envia. */
export async function write<T>(
  contractId: string,
  method: string,
  args: object,
  publicKey: string,
): Promise<WriteResult<T>> {
  const c = await client(contractId, publicKey);
  const tx = await c[method](args);
  const sent = await tx.signAndSend();
  const hash =
    (sent as unknown as { sendTransactionResponse?: { hash?: string } }).sendTransactionResponse?.hash;
  // A transação já foi confirmada aqui. Algumas respostas da RPC vêm sem o valor de
  // retorno decodificável (ex.: repay -> i128), e o SDK quebra ao ler; isso não é falha.
  let result: T | undefined;
  try {
    result = sent.result as T;
  } catch {
    result = undefined;
  }
  return { result: result as T, hash };
}

// ---------------------------------------------------------------- erros

const ERRORS: Record<string, Record<number, string>> = {
  [CONTRACTS.vault]: {
    1: "Informe um valor maior que zero.",
    2: "Recusado pelo contrato: o empréstimo passaria do LTV máximo de 40%.",
    3: "Recusado: o preço do oráculo está vencido (mais de 48h). O admin precisa publicar um preço novo.",
    4: "Você não tem essa quantidade de garantia depositada.",
    5: "O vault não tem tUSDC suficiente. Um investidor precisa depositar mais liquidez.",
    6: "Não há dívida para quitar.",
  },
  [CONTRACTS.registry]: {
    1: "Esse número de warrant já foi cadastrado. O mesmo lote não pode ser usado duas vezes.",
    2: "Lote não encontrado.",
    3: "Esse lote já foi atestado.",
    4: "Informe a quantidade em kg (maior que zero).",
    5: "Teor inválido: use um valor entre 0,01% e 100%.",
  },
  [CONTRACTS.lotToken]: {
    1: "Quantidade inválida.",
    2: "Carteira não liberada no token do lote. O admin precisa liberá-la (KYC simulado).",
    3: "Saldo de tokens do lote insuficiente.",
    4: "Só o admin pode liberar carteiras.",
  },
  [CONTRACTS.usdc]: {
    1: "Quantidade inválida.",
    3: "Saldo de tUSDC insuficiente.",
  },
  [CONTRACTS.oracle]: {
    1: "Ainda não há preço publicado para esse óxido.",
    2: "São necessárias pelo menos 3 fontes válidas (até 15% de distância da mediana).",
    3: "Os preços precisam ser maiores que zero.",
  },
};

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof o.message === "string") return o.code !== undefined ? `${o.message} (código ${o.code})` : o.message;
    if (o.error) return messageOf(o.error);
    try {
      return JSON.stringify(err);
    } catch {
      /* objeto circular */
    }
  }
  return String(err);
}

export function explainError(err: unknown, contractId?: string): string {
  const msg = messageOf(err);
  if (/not installed|no wallet|not available|isConnected/i.test(msg))
    return "Carteira não encontrada. Instale a extensão Freighter, recarregue a página e tente de novo.";
  if (/closed the modal|modal closed|user closed/i.test(msg)) return "Janela da carteira fechada sem escolher uma carteira.";
  const m = msg.match(/Error\(Contract, #(\d+)\)/);
  if (m && contractId && ERRORS[contractId]?.[Number(m[1])]) {
    return ERRORS[contractId][Number(m[1])];
  }
  if (m) {
    for (const table of Object.values(ERRORS)) {
      if (table[Number(m[1])]) return `Recusado pelo contrato (erro #${m[1]}).`;
    }
  }
  if (/User declined|rejected|denied/i.test(msg)) return "Assinatura cancelada na carteira.";
  if (/balance|underfunded|insufficient/i.test(msg)) return "Saldo insuficiente para essa operação.";
  if (/Account not found/i.test(msg)) return "Conta não encontrada na testnet. Financie-a pelo Friendbot.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

// ---------------------------------------------------------------- tipos on-chain

export interface Lot {
  id: number;
  owner: string;
  oxide: string;
  kg: bigint;
  purity_bps: number;
  warehouse: string;
  warrant_id: string;
  doc_hash: Uint8Array;
  status: number; // 0 cadastrado, 1 atestado
  registered_at: bigint;
  attested_at: bigint;
}

export interface PriceData {
  price: bigint;
  timestamp: bigint;
  sources_used: number;
  reported: bigint[];
}

export interface VaultConfig {
  admin: string;
  lot_token: string;
  usdc: string;
  oracle: string;
  asset: string;
  max_ltv_bps: number;
  alert_ltv_bps: number;
  freeze_ltv_bps: number;
  liquidation_ltv_bps: number;
  rate_bps: number;
  max_price_age: bigint;
}

export interface PositionView {
  collateral: bigint;
  debt: bigint;
  price: bigint;
  price_timestamp: bigint;
  price_is_stale: boolean;
  collateral_value: bigint;
  ltv_bps: bigint;
  available_to_borrow: bigint;
  health: number; // 0 sem dívida, 1 saudável, 2 alerta, 3 congelado, 4 liquidável
}

// ---------------------------------------------------------------- eventos

export interface ChainEvent {
  id: string;
  ledger: number;
  time: string;
  txHash: string;
  contract: string;
  name: string;
  topics: unknown[];
  data: Record<string, unknown> | unknown;
}

export async function fetchEvents(): Promise<ChainEvent[]> {
  const ids = [CONTRACTS.registry, CONTRACTS.vault, CONTRACTS.oracle].filter(Boolean);
  if (!ids.length) return [];
  const latest = await server.getLatestLedger();
  // A RPC pública guarda só alguns dias de eventos: busca até ~6 dias atrás.
  let start = Math.max(1, latest.sequence - 17_280 * 6);
  let res: rpc.Api.GetEventsResponse | undefined;
  for (let i = 0; i < 3 && !res; i++) {
    try {
      res = await server.getEvents({
        startLedger: start,
        filters: [{ type: "contract", contractIds: ids }],
        limit: 200,
      });
    } catch (e) {
      const m = String((e as Error).message).match(/ledger range: (\d+)/);
      start = m ? Number(m[1]) : latest.sequence - 17_280 * (2 - i);
    }
  }
  if (!res) return [];
  return res.events
    .map((ev) => {
      const topics = ev.topic.map((t: xdr.ScVal) => safeNative(t));
      return {
        id: ev.id,
        ledger: ev.ledger,
        time: ev.ledgerClosedAt,
        txHash: ev.txHash,
        contract: ev.contractId?.toString() ?? "",
        name: String(topics[0] ?? ""),
        topics: topics.slice(1),
        data: safeNative(ev.value),
      };
    })
    .reverse();
}

function safeNative(v: xdr.ScVal): unknown {
  try {
    return scValToNative(v);
  } catch {
    return "?";
  }
}
