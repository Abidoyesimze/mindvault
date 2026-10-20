/**
 * Pagination bounds for on-chain vault-registry list() calls.
 * The contract caps page size at 20 (see contract/contracts/vault-registry).
 */

export const REGISTRY_LIST_DEFAULT_START = 0;
export const REGISTRY_LIST_DEFAULT_LIMIT = 20;
export const REGISTRY_LIST_MAX_LIMIT = 20;
