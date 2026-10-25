/** tUSDC usa 7 casas decimais, como o USDC na Stellar. */
export const DECIMALS = 7;
const SCALE = 10n ** BigInt(DECIMALS);

export function toUnits(input: string): bigint {
  const raw = input.trim();
  // "32.000,50" (pt-BR) ou "32000.50"
  const clean = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Valor inválido. Use números, ex.: 32000 ou 32000,50");
  const [whole, frac = ""] = clean.split(".");
  const fracPadded = (frac + "0".repeat(DECIMALS)).slice(0, DECIMALS);
  return BigInt(whole) * SCALE + BigInt(fracPadded);
}

export function fromUnits(v: bigint | number | undefined, digits = 2): string {
  if (v === undefined) return "—";
  const b = BigInt(v);
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(DECIMALS, "0").slice(0, digits);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${wholeStr}${digits > 0 ? "," + fracStr : ""}`;
}

export function usd(v: bigint | number | undefined, digits = 2): string {
  return v === undefined ? "—" : `${fromUnits(v, digits)} tUSDC`;
}

export function kg(v: bigint | number | undefined): string {
  if (v === undefined) return "—";
  return `${BigInt(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kg`;
}

export function pct(bps: bigint | number | undefined): string {
  if (bps === undefined) return "—";
  return `${(Number(bps) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—";
}

export function dateTime(ts: bigint | number | undefined): string {
  if (!ts || Number(ts) === 0) return "—";
  return new Date(Number(ts) * 1000).toLocaleString("pt-BR");
}

export function hex(bytes: Uint8Array | ArrayLike<number> | undefined): string {
  if (!bytes) return "";
  return Array.from(bytes as ArrayLike<number>)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}
