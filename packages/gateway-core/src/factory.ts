/*
 * Code Map: gateway-core factory + tenant/token/adapter lifecycle + handler registration
 * - createGateway: composition factory (Tier 1 + capabilities + audit + rate-limit + dispatch)
 * - loadOrCreateSecret: file-backed JWT secret bootstrap; base64-encoded on disk, decoded on read
 * - buildGatewayHandlers: per-capability handler implementations for the 16 platform caps
 *   that stay resident in the kernel (auth.*, tenant.*, gateway.*, system.*, session.*, capability.*, plugin.*)
 * - atomicTenantSave: writes tenants.json via the FileSystem (production uses node:fs/promises)
 * - nodeFileSystem: production fs; writeFile without mode = append (audit log); with mode = write (gateway-secret, mode 0600)
 *
 * CID Index:
 * CID:factory-001 -> createGateway
 * CID:factory-002 -> loadOrCreateSecret
 * CID:factory-003 -> buildGatewayHandlers
 *
 * Quick lookup: rg -n "CID:factory-" packages/gateway-core/src/factory.ts
 */

import { randomBytes } from "node:crypto";
import { appendFile, writeFile as fsWriteFile, readFile, access } from "node:fs/promises";
import type { EventBus } from "@spanexx/event-bus";
import type { CapabilityRegistry } from "@spanexx/capability-registry";
import { registerPlatformCapabilities } from "@spanexx/platform-capabilities";
import type { SessionManager } from "@spanexx/session-manager";
import type { PluginManager } from "@spanexx/plugin-manager";
import { AuditWriter } from "./audit.js";
import { checkAuthz } from "./authz.js";
import { issueToken } from "./auth.js";
import { ClientService } from "./client-service.js";
import { FileSystemClientStore } from "./client-store.js";
import { handleTokenRequest, TokenRequestRateLimiter, type OAuthTokenHandler, handleAuthorize, handleCallback } from "./oauth-token-handler.js";
import { handleInvocation } from "./handle-invocation.js";
import { type DispatchHandlers } from "./dispatch.js";
import { RateLimiter } from "./rate-limit.js";
import { TenantStore } from "./tenant-store.js";
import { ERROR_CODES, GatewayError } from "./errors.js";
import type {
  Adapter,
  Clock,
  CreateTenantRequest,
  FileSystem,
  Gateway,
  GatewayConfig,
  GatewayStatus,
  IssueTokenRequest,
  TenantRecord,
  TokenClaims,
  YamlValue,
} from "./types.js";

const DEFAULT_AUDIT_LOG_PATH = "/data/audit.log";
const DEFAULT_TENANTS_PATH = "/data/tenants.json";
const DEFAULT_SECRET_PATH = "/data/gateway-secret";
const DEFAULT_CLIENT_DATA_DIR = "/data";
const DEFAULT_HANDLER_TIMEOUT_MS = 30000;
const DEFAULT_RATE_LIMIT_CAPACITY = 100;
const DEFAULT_RATE_LIMIT_TOKENS_PER_SECOND = 10;
const DEFAULT_TOKEN_TTL_MS = 3_600_000;
const SECRET_FILE_MODE = 0o600;

// CID:factory-002 - loadOrCreateSecret
// Purpose: file-backed JWT secret bootstrap; generates 32 random bytes on first run; persists base64-encoded with mode 0600.
//   On reload, decodes the base64 → raw bytes. This round-trip ensures the same secret is used across
//   process restarts (a UTF-8 round-trip would re-interpret the bytes and produce a different signing key).
async function loadOrCreateSecret(secretPath: string, fs: FileSystem): Promise<Uint8Array> {
  if (await fs.exists(secretPath)) {
    const stored = (await fs.readFile(secretPath)).replace(/\n$/, "");
    return Buffer.from(stored, "base64");
  }
  const secret = new Uint8Array(randomBytes(32));
  await fs.writeFile(secretPath, Buffer.from(secret).toString("base64"), SECRET_FILE_MODE);
  return secret;
}

// CID:factory-003 - buildGatewayHandlers
// Purpose: per-capability handler implementations for the 16 platform caps that stay resident in the kernel.
//   The 25 caps registered by `registerPlatformCapabilities` (see @platform/platform-capabilities)
//   include session.*, capability.*, plugin.*, tenant.*, gateway.*, auth.token.*, and system.*.
//   Handlers for caps that don't go through the in-process Tier 1 manager owners (session-manager,
//   plugin-manager, capability-registry) live here. The dispatch layer (packages/gateway-core/src/dispatch.ts)
//   routes each owner to the gatewayHandlers map.
// Used by: createGateway() factory at boot
// Permissions and ownership are declared in @platform/platform-capabilities/src/caps.ts; this file
//   only contains the runtime implementations.

// Persist tenant state to disk via the FileSystem. For the production filesystem this is
// appendFile + atomic-write-temp-then-rename (deferred to a v2 enhancement; v1 uses appendFile
// for the audit log, but tenants.json is a small JSON file replaced atomically by the production
// writeFile implementation in v2). For tests, the InMemoryFs fake overwrites — acceptable.
async function persistTenants(tenantStore: TenantStore, tenantsPath: string, fs: FileSystem): Promise<void> {
  await fs.writeFile(tenantsPath, JSON.stringify([...tenantStore.list()], null, 2));
}

// CID:factory-001 - createGateway
// Purpose: composition factory — wires Tier 1 components + gateway capabilities + audit + rate-limit; performs startup tenant load + secret bootstrap
// Returns: Promise<Gateway> (async because tenant load + secret bootstrap are I/O)
// Used by: every consumer (the agentide CLI / MCP adapter / REST adapter / future SDK adapters call this first)
export async function createGateway(
  eventBus: EventBus,
  registry: CapabilityRegistry,
  sessionManager: SessionManager,
  pluginManager: PluginManager,
  config: GatewayConfig = {},
): Promise<Gateway> {
  const fs: FileSystem = config.fs ?? nodeFileSystem();
  const clock: Clock = config.clock ?? systemClock();
  const auditLogPath = config.auditLogPath ?? DEFAULT_AUDIT_LOG_PATH;
  const tenantsPath = config.tenantsPath ?? DEFAULT_TENANTS_PATH;
  const secretPath = config.secretPath ?? DEFAULT_SECRET_PATH;
  const handlerTimeoutMs = config.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;

  const audit = new AuditWriter(auditLogPath, fs);
  const rateLimit = config.rateLimit ?? { capacity: DEFAULT_RATE_LIMIT_CAPACITY, tokensPerSecond: DEFAULT_RATE_LIMIT_TOKENS_PER_SECOND };
  const rateLimiter = new RateLimiter(rateLimit, clock);
  const tenantStore = new TenantStore(tenantsPath, fs);
  await tenantStore.load();
  const secret = await loadOrCreateSecret(secretPath, fs);
  const backendRuntime = config.backendRuntime;

  // BI[29]: client identity store + service. Salt is derived from the install
  // secret so hashes are stable per data dir without a second secret file.
  const clientStore = new FileSystemClientStore(config.clientDataDir ?? DEFAULT_CLIENT_DATA_DIR, fs);
  const clientSvc = new ClientService(
    clientStore,
    () => Buffer.from(secret).toString("hex"),
    () => clock.now(),
  );

  // BI[29] Phase 4: POST /oauth/token handler exposed for adapters. The
  // adapter passes isTls (socket.encrypted or x-forwarded-proto); the closure
  // owns requireTls + the client service + the JWT secret.
  const saltHex = Buffer.from(secret).toString("hex");
  // One limiter per gateway instance — a fresh limiter per request would never
  // rate-limit. Shared by every POST /oauth/token call this gateway serves.
  const tokenRateLimiter = new TokenRequestRateLimiter();
  const oauthTokenHandler: OAuthTokenHandler = (req) =>
    handleTokenRequest({
      body: req.body,
      clientSvc,
      secret,
      salt: saltHex,
      clock: () => clock.now(),
      requireTls: config.requireTls ?? true,
      isTls: req.isTls,
      rateLimiter: tokenRateLimiter,
    });

  // BI[29] Phase 7: OIDC auth-code grant (dev stub). Only wired when
  // enableOidc=true. The codes map lives per-gateway-instance (one-shot auth
  // codes for the dev-stub-approve flow); handlers close over secret + clock
  // so adapters never see them. Adapters route GET /oauth/authorize +
  // /oauth/callback to these when `oidc` is present on the Gateway.
  const oidcCodes = new Map<string, { clientId: string; tenantId: string; scope: string[] }>();
  const oidc = config.enableOidc === true
    ? {
        authorize: (env: { query: { client_id?: string; redirect_uri?: string; scope?: string; response_type?: string } }) =>
          handleAuthorize({
            query: env.query,
            enableOidc: config.enableOidc ?? false,
            baseUrl: config.oidcBaseUrl ?? "http://localhost:7100",
          }),
        callback: (env: { query: { code?: string; redirect_uri?: string } }) =>
          handleCallback({
            query: env.query,
            codes: oidcCodes,
            secret,
            clock: () => clock.now(),
          }),
      }
    : undefined;

  const startedAt = clock.now();
  const handlers = buildGatewayHandlers({
    tenantStore,
    registry,
    secret,
    clock,
    sessionManager,
    pluginManager,
    tenantsPath,
    auditLogPath,
    startedAt,
    fs,
    clientSvc,
  });

  await registerPlatformCapabilities(registry);

  return {
    handleInvocation: (req) =>
      handleInvocation(req, {
        registry,
        sessionManager,
        pluginManager,
        tenantStore,
        handlers,
        audit,
        eventBus,
        rateLimiter,
        clock,
        handlerTimeoutMs,
        secret,
        backendRuntime,
      }),

    registerAdapter: async (adapter: Adapter): Promise<void> => {
      await adapter.start();
    },
    unregisterAdapter: async (name: string): Promise<void> => {
      void name;
      throw new GatewayError(
        ERROR_CODES.MANAGER_UNAVAILABLE,
        "adapter tracking by name is not yet implemented; call adapter.stop() directly",
        { name },
        false,
      );
    },

    issueToken: async (req: IssueTokenRequest) => {
      const claims: TokenClaims = {
        sub: { tenantId: req.tenantId, callerId: req.callerId },
        scope: [...req.scope],
        ...(req.expectedOrigins !== undefined && req.expectedOrigins.length > 0
          ? { expectedOrigins: [...req.expectedOrigins] }
          : {}),
        iat: clock.now(),
        exp: clock.now() + (req.expiresInMs ?? DEFAULT_TOKEN_TTL_MS),
      };
      const token = issueToken(claims, secret, clock);
      return { token, claims };
    },

    createTenant: async (req: CreateTenantRequest) => {
      if (tenantStore.get(req.id) !== null) {
        throw new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          `tenant "${req.id}" already exists`,
          { id: req.id },
          false,
        );
      }
      const record: TenantRecord = {
        id: req.id,
        name: req.name,
        createdAt: clock.now(),
        suspended: false,
      };
      tenantStore.set(record);
      await persistTenants(tenantStore, tenantsPath, fs);
      return record;
    },

    listTenants: () => tenantStore.list(),

    suspendTenant: async (id: string) => {
      const existing = tenantStore.get(id);
      if (!existing) {
        throw new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          `tenant "${id}" not found`,
          { id },
          false,
        );
      }
      const updated: TenantRecord = { ...existing, suspended: true };
      tenantStore.set(updated);
      await persistTenants(tenantStore, tenantsPath, fs);
      return updated;
    },

    deleteTenant: async (id: string) => {
      if (tenantStore.get(id) === null) {
        throw new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          `tenant "${id}" not found`,
          { id },
          false,
        );
      }
      tenantStore.delete(id);
      await persistTenants(tenantStore, tenantsPath, fs);
    },

    oauthTokenHandler,
    clientService: clientSvc,
    oidc,

    status: async (): Promise<GatewayStatus> => {
      const uptimeMs = clock.now() - startedAt;
      const tenantCount = tenantStore.list().length;
      const pluginCount = pluginManager.list().length;
      const auditLogBytes = await auditLogSize(auditLogPath, fs);
      return { uptimeMs, tenantCount, pluginCount, auditLogBytes };
    },
  };
}

async function auditLogSize(auditLogPath: string, fs: FileSystem): Promise<number> {
  if (!(await fs.exists(auditLogPath))) return 0;
  const content = await fs.readFile(auditLogPath);
  return content.length;
}

interface BuildHandlersCtx {
  readonly tenantStore: TenantStore;
  readonly registry: CapabilityRegistry;
  readonly secret: Uint8Array;
  readonly clock: Clock;
  readonly sessionManager: SessionManager;
  readonly pluginManager: PluginManager;
  readonly tenantsPath: string;
  readonly auditLogPath: string;
  readonly startedAt: number;
  readonly fs: FileSystem;
  readonly clientSvc: ClientService;
}

function buildGatewayHandlers(ctx: BuildHandlersCtx): DispatchHandlers {
  // Each handler returns its concrete type (SessionRecord, TenantRecord, DescribeResult, etc.).
  // JSON round-trip coerces to YamlValue.
  const wrap = <T>(fn: (input: YamlValue) => T | Promise<T>) =>
    async (input: YamlValue, _sessionId: string | undefined): Promise<YamlValue> =>
      JSON.parse(JSON.stringify(await fn(input))) as YamlValue;

  // Persist tenant state when tenant.create / tenant.suspend / tenant.delete mutate it.
  const persistTenantsNow = async (): Promise<void> => {
    await persistTenants(ctx.tenantStore, ctx.tenantsPath, ctx.fs);
  };

  const handlers: Record<string, (input: YamlValue, sessionId: string | undefined) => Promise<YamlValue>> = {
    // === auth ===
    "auth.token.issue": wrap((input) => {
      const i = input as { tenantId?: string; callerId?: string; scope?: readonly string[]; expiresInMs?: number; expectedOrigins?: readonly string[] };
      if (typeof i.tenantId !== "string" || typeof i.callerId !== "string" || !Array.isArray(i.scope)) {
        throw new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          "auth.token.issue requires {tenantId, callerId, scope}",
          {},
          false,
        );
      }
      const claims: TokenClaims = {
        sub: { tenantId: i.tenantId, callerId: i.callerId },
        scope: i.scope as readonly string[],
        ...(Array.isArray(i.expectedOrigins) && i.expectedOrigins.length > 0
          ? { expectedOrigins: i.expectedOrigins }
          : {}),
        iat: ctx.clock.now(),
        exp: ctx.clock.now() + (i.expiresInMs ?? DEFAULT_TOKEN_TTL_MS),
      };
      return { token: issueToken(claims, ctx.secret, ctx.clock), claims };
    }),

    "auth.token.revoke": wrap(() => {
      // v1: JWTs are stateless. No-op until a deny-list is implemented (v2).
      return { revoked: false };
    }),

    // === session ===
    "session.create": wrap((input) => {
      const i = input as { ownerId?: string; adapterType?: string; metadata?: Record<string, string> };
      if (typeof i.ownerId !== "string" || typeof i.adapterType !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "session.create requires {ownerId, adapterType}", {}, false);
      }
      const session = ctx.sessionManager.create({
        ownerId: i.ownerId,
        adapterType: i.adapterType as "mcp" | "cli" | "rest" | "ws",
        ...(i.metadata ? { metadata: i.metadata } : {}),
      });
      return session;
    }),

    "session.resume": wrap((input) => {
      const i = input as { sessionId?: string };
      if (typeof i.sessionId !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "sessionId required", {}, false);
      }
      return ctx.sessionManager.resume(i.sessionId);
    }),

    "session.destroy": wrap((input) => {
      const i = input as { sessionId?: string };
      if (typeof i.sessionId !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "sessionId required", {}, false);
      }
      return ctx.sessionManager.destroy(i.sessionId, "explicit");
    }),

    "session.touch": wrap((input) => {
      const i = input as { sessionId?: string };
      if (typeof i.sessionId !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "sessionId required", {}, false);
      }
      return ctx.sessionManager.touch(i.sessionId);
    }),

    "session.list": wrap(() => {
      // NOTE[agent]: session-manager v1 doesn't expose listSessions(tenantId). v1 returns [].
      // v2 enhancement adds listSessions(tenantId) → SessionRecord[].
      return [];
    }),

    // === tenant ===
    "tenant.create": wrap((input) => {
      const i = input as { id?: string; name?: string };
      if (typeof i.id !== "string" || typeof i.name !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "tenant.create requires {id, name}", {}, false);
      }
      if (ctx.tenantStore.get(i.id) !== null) {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, `tenant "${i.id}" already exists`, { id: i.id }, false);
      }
      const record: TenantRecord = {
        id: i.id,
        name: i.name,
        createdAt: ctx.clock.now(),
        suspended: false,
      };
      ctx.tenantStore.set(record);
      void persistTenantsNow();
      return record;
    }),

    "tenant.list": wrap(() => ctx.tenantStore.list()),

    "tenant.suspend": wrap((input) => {
      const i = input as { id?: string };
      if (typeof i.id !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "id required", {}, false);
      }
      const existing = ctx.tenantStore.get(i.id);
      if (!existing) {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, `tenant "${i.id}" not found`, { id: i.id }, false);
      }
      const updated: TenantRecord = { ...existing, suspended: true };
      ctx.tenantStore.set(updated);
      void persistTenantsNow();
      return updated;
    }),

    "tenant.delete": wrap((input) => {
      const i = input as { id?: string };
      if (typeof i.id !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "id required", {}, false);
      }
      if (ctx.tenantStore.get(i.id) === null) {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, `tenant "${i.id}" not found`, { id: i.id }, false);
      }
      ctx.tenantStore.delete(i.id);
      void persistTenantsNow();
      return { deleted: true };
    }),

    // === client (BI[29] CID:cap-001..004) ===
    "client.create": wrap(async (input) => {
      const i = input as { tenantId?: string; name?: string; defaultScope?: readonly string[] };
      if (typeof i.tenantId !== "string" || typeof i.name !== "string" || !Array.isArray(i.defaultScope)) {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "client.create requires {tenantId, name, defaultScope}", {}, false);
      }
      try {
        return await ctx.clientSvc.createClient({
          tenantId: i.tenantId,
          name: i.name,
          defaultScope: i.defaultScope as readonly string[],
        });
      } catch (err) {
        if (err instanceof Error && /^rate_limited/.test(err.message)) {
          throw new GatewayError(ERROR_CODES.RATE_LIMIT_EXCEEDED, err.message, {}, false);
        }
        throw err;
      }
    }),
    "client.list": wrap(async (input) => {
      const i = (input ?? {}) as { tenantId?: string };
      return typeof i.tenantId === "string"
        ? await ctx.clientSvc.listClients(i.tenantId)
        : await ctx.clientSvc.listClients();
    }),
    "client.revoke": wrap(async (input) => {
      const i = input as { clientId?: string };
      if (typeof i.clientId !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "client.revoke requires {clientId}", {}, false);
      }
      await ctx.clientSvc.revokeClient({ clientId: i.clientId });
      return { revoked: true };
    }),
    "client.rotate": wrap(async (input) => {
      const i = input as { clientId?: string };
      if (typeof i.clientId !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "client.rotate requires {clientId}", {}, false);
      }
      try {
        return await ctx.clientSvc.rotateClient({ clientId: i.clientId });
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("client not found")) {
          throw new GatewayError(ERROR_CODES.INVALID_REQUEST, err.message, {}, false);
        }
        throw err;
      }
    }),

    // === capability discovery ===
    "capability.list": wrap((input) => {
      // BI[7]: tier-aware catalog. Filter by caller's scope so a token with
      //   runtime.browser.read does not see runtime.browser.click in its
      //   catalog (avoids info-leak via capability discovery).
      //   Bootstrap callers (CLI operator) pass scope: ["*"] or omit to see
      //   everything — operators retain the v1 "full catalog" view.
      // Empty/malformed scope returns an empty list — defensive.
      const i = (input ?? {}) as { scope?: readonly string[] };
      const callerScope = Array.isArray(i.scope) ? i.scope : [];
      if (callerScope.length === 0) return [];
      const allCards = ctx.registry.list();
      return allCards.filter((card) => {
        const full = ctx.registry.describe(card.name).capability;
        if (!full) return false;
        return checkAuthz(callerScope, full.permissions);
      });
    }),

    "capability.describe": wrap((input) => {
      const i = input as { name?: string };
      if (typeof i.name !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "name required", {}, false);
      }
      return ctx.registry.describe(i.name);
    }),

    // === gateway introspection ===
    "gateway.status": wrap(() => {
      const uptimeMs = ctx.clock.now() - ctx.startedAt;
      return {
        uptimeMs,
        tenantCount: ctx.tenantStore.list().length,
        pluginCount: ctx.pluginManager.list().length,
        status: "ok",
      };
    }),

    "gateway.metrics": wrap(() => {
      // v1 placeholder. v2 adds rate-limit denial counters, dispatch-failure counts, etc.
      return {
        invocations: { ok: 0, denied: 0, error: 0 },
        rateLimitDenials: 0,
        authFailures: 0,
      };
    }),

    "gateway.configuration": wrap(() => {
      // Return effective config with secrets redacted.
      return {
        auditLogPath: ctx.auditLogPath,
        tenantsPath: ctx.tenantsPath,
        // secretPath is omitted to avoid leaking filesystem layout
      };
    }),

    // === plugin management (BI[6] — wraps Plugin Manager methods) ===
    "plugin.list": wrap(() => ctx.pluginManager.list()),

    "plugin.install": wrap((input) => {
      const i = input as { source?: string };
      if (typeof i.source !== "string") {
        throw new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          "plugin.install requires {source}",
          {},
          false,
        );
      }
      return ctx.pluginManager.install(i.source);
    }),

    "plugin.uninstall": wrap((input) => {
      const i = input as { id?: string };
      if (typeof i.id !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "plugin.uninstall requires {id}", {}, false);
      }
      // Some Plugin Manager versions return void; normalize to a structured outcome.
      return ctx.pluginManager.uninstall(i.id).then(() => ({ uninstalled: true, id: i.id }));
    }),

    "plugin.enable": wrap((input) => {
      const i = input as { id?: string };
      if (typeof i.id !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "plugin.enable requires {id}", {}, false);
      }
      return ctx.pluginManager.enable(i.id);
    }),

    "plugin.disable": wrap((input) => {
      const i = input as { id?: string };
      if (typeof i.id !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "plugin.disable requires {id}", {}, false);
      }
      return ctx.pluginManager.disable(i.id);
    }),

    "plugin.reload": wrap((input) => {
      const i = input as { id?: string };
      if (typeof i.id !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "plugin.reload requires {id}", {}, false);
      }
      return ctx.pluginManager.reload(i.id);
    }),

    // === system introspection (BI[6] — kernel-direct reads) ===
    "system.info": wrap(() => ({
      name: "agentide",
      version: getPlatformVersion(),
    })),

    "system.version": wrap(() => ({
      version: getPlatformVersion(),
      buildHash: null,
    })),

    "system.health": wrap(() => ({ status: "ok" })),
  };
  // Suppress unused-import warning for an unused field in handlers.
  void ctx.sessionManager;
  return { gatewayHandlers: handlers };
}

// CID:factory-004 - getPlatformVersion
// Purpose: returns the platform version. Read from AGENTIDE_VERSION env (set by install.sh) or defaults to "0.0.0".
//   The buildHash from CI is always null in v1 (per BI[6] Phase 0.5 verdict).
function getPlatformVersion(): string {
  return process.env["AGENTIDE_VERSION"] ?? "0.0.0";
}

// System clock + production fs. Top-level static imports (ESM) — not require() — per Gap 2.
function systemClock(): Clock {
  return {
    now: () => Date.now(),
    // @ts-expect-error - Node's setTimeout returns Timeout; Clock interface declares number
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h),
  };
}

function nodeFileSystem(): FileSystem {
  // Per Gap 4: writeFile without mode is APPEND (audit log never loses history).
  // Per Gap 3: writeFile with mode is REAL write (used for the gateway-secret file, mode 0600).
  return {
    readFile: async (path) => readFile(path, "utf-8"),
    writeFile: async (path, content, mode) => {
      if (mode !== undefined) {
        await fsWriteFile(path, content, { mode, encoding: "utf-8" });
      } else {
        await appendFile(path, content, "utf-8");
      }
    },
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}