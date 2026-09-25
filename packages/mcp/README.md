# MCP

Model Context Protocol (MCP) integration for the project.

## Request signing

Requests to the MCP endpoint are authenticated with an HMAC signature sent in
the `X-Request-Signature` header. The signature is computed over a canonical
representation of the request so that neither the body nor the query string can
be tampered with in transit.

### Canonical payload

The signed payload is the concatenation of the canonical query string and the
raw request body, separated by a newline:

```
<canonical-query>\n<raw-body>
```

- **Canonical query string**: the request's query parameters, sorted by key
  (and by value for repeated keys), percent-encoded with a stable encoding, and
  joined with `&`. Keys with no value are rendered as `key=`. If there are no
  query parameters, the canonical query string is empty.
- **Raw body**: the exact bytes of the request body. For requests without a
  body, this is empty.

Example:

```
GET /mcp/tools?sort=name&page=2

canonical-query: page=2&sort=name
raw-body:        (empty)
payload:         page=2&sort=name\n
```

### Signing

```
signature = hex(HMAC-SHA256(secret, payload))
```

### Verification

Verification recomputes the signature over the same canonical query string and
raw body, then compares it to the `X-Request-Signature` header using a
constant-time comparison. Because the query string is part of the signed
payload, replaying a request with altered query parameters (for example
changing `page` or `sort`) produces a different signature and is rejected.

### Notes

- Sign the canonical query string, not the raw one, so that parameter ordering
  does not affect the signature.
- Body-only signing is insufficient for GET-style calls: query parameters must
  be covered by the signature as well.
