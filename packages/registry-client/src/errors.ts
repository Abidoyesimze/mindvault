/**
 * The vault-registry contract's error codes.
 *
 * The contract declares its error enum with `#[contracterror(export = false)]`
 * (`contract/contracts/vault-registry/src/lib.rs`): the enum carries more than
 * the 50 cases the XDR contract spec allows, so it is not part of the spec
 * and the generated bindings ship no error table. The discriminants are still
 * the on-wire codes a failed invocation returns, so this table mirrors the
 * contract's `ERROR_SCHEMA` and `errors.test.ts` fails when the two drift.
 *
 * Do not edit by hand: change `ERROR_SCHEMA` in the contract and re-run the
 * generator in `errors.test.ts` (or copy the table from the contract).
 */
export const Errors = {
  1: { message: "AlreadyRegistered" },
  2: { message: "NotFound" },
  3: { message: "InvalidPrice" },
  4: { message: "MetadataTooLong" },
  5: { message: "InvalidTag" },
  6: { message: "Unauthorized" },
  7: { message: "PendingAdminNotSet" },
  8: { message: "PendingAdminAlreadySet" },
  9: { message: "SameAdmin" },
  10: { message: "TermsHashTooLong" },
  11: { message: "InvalidResourceId" },
  12: { message: "InvalidMetadataPointer" },
  13: { message: "EmptyMetadata" },
  14: { message: "AlreadyOwner" },
  15: { message: "NoPendingTransfer" },
  16: { message: "ReservedId" },
  17: { message: "PriceExceedsMax" },
  18: { message: "AdminNotSet" },
  19: { message: "NotVerifier" },
  20: { message: "InvalidVerificationTransition" },
  21: { message: "AlreadyFrozen" },
  22: { message: "MetadataFrozen" },
  23: { message: "DuplicateInRepair" },
  24: { message: "InvalidTxHash" },
  25: { message: "InvalidPaymentAmount" },
  26: { message: "NotModerator" },
  27: { message: "AlreadyFlagged" },
  28: { message: "NotFlagged" },
  29: { message: "InvalidLifecycleTransition" },
  30: { message: "ResourceNotMutable" },
  31: { message: "NetworkAlreadyInitialized" },
  32: { message: "NetworkIdMismatch" },
  33: { message: "NetworkNotInitialized" },
  34: { message: "FeeBpsTooHigh" },
  35: { message: "TotalFeeTooHigh" },
  36: { message: "CountOverflow" },
  37: { message: "BatchTooLarge" },
  38: { message: "DuplicateReceipt" },
  39: { message: "FlagReasonHashTooLong" },
  40: { message: "ContractPaused" },
  41: { message: "NotSettler" },
  42: { message: "ReceiptAlreadyExists" },
  43: { message: "InvalidPaymentTransition" },
  44: { message: "InvalidReceiptId" },
  45: { message: "ContentHashTooLong" },
  46: { message: "AttestationHashTooLong" },
  47: { message: "PaymentAmountMismatch" },
  48: { message: "DuplicateTxHash" },
  49: { message: "FeeConfigNotSet" },
  50: { message: "AdminNominationExpired" },
  51: { message: "InvalidMetadataPointers" },
  52: { message: "AdminAlreadySet" },
  53: { message: "RecoveryAdminNotSet" },
  54: { message: "UnsupportedResourceSchema" },
  55: { message: "RevisionOverflow" },
} as const;

/** A vault-registry error code (the on-chain discriminant). */
export type RegistryErrorCode = keyof typeof Errors;

/** The name of a vault-registry error, e.g. `"NotFound"`. */
export type RegistryErrorName = (typeof Errors)[keyof typeof Errors]["message"];

/**
 * The error name for a code, or `undefined` when the code is unknown.
 *
 * Used to compare a failed invocation's error message against the contract's
 * error names without hardcoding a literal at every call site.
 */
export function registryErrorName(code: number): RegistryErrorName | undefined {
  return (Errors as Record<number, { message: RegistryErrorName }>)[code]?.message;
}
