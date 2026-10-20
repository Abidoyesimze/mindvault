/**
 * Boundary tests for the fixed metadata digest format.
 *
 * The acceptance bar for the anchor format is that clients can rely on it:
 * every accepted spelling of a digest canonicalizes to the same string, and
 * every rejection is deterministic, explains itself, and never leaks the
 * rejected value's meaning beyond its shape.
 */
import { describe, it, expect } from "vitest";
import {
  METADATA_HASH_ALGORITHMS,
  METADATA_HASH_ALGORITHM_NAMES,
  MetadataHashError,
  canonicalizeMetadataHash,
  describeMetadataPointerHash,
  isValidMetadataHash,
  parseMetadataHash,
} from "./metadataHash.js";

const SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const SHA512 =
  "ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db2" +
  "7ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff";

function rejects(value: unknown, field = "metadataHash"): MetadataHashError {
  try {
    parseMetadataHash(value, field);
  } catch (err) {
    expect(err).toBeInstanceOf(MetadataHashError);
    return err as MetadataHashError;
  }
  throw new Error(`expected ${JSON.stringify(value)} to be rejected`);
}

describe("supported formats", () => {
  it("documents exactly sha256 and sha512", () => {
    expect(METADATA_HASH_ALGORITHM_NAMES).toEqual(["sha256", "sha512"]);
    expect(METADATA_HASH_ALGORITHMS.sha256).toBe(64);
    expect(METADATA_HASH_ALGORITHMS.sha512).toBe(128);
  });

  it("accepts a bare sha256 digest and infers the algorithm from its length", () => {
    expect(parseMetadataHash(SHA256)).toEqual({
      algorithm: "sha256",
      hex: SHA256,
      canonical: `sha256:${SHA256}`,
    });
  });

  it("accepts a bare sha512 digest", () => {
    expect(parseMetadataHash(SHA512).algorithm).toBe("sha512");
  });

  it("accepts colon- and dash-prefixed digests", () => {
    expect(parseMetadataHash(`sha256:${SHA256}`).canonical).toBe(`sha256:${SHA256}`);
    expect(parseMetadataHash(`sha256-${SHA256}`).canonical).toBe(`sha256:${SHA256}`);
    expect(parseMetadataHash(`sha512:${SHA512}`).canonical).toBe(`sha512:${SHA512}`);
  });

  it("is case-insensitive and canonicalizes to lowercase", () => {
    expect(parseMetadataHash(SHA256.toUpperCase()).canonical).toBe(`sha256:${SHA256}`);
    expect(parseMetadataHash(`SHA256:${SHA256.toUpperCase()}`).canonical).toBe(`sha256:${SHA256}`);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseMetadataHash(`  ${SHA256}\n`).canonical).toBe(`sha256:${SHA256}`);
  });

  it("canonicalizes every accepted spelling of one digest identically", () => {
    const spellings = [
      SHA256,
      SHA256.toUpperCase(),
      `sha256:${SHA256}`,
      `SHA256-${SHA256.toUpperCase()}`,
      ` ${SHA256} `,
    ];
    const canonical = new Set(spellings.map((s) => canonicalizeMetadataHash(s)));
    expect(canonical).toEqual(new Set([`sha256:${SHA256}`]));
  });
});

describe("invalid length", () => {
  it("rejects a digest one character short", () => {
    const err = rejects(SHA256.slice(0, 63));
    expect(err.code).toBe("invalid_length");
    expect(err.message).toContain("63 hex characters");
    expect(err.message).toContain("sha256=64");
  });

  it("rejects a digest one character long", () => {
    expect(rejects(`${SHA256}a`).code).toBe("invalid_length");
  });

  it("rejects a length between the two supported digests", () => {
    expect(rejects("a".repeat(96)).code).toBe("invalid_length");
  });

  it("rejects a prefixed digest whose length contradicts its algorithm", () => {
    const err = rejects(`sha512:${SHA256}`);
    expect(err.code).toBe("invalid_length");
    expect(err.message).toContain("sha512 digests are 128");
  });

  it("rejects a single hex character", () => {
    expect(rejects("a").code).toBe("invalid_length");
  });
});

describe("invalid characters", () => {
  it("rejects non-hex letters", () => {
    const err = rejects("z".repeat(64));
    expect(err.code).toBe("invalid_characters");
    expect(err.message).toContain("hexadecimal");
  });

  it("rejects a digest with one non-hex character", () => {
    expect(rejects(`${SHA256.slice(0, 63)}g`).code).toBe("invalid_characters");
  });

  it("rejects embedded whitespace and punctuation", () => {
    expect(rejects(`${SHA256.slice(0, 32)} ${SHA256.slice(33)}`).code).toBe("invalid_characters");
    expect(rejects(`${SHA256.slice(0, 63)}!`).code).toBe("invalid_characters");
  });

  it("rejects base64 and multibase spellings of a digest", () => {
    expect(rejects("n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=").code).toBe("invalid_characters");
  });
});

describe("unsupported algorithms", () => {
  it("rejects an unknown algorithm prefix", () => {
    const err = rejects(`md5:${"a".repeat(32)}`);
    expect(err.code).toBe("unknown_algorithm");
    expect(err.message).toContain("sha256, sha512");
  });

  it("rejects an IPFS CID pointer", () => {
    expect(rejects("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").code).toBe(
      "invalid_characters",
    );
    expect(rejects("ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").code).toBe(
      "unknown_algorithm",
    );
  });
});

describe("non-string and empty input", () => {
  it.each([[undefined], [null], [42], [true], [{}], [[]]])("rejects %s", (value) => {
    expect(rejects(value).code).toBe("not_a_string");
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(rejects("").code).toBe("empty");
    expect(rejects("   ").code).toBe("empty");
  });
});

describe("error messages", () => {
  it("names the field it was given", () => {
    expect(rejects("nope", "txHash").message.startsWith("txHash")).toBe(true);
    expect(rejects("nope", "expectedMetadataHash").field).toBe("expectedMetadataHash");
  });

  it("is identical for identical input", () => {
    expect(rejects("zz").message).toBe(rejects("zz").message);
  });
});

describe("isValidMetadataHash / canonicalizeMetadataHash", () => {
  it("never throw", () => {
    expect(isValidMetadataHash(SHA256)).toBe(true);
    expect(isValidMetadataHash("nope")).toBe(false);
    expect(isValidMetadataHash(undefined)).toBe(false);
    expect(canonicalizeMetadataHash("nope")).toBeNull();
    expect(canonicalizeMetadataHash(SHA512)).toBe(`sha512:${SHA512}`);
  });
});

describe("describeMetadataPointerHash", () => {
  it("reports the digest anchored in a server-written metadata pointer", () => {
    const pointer = JSON.stringify({ title: "T", description: "", contentHash: SHA256 });
    expect(describeMetadataPointerHash(pointer)).toEqual({
      present: true,
      valid: true,
      canonical: `sha256:${SHA256}`,
      algorithm: "sha256",
      reason: null,
    });
  });

  it("flags a malformed anchor without throwing", () => {
    const pointer = JSON.stringify({ title: "T", contentHash: "abc" });
    const report = describeMetadataPointerHash(pointer);
    expect(report.present).toBe(true);
    expect(report.valid).toBe(false);
    expect(report.canonical).toBeNull();
    expect(report.reason).toContain("contentHash");
  });

  it("reports a missing contentHash field", () => {
    const report = describeMetadataPointerHash(JSON.stringify({ title: "T" }));
    expect(report.present).toBe(false);
    expect(report.reason).toContain("no contentHash field");
  });

  it("reports non-JSON pointers (bare IPFS URI) as un-anchored", () => {
    const report = describeMetadataPointerHash("ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79o");
    expect(report.present).toBe(false);
    expect(report.reason).toContain("not JSON");
  });

  it("reports an empty or non-string pointer", () => {
    expect(describeMetadataPointerHash("").reason).toContain("No metadata pointer");
    expect(describeMetadataPointerHash(undefined).present).toBe(false);
  });

  it("reports JSON that is not an object", () => {
    expect(describeMetadataPointerHash("[1,2]").reason).toContain("not an object");
  });
});
