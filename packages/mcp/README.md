# @handsoff/mcp

Model Context Protocol (MCP) server exposing Handsoff tools to MCP clients.

## Tools

### `buy`

Initiates a buy and returns a tool result describing the outcome.

#### Result schema

A buy can settle on-chain while the receipt write fails (partial settle). In that
case the receipt fields are omitted from the result. The `buy` tool's
`outputSchema` therefore marks the receipt fields as nullable/optional so that
`structuredContent` with missing receipt fields still validates against the
declared schema.

Fields that are always present (for example the transaction hash and status)
remain required. Only the receipt fields affected by a partial settle are
relaxed to nullable/optional.

#### Partial settle

When the on-chain settlement succeeds but the receipt write fails:

- the result is still returned (the buy is not rolled back),
- receipt fields are `null`/absent,
- clients should treat the missing receipt as a recoverable condition and may
  retry the receipt write.

## Development

See the repository root for build and test instructions.
