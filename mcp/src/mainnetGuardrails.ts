/**
 * Mainnet readiness guardrails for the MindVault MCP server.
 *
 * When STELLAR_NETWORK / x402 targets mainnet, mutating tools and buys require
 * an explicit confirmation so agents cannot spend real USDC or mutate mainnet
 * state by accident. Read-only tools are never gated.
 *
 * Confirmation sources (any one is enough):
 *   1. Tool argument `confirmMainnet: true`
 *   2. Env `MINDVAULT_ALLOW_MAINNET=1` (or `true` / `yes`)
 *
 * Errors are deterministic and agent-safe (no secrets, no stack traces).
 */

/** Tools that mutate state or spend funds — gated on mainnet. */
export const MAINNET_GATED_TOOLS = [
  "mindvault_setup_wallet",
  "mindvault_register",
  "mindvault_publish",
  "mindvault_publish_batch",
  "mindvault_buy",
  "mindvault_register_onchain",
  "mindvault_reset",
  "mindvault_update_metadata",
  "mindvault_set_price",
  "mindvault_transfer_ownership",
  "mindvault_set_listed",
  "mindvault_freeze",
  "mindvault_royalty",
  "mindvault_set_tags",
] as const;

export type MainnetGatedTool = (typeof MAINNET_GATED_TOOLS)[number];

const GATED_SET: ReadonlySet<string> = new Set(MAINNET_GATED_TOOLS);

/** True when the deployment target is mainnet/pubnet. */
export function isMainnetNetwork(network: string | undefined): boolean {
  if (!network) return false;
  const n = network.trim().toLowerCase();
  return (
    n === "mainnet" ||
    n === "pubnet" ||
    n === "public" ||
    n === "stellar:pubnet" ||
    n === "stellar:mainnet"
  );
}

/** Parse truthy confirmation from a tool arg. */
export function isTruthyConfirm(value: unknown): boolean {
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/** Operator env override that unlocks all mainnet mutations for this process. */
export function mainnetAllowedFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.MINDVAULT_ALLOW_MAINNET;
  if (raw == null || raw === "") return false;
  return isTruthyConfirm(raw);
}

/** Whether a tool name is gated on mainnet. */
export function isMainnetGatedTool(toolName: string): boolean {
  return GATED_SET.has(toolName);
}

/**
 * Deterministic error when a mainnet mutation/buy is attempted without confirm.
 * Safe for agent-facing output (no secrets, no internal paths).
 */
export function mainnetConfirmationRequiredError(toolName: string): Error {
  return new Error(
    [
      `Mainnet guardrail: "${toolName}" is blocked on mainnet without explicit confirmation.`,
      "This tool mutates state or spends funds on the public Stellar network.",
      "To proceed, pass confirmMainnet: true on this tool call,",
      "or set MINDVAULT_ALLOW_MAINNET=1 on the MCP server process.",
      "Read-only tools (browse, search, preview, registry_lookup, registry_list, tx_status, …) are unrestricted.",
    ].join(" "),
  );
}

/**
 * Assert a tool may run on the current network.
 * No-op on testnet / non-gated tools / when confirmation is present.
 */
export function assertMainnetMutationAllowed(
  network: string | undefined,
  toolName: string,
  args: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isMainnetNetwork(network)) return;
  if (!isMainnetGatedTool(toolName)) return;
  if (mainnetAllowedFromEnv(env)) return;
  if (isTruthyConfirm(args?.confirmMainnet)) return;
  throw mainnetConfirmationRequiredError(toolName);
}

/** Compact mainnet diagnostics line for operator/agent status output. */
export function formatMainnetDiagnostics(input: {
  stellarNetwork: string;
  x402Network: string;
  registryContractId: string;
  allowMainnetEnv: boolean;
}): string {
  const lines = [
    `Network: ${input.stellarNetwork}`,
    `x402: ${input.x402Network}`,
    `Registry: ${input.registryContractId || "(unset — required on mainnet)"}`,
    `Mainnet mutations: ${
      input.allowMainnetEnv
        ? "allowed via MINDVAULT_ALLOW_MAINNET"
        : "require confirmMainnet: true per call"
    }`,
  ];
  return lines.join("\n");
}
