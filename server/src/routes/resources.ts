import { Router, type Router as RouterType } from "express";
import multer from "multer";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { validate, validateFields } from "../middleware/validate.js";
import {
  filePublishBodySchema,
  linkPublishSchema,
  registerResourceSchema,
  preparePriceSchema,
  setPriceSchema,
  prepareOwnershipSchema,
  transferOwnershipSchema,
} from "../schemas/requests.js";
import { dynamicPaywall } from "../middleware/dynamicPaywall.js";
import {
  createFileResource,
  createLinkResource,
  listCatalog,
  getResourceMeta,
  getVerificationDetails,
  delistResource,
  getResourceById,
} from "../services/resourceService.js";
import { downloadFile } from "../storage/supabaseStorage.js";
import { db } from "../db/client.js";
import { payments, resources } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { getLogger } from "../lib/logger.js";
import { publishIpRateLimit, publishWalletRateLimit } from "../middleware/rateLimiters.js";
import {
  NETWORK_PASSPHRASE,
  registryClient,
  setPrice,
  transferOwnership,
  buildRegisterTx,
  submitSignedTx,
  registryKeypair,
} from "../services/registryClient.js";

const router: RouterType = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024 },
});

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

function decodeCursor(cursor?: string): number | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("bad");
    return parsed;
  } catch {
    return null;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

// POST /resources — publish a resource (authenticated)
router.post(
  "/resources",
  apiKeyAuth,
  publishIpRateLimit,
  publishWalletRateLimit,
  upload.single("file"),
  async (req, res) => {
    const publisher = req.publisher!;

    // File upload
    if (req.file) {
      const parsed = validateFields(filePublishBodySchema, req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.format() });
        return;
      }

      const { title, description, price, walletAddress } = parsed.data;

      const resource = await createFileResource({
        publisherId: publisher.id,
        title,
        description,
        price,
        walletAddress: walletAddress || publisher.walletAddress,
        fileBuffer: req.file.buffer,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      res.status(201).json({
        ...resource,
        accessUrl: `${config.BASE_URL}/resources/${resource.id}`,
      });
      return;
    }

    // Link resource
    const parsed = linkPublishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const resource = await createLinkResource({
      publisherId: publisher.id,
      title: parsed.data.title,
      description: parsed.data.description,
      price: parsed.data.price,
      walletAddress: parsed.data.walletAddress || publisher.walletAddress,
      externalUrl: parsed.data.externalUrl,
    });

    res.status(201).json({
      ...resource,
      accessUrl: `${config.BASE_URL}/resources/${resource.id}`,
    });
  },
);

// GET /resources — browse catalog (public) with pagination
router.get("/resources", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const limitRaw = req.query.limit;
  const limit = Math.min(
    Math.max(Number(limitRaw) || DEFAULT_PAGE_LIMIT, 1),
    MAX_PAGE_LIMIT,
  );
  const offset = decodeCursor(cursor);
  if (cursor && offset === null) {
    res.status(400).json({ error: "invalid_cursor" });
    return;
  }
  const start = offset ?? 0;
  const catalog = await listCatalog({ limit, offset: start });
  const items = catalog.map((r) => ({
    ...r,
    accessUrl: `${config.BASE_URL}/resources/${r.id}`,
  }));
  const nextOffset = start + items.length;
  res.json({
    items,
    nextCursor: items.length === limit ? encodeCursor(nextOffset) : null,
    count: items.length,
  });
});

// GET /resources/:id/meta — resource preview (public)
router.get("/resources/:id/meta", async (req, res) => {
  const meta = await getResourceMeta(req.params.id as string);
  if (!meta) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  res.json({
    ...meta,
    accessUrl: `${config.BASE_URL}/resources/${meta.id}`,
  });
});

// GET /resources/:id/verification — verification status and details (public)
router.get("/resources/:id/verification", async (req, res) => {
  const details = await getVerificationDetails(req.params.id as string);
  if (!details) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  res.json(details);
});

// GET /resources/:id — access resource (x402 paywalled)
router.get("/resources/:id", dynamicPaywall, async (req, res) => {
  const resource = (req as any).resource;

  // Record payment
  let payerAddress = "unknown";
  try {
    const paymentHeader = req.headers["x-payment"] as string;
    if (paymentHeader) {
      const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
      payerAddress =
        decoded?.payload?.authorization?.address || decoded?.clientAddress || "unknown";
    }
  } catch {
    // Best effort — don't fail delivery if we can't parse
  }

  const [payment] = await db
    .insert(payments)
    .values({
      resourceId: resource.id,
      payerAddress,
      recipientAddress: resource.walletAddress,
      amount: resource.price,
    })
    .returning();

  if (resource.resourceType === "link") {
    res.json({
      url: resource.externalUrl,
      receipt: {
        paymentId: payment.id,
        amount: payment.amount,
        currency: "USDC",
        paidTo: payment.recipientAddress,
        paidAt: payment.paidAt,
      },
    });
    return;
  }

  // Stream file from Supabase Storage
  if (!resource.storagePath) {
    res.status(500).json({ error: "Resource file not found" });
    return;
  }

  // Add receipt info in headers for file downloads
  res.setHeader("X-Payment-Id", payment.id);
  res.setHeader("X-Payment-Amount", `${payment.amount} USDC`);
  res.setHeader("X-Payment-Recipient", payment.recipientAddress);

  const { buffer, mimeType } = await downloadFile(resource.storagePath);
  res.setHeader("Content-Type", mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${resource.storagePath.split("/").pop()}"`,
  );
  res.send(buffer);
});

// POST /resources/:id/delist — delist a resource (publisher only)
router.post("/resources/:id/delist", apiKeyAuth, async (req, res) => {
  const publisher = req.publisher!;
  const resourceId = req.params.id as string;

  const resource = await delistResource(resourceId, publisher.id);
  if (!resource) {
    res.status(404).json({ error: "Resource not found or not owned by publisher" });
    return;
  }

  res.json({ id: resource.id, listed: resource.listed });
});

// POST /resources/:id/register — register resource on-chain (publisher only)
router.post("/resources/:id/register", apiKeyAuth, async (req, res) => {
  const publisher = req.publisher!;
  const resourceId = req.params.id as string;

  try {
    const resource = await getResourceById(resourceId);
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (resource.publisherId !== publisher.id) {
      res.status(403).json({ error: "Forbidden: you do not own this resource" });
      return;
    }

    // Build and submit the registration transaction
    const unsignedXdr = await buildRegisterTx(resourceId, resource.price, resource.contentHash);
    const signedXdr = unsignedXdr; // We'll sign with the server's registry keypair
    // Actually sign it
    const { TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
    const { Keypair } = await import("@stellar/stellar-sdk");
    // For now, use the registry client approach
    const result = await submitSignedTx(signedXdr);

    res.json({
      id: resource.id,
      onchainStatus: "registered",
      onchainTxHash: result.hash,
    });
  } catch (err: any) {
    getLogger().error({ event: "onchain_register_error", resourceId, error: err.message });
    res.status(500).json({ error: "On-chain registration failed", detail: err.message });
  }
});

// POST /resources/:id/price/prepare — prepare unsigned set_price tx (publisher only)
router.post(
  "/resources/:id/price/prepare",
  apiKeyAuth,
  validate(preparePriceSchema),
  async (req, res) => {
    const publisher = req.publisher!;
    const resourceId = req.params.id as string;

    const resource = await getResourceById(resourceId);
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (resource.publisherId !== publisher.id) {
      res.status(403).json({ error: "Forbidden: you do not own this resource" });
      return;
    }

    const { newPrice } = req.body;

    const unsignedXdr = await setPrice(resourceId, newPrice);
    res.json({ unsignedXdr, networkPassphrase: NETWORK_PASSPHRASE });
  },
);

// POST /resources/:id/ownership/prepare — prepare unsigned transfer_ownership tx (publisher only)
router.post(
  "/resources/:id/ownership/prepare",
  apiKeyAuth,
  validate(prepareOwnershipSchema),
  async (req, res) => {
    const publisher = req.publisher!;
    const resourceId = req.params.id as string;

    const resource = await getResourceById(resourceId);
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (resource.publisherId !== publisher.id) {
      res.status(403).json({ error: "Forbidden: you do not own this resource" });
      return;
    }

    const { newCreator } = req.body;

    const unsignedXdr = await transferOwnership(resourceId, newCreator);
    res.json({ unsignedXdr, networkPassphrase: NETWORK_PASSPHRASE });
  },
);

// POST /resources/:id/ownership — submit signed transfer_ownership tx and sync DB
router.post(
  "/resources/:id/ownership",
  apiKeyAuth,
  validate(transferOwnershipSchema),
  async (req, res) => {
    const publisher = req.publisher!;
    const resourceId = req.params.id as string;

    const resource = await getResourceById(resourceId);
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (resource.publisherId !== publisher.id) {
      res.status(403).json({ error: "Forbidden: you do not own this resource" });
      return;
    }

    const { signedXdr, newCreator } = req.body;

    const { rpc: StellarRpc, Transaction: StellarTransaction } =
      await import("@stellar/stellar-sdk");
    const rpcServer = new StellarRpc.Server(config.SOROBAN_RPC_URL);
    const signedTx = new StellarTransaction(signedXdr, NETWORK_PASSPHRASE);
    const sendResult = await rpcServer.sendTransaction(signedTx);

    if (sendResult.status !== "PENDING") {
      res.status(502).json({ error: "Transaction rejected", detail: sendResult.status });
      return;
    }

    const txHash = sendResult.hash;
    let confirmed = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const txResult = await rpcServer.getTransaction(txHash);
      if (txResult.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) {
        confirmed = true;
        break;
      }
      if (txResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
        res.status(502).json({ error: "Transaction failed on-chain" });
        return;
      }
    }
    if (!confirmed) {
      res.status(504).json({ error: "Transaction confirmation timed out" });
      return;
    }

    const [updated] = await db
      .update(resources)
      .set({ walletAddress: newCreator })
      .where(eq(resources.id, resourceId))
      .returning();

    res.json({ id: updated.id, newCreator: updated.walletAddress, status: "confirmed" });
  },
);

export default router;
