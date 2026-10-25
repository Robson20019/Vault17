const env = import.meta.env;

export const RPC_URL: string = env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE: string =
  env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export const CONTRACTS = {
  lotToken: env.VITE_LOT_TOKEN ?? "",
  usdc: env.VITE_USDC ?? "",
  oracle: env.VITE_ORACLE ?? "",
  registry: env.VITE_REGISTRY ?? "",
  vault: env.VITE_VAULT ?? "",
};

export const IS_CONFIGURED = Object.values(CONTRACTS).every((v) => v.startsWith("C"));

/** Ativo usado no oráculo e no vault. */
export const ASSET = "NDPR";

/** Nomes das 4 fontes de preço, na ordem enviada ao oráculo (simuladas na demo). */
export const PRICE_SOURCES = ["Fastmarkets", "Metal Pages", "SMM", "Baotou"];

export const EXPLORER_TX = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const EXPLORER_CONTRACT = (id: string) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`;
