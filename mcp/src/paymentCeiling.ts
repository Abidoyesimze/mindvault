/**
 * Guardrail for automatic x402 payments.
 *
 * Prices are converted to Stellar's 7-decimal stroop precision before
 * comparison so a ceiling never depends on floating-point rounding.
 */

export const DEFAULT_MAX_AUTO_PAY_USDC = "10";
export const DEFAULT_MAX_AUTO_FEE_STROOPS = "100000";

const USDC_AMOUNT = /^\d+(?:\.\d{1,7})?$/;
const STROOPS_PER_USDC = 10_000_000n;

function toStroops(value: string): bigint | null {
  if (!USDC_AMOUNT.test(value)) return null;
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * STROOPS_PER_USDC + BigInt(fractional.padEnd(7, "0"));
}

function configuredCeiling(env: NodeJS.ProcessEnv): { value: string; stroops: bigint } {
  const value = env.MINDVAULT_MAX_AUTO_PAY_USDC ?? DEFAULT_MAX_AUTO_PAY_USDC;
  const stroops = toStroops(value);
  if (stroops === null) {
    throw new Error(
      "MINDVAULT_MAX_AUTO_PAY_USDC must be a non-negative USDC decimal with at most 7 decimal places.",
    );
  }
  return { value, stroops };
}

/**
 * Prevent an automatic x402 payment above the configured ceiling unless the
 * caller explicitly authorizes a limit that covers the advertised price.
 */
export function assertAutoPaymentWithinCeiling(input: {
  price: unknown;
  maxAutoPayUsdc?: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const requiredAmount = typeof input.price === "string" ? input.price : String(input.price ?? "");
  const requiredStroops = toStroops(requiredAmount);
  if (requiredStroops === null) {
    throw new Error(
      "Automatic payment blocked because the resource price is missing or invalid; no x402 payment was submitted.",
    );
  }

  const ceiling = configuredCeiling(input.env ?? process.env);
  if (requiredStroops <= ceiling.stroops) return;

  const overrideStroops =
    input.maxAutoPayUsdc === undefined ? null : toStroops(input.maxAutoPayUsdc);
  if (input.maxAutoPayUsdc !== undefined && overrideStroops === null) {
    throw new Error(
      "maxAutoPayUsdc must be a non-negative USDC decimal with at most 7 decimal places.",
    );
  }
  if (overrideStroops !== null && overrideStroops >= requiredStroops) return;

  throw new Error(
    `Purchase requires ${requiredAmount} USDC, which exceeds the automatic payment ceiling of ${ceiling.value} USDC. ` +
      `To authorize this purchase, call mindvault_buy with maxAutoPayUsdc: "${requiredAmount}" (or a higher amount).`,
  );
}

/** Bound sponsored Stellar transaction fees for registry mutations. */
export function assertTransactionFeeWithinCeiling(input: {
  feeStroops: string | number | bigint;
  env?: NodeJS.ProcessEnv;
}): void {
  const raw = input.env?.MINDVAULT_MAX_AUTO_FEE_STROOPS ?? process.env.MINDVAULT_MAX_AUTO_FEE_STROOPS ?? DEFAULT_MAX_AUTO_FEE_STROOPS;
  if (!/^\d+$/.test(raw)) throw new Error("MINDVAULT_MAX_AUTO_FEE_STROOPS must be a non-negative integer.");
  const fee = BigInt(String(input.feeStroops));
  const ceiling = BigInt(raw);
  if (fee > ceiling) {
    throw new Error(`On-chain mutation fee ${fee} stroops exceeds the automatic fee ceiling of ${ceiling} stroops.`);
  }
}
