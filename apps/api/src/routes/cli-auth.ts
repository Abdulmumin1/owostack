import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { schema } from "@owostack/db";
import type { Env, Variables } from "../index";
import { auth } from "../lib/auth";
import { generateApiKey, hashApiKey } from "../lib/api-keys";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Security Configuration
const CONFIG = {
  CODE_EXPIRY_MS: 5 * 60 * 1000,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: 5,
  MAX_GENERATION_ATTEMPTS: 10,
  KV_PREFIX_DEVICE: "cli:device:",
  KV_PREFIX_USER_CODE: "cli:user:",
  KV_PREFIX_RATE_LIMIT: "cli:ratelimit:",
  KV_PREFIX_AUDIT: "cli:audit:",
};

// In-Memory Storage
interface DeviceCodeRecord {
  userCode: string;
  deviceCode: string;
  organizationId?: string;
  apiKey?: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  createdAt: number;
  expiresAt: number;
  clientIp?: string;
  userAgent?: string;
  approvedBy?: string;
  approvedAt?: number;
  deniedBy?: string;
  deniedAt?: number;
  pollCount: number;
  lastPollAt?: number;
}

// Helper Functions
function generateSecureCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const result: string[] = [];
  for (let i = 0; i < length; i++) {
    const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
    result.push(chars[randomByte % chars.length]);
  }
  return result.join("");
}

function getClientIp(c: any): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

// KV-based storage functions
async function kvStoreDeviceCode(
  kv: KVNamespace,
  record: DeviceCodeRecord,
): Promise<void> {
  const ttl = Math.ceil((record.expiresAt - Date.now()) / 1000);
  await kv.put(
    CONFIG.KV_PREFIX_DEVICE + record.deviceCode,
    JSON.stringify(record),
    { expirationTtl: ttl },
  );
  await kv.put(
    CONFIG.KV_PREFIX_USER_CODE + record.userCode,
    record.deviceCode,
    { expirationTtl: ttl },
  );
}

async function kvGetDeviceCode(
  kv: KVNamespace,
  deviceCode: string,
): Promise<DeviceCodeRecord | null> {
  const data = await kv.get(CONFIG.KV_PREFIX_DEVICE + deviceCode);
  return data ? JSON.parse(data) : null;
}

async function kvGetDeviceCodeByUserCode(
  kv: KVNamespace,
  userCode: string,
): Promise<{ deviceCode: string; record: DeviceCodeRecord } | null> {
  const deviceCode = await kv.get(CONFIG.KV_PREFIX_USER_CODE + userCode);
  if (!deviceCode) return null;
  const record = await kvGetDeviceCode(kv, deviceCode);
  if (!record) {
    await kv.delete(CONFIG.KV_PREFIX_USER_CODE + userCode);
    return null;
  }
  return { deviceCode, record };
}

async function kvDeleteDeviceCode(
  kv: KVNamespace,
  deviceCode: string,
  userCode: string,
): Promise<void> {
  await kv.delete(CONFIG.KV_PREFIX_DEVICE + deviceCode);
  await kv.delete(CONFIG.KV_PREFIX_USER_CODE + userCode);
}

async function kvUpdateDeviceCode(
  kv: KVNamespace,
  record: DeviceCodeRecord,
): Promise<void> {
  const ttl = Math.ceil((record.expiresAt - Date.now()) / 1000);
  if (ttl > 0) {
    await kv.put(
      CONFIG.KV_PREFIX_DEVICE + record.deviceCode,
      JSON.stringify(record),
      { expirationTtl: ttl },
    );
  }
}

async function kvCheckRateLimit(
  kv: KVNamespace,
  ip: string,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const key = CONFIG.KV_PREFIX_RATE_LIMIT + ip;
  const now = Date.now();
  const existing = await kv.get(key);
  let record: { count: number; windowStart: number };

  if (existing) {
    record = JSON.parse(existing);
    if (now - record.windowStart > CONFIG.RATE_LIMIT_WINDOW_MS) {
      record = { count: 1, windowStart: now };
      await kv.put(key, JSON.stringify(record), {
        expirationTtl: Math.ceil(CONFIG.RATE_LIMIT_WINDOW_MS / 1000),
      });
      return { allowed: true, remaining: CONFIG.RATE_LIMIT_MAX_REQUESTS - 1 };
    }
    if (record.count >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil(
          (record.windowStart + CONFIG.RATE_LIMIT_WINDOW_MS - now) / 1000,
        ),
      };
    }
    record.count++;
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.ceil(
        (record.windowStart + CONFIG.RATE_LIMIT_WINDOW_MS - now) / 1000,
      ),
    });
    return {
      allowed: true,
      remaining: CONFIG.RATE_LIMIT_MAX_REQUESTS - record.count,
    };
  } else {
    record = { count: 1, windowStart: now };
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.ceil(CONFIG.RATE_LIMIT_WINDOW_MS / 1000),
    });
    return { allowed: true, remaining: CONFIG.RATE_LIMIT_MAX_REQUESTS - 1 };
  }
}

async function kvLogAudit(
  kv: KVNamespace,
  event: string,
  record: DeviceCodeRecord,
  details?: string,
  userId?: string,
): Promise<void> {
  const entry = {
    timestamp: Date.now(),
    event,
    deviceCode: record.deviceCode,
    userCode: record.userCode,
    ip: record.clientIp,
    userId,
    organizationId: record.organizationId,
    details,
  };
  const auditKey = `${CONFIG.KV_PREFIX_AUDIT}${Date.now()}:${record.deviceCode}`;
  await kv.put(auditKey, JSON.stringify(entry), {
    expirationTtl: 30 * 24 * 60 * 60,
  });
  console.log(
    `[CLI-AUTH] ${event} | Code: ${record.userCode} | IP: ${record.clientIp} | ${details || ""}`,
  );
}

// POST /auth/cli/device
app.post("/device", async (c) => {
  const kv = c.env.CACHE_SHARED;
  const clientIp = getClientIp(c);
  const userAgent = c.req.header("user-agent");

  // Check rate limit using KV
  const rateLimit = await kvCheckRateLimit(kv, clientIp);
  if (!rateLimit.allowed) {
    return c.json(
      {
        success: false,
        error: "Rate limit exceeded. Please try again later.",
        retryAfter: rateLimit.retryAfter,
      },
      429,
    );
  }

  // Generate unique user code
  const userCode = generateSecureCode(8);
  const formattedCode = `${userCode.slice(0, 4)}-${userCode.slice(4)}`;

  const deviceCode = crypto.randomUUID();
  const now = Date.now();

  const record: DeviceCodeRecord = {
    deviceCode,
    userCode: formattedCode,
    status: "pending",
    createdAt: now,
    expiresAt: now + CONFIG.CODE_EXPIRY_MS,
    clientIp,
    userAgent,
    pollCount: 0,
  };

  await kvStoreDeviceCode(kv, record);
  await kvLogAudit(kv, "DEVICE_FLOW_INITIATED", record);

  return c.json({
    success: true,
    deviceCode,
    userCode: formattedCode,
    expiresIn: Math.floor(CONFIG.CODE_EXPIRY_MS / 1000),
  });
});

// GET /auth/cli/token
app.get("/token", async (c) => {
  const kv = c.env.CACHE_SHARED;
  const deviceCode = c.req.query("deviceCode");

  if (!deviceCode) {
    return c.json({ success: false, error: "deviceCode required" }, 400);
  }

  const record = await kvGetDeviceCode(kv, deviceCode);
  if (!record) {
    return c.json({ success: false, error: "invalid_code" }, 400);
  }

  if (Date.now() > record.expiresAt) {
    await kvDeleteDeviceCode(kv, deviceCode, record.userCode);
    await kvLogAudit(kv, "CODE_EXPIRED", record, "Token polling after expiry");
    return c.json({ success: false, error: "expired" }, 400);
  }

  record.pollCount++;
  record.lastPollAt = Date.now();

  // Rate limit polling (max 60 requests per minute)
  if (record.pollCount > 60) {
    const timeWindow = Date.now() - record.createdAt;
    if (timeWindow < 60000) {
      return c.json({ success: false, error: "polling_rate_limited" }, 429);
    }
  }

  await kvUpdateDeviceCode(kv, record);

  if (record.status === "denied") {
    await kvDeleteDeviceCode(kv, deviceCode, record.userCode);
    await kvLogAudit(
      kv,
      "CODE_DENIED_CONSUMED",
      record,
      "Token polling after deny",
    );
    return c.json({ success: false, error: "denied" }, 403);
  }

  if (record.status === "approved" && record.apiKey) {
    await kvDeleteDeviceCode(kv, deviceCode, record.userCode);
    await kvLogAudit(kv, "TOKEN_ISSUED", record, "API key issued to CLI");

    return c.json({
      success: true,
      apiKey: record.apiKey,
      organizationId: record.organizationId,
    });
  }

  return c.json({ success: false, status: "pending" }, 202);
});

// POST /auth/cli/approve
app.post("/approve", async (c) => {
  const kv = c.env.CACHE_SHARED;
  const body = await c.req.json();
  const { userCode, organizationId } = body;

  if (!userCode || !organizationId) {
    return c.json(
      { success: false, error: "userCode and organizationId required" },
      400,
    );
  }

  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) {
    return c.json({ success: false, error: "Invalid code format" }, 400);
  }

  const lookup = await kvGetDeviceCodeByUserCode(kv, userCode);
  if (!lookup) {
    return c.json({ success: false, error: "Invalid or expired code" }, 400);
  }

  const { deviceCode, record } = lookup;

  if (Date.now() > record.expiresAt) {
    await kvDeleteDeviceCode(kv, deviceCode, userCode);
    await kvLogAudit(kv, "APPROVE_ATTEMPT_EXPIRED", record);
    return c.json({ success: false, error: "Code expired" }, 400);
  }

  if (record.status !== "pending") {
    return c.json(
      { success: false, error: `Code already ${record.status}` },
      400,
    );
  }

  // Verify session
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const userId = session.user.id;
  const authDb = c.get("authDb");

  // Verify organization membership
  const membership = await authDb.query.members.findFirst({
    where: and(
      eq(schema.members.userId, userId),
      eq(schema.members.organizationId, organizationId),
    ),
  });

  if (!membership) {
    await kvLogAudit(
      kv,
      "APPROVE_UNAUTHORIZED",
      record,
      `User ${userId} not member of org ${organizationId}`,
      userId,
    );
    return c.json(
      { success: false, error: "Not a member of this organization" },
      403,
    );
  }

  // Create API key
  const finalKey = generateApiKey();
  const keyHash = await hashApiKey(finalKey);
  const keyId = crypto.randomUUID();

  try {
    await authDb.insert(schema.apiKeys).values({
      id: keyId,
      organizationId,
      name: `CLI - ${new Date().toISOString()}`,
      prefix: "owo_sk_",
      hash: keyHash,
    });

    record.status = "approved";
    record.apiKey = finalKey;
    record.organizationId = organizationId;
    record.approvedBy = userId;
    record.approvedAt = Date.now();

    await kvUpdateDeviceCode(kv, record);
    await kvLogAudit(
      kv,
      "CODE_APPROVED",
      record,
      `Approved by user ${userId}, key ${keyId}`,
      userId,
    );

    return c.json({ success: true, message: "CLI connected successfully" });
  } catch (e: any) {
    console.error("[CLI-AUTH] Failed to create API key:", e);
    await kvLogAudit(
      kv,
      "APPROVE_FAILED",
      record,
      `Database error: ${e.message}`,
      userId,
    );
    return c.json({ success: false, error: "Failed to create API key" }, 500);
  }
});

// POST /auth/cli/deny
app.post("/deny", async (c) => {
  const kv = c.env.CACHE_SHARED;
  const body = await c.req.json();
  const { userCode } = body;

  if (!userCode) {
    return c.json({ success: false, error: "userCode required" }, 400);
  }

  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) {
    return c.json({ success: false, error: "Invalid code format" }, 400);
  }

  const lookup = await kvGetDeviceCodeByUserCode(kv, userCode);
  if (!lookup) {
    return c.json({ success: false, error: "Invalid or expired code" }, 400);
  }

  const { record } = lookup;

  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  const userId = session?.user?.id;

  record.status = "denied";
  record.deniedBy = userId;
  record.deniedAt = Date.now();

  await kvUpdateDeviceCode(kv, record);
  await kvLogAudit(
    kv,
    "CODE_DENIED",
    record,
    `Denied by user ${userId}`,
    userId,
  );

  return c.json({ success: true });
});

// GET /auth/cli/status
app.get("/status", async (c) => {
  const kv = c.env.CACHE_SHARED;
  const userCode = c.req.query("userCode");

  if (!userCode) {
    return c.json({ success: false, error: "userCode required" }, 400);
  }

  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) {
    return c.json({ success: false, error: "Invalid code format" }, 400);
  }

  const lookup = await kvGetDeviceCodeByUserCode(kv, userCode);
  if (!lookup) {
    return c.json({ success: false, error: "not_found" }, 404);
  }

  const { record } = lookup;

  if (Date.now() > record.expiresAt) {
    await kvDeleteDeviceCode(kv, lookup.deviceCode, userCode);
    return c.json({ success: false, error: "expired" }, 400);
  }

  return c.json({ success: true, status: record.status });
});

export default app;
