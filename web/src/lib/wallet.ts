import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { NETWORK_PASSPHRASE } from "./config";

let started = false;

function start() {
  if (started) return;
  StellarWalletsKit.init({ modules: defaultModules(), network: Networks.TESTNET });
  started = true;
}

export async function connect(): Promise<string> {
  start();
  const { address } = await StellarWalletsKit.authModal();
  localStorageSafeSet("vault17.connected", "1");
  return address;
}

export async function restore(): Promise<string | undefined> {
  if (localStorageSafeGet("vault17.connected") !== "1") return undefined;
  try {
    start();
    const { address } = await StellarWalletsKit.getAddress();
    return address || undefined;
  } catch {
    return undefined;
  }
}

export async function disconnect() {
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    /* sem carteira ativa */
  }
  localStorageSafeSet("vault17.connected", "0");
}

export async function signTransaction(xdr: string, opts?: { address?: string }) {
  return StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: opts?.address,
  });
}

function localStorageSafeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSafeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* navegação privada */
  }
}
