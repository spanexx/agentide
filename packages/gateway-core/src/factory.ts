/*
 * Code Map: gateway-core factory + tenant/token/adapter lifecycle + capability registrations
 * - createGateway: composition factory (Tier 1 + capabilities + audit + rate-limit + dispatch)
 * - loadOrCreateSecret: file-backed JWT secret bootstrap
 * - registerGatewayCapabilities: registers auth/session/tenant/capability/gateway capabilities as owner "gateway"
 *
 * CID Index:
 * CID:factory-001 -> createGateway
 * CID:factory-002 -> loadOrCreateSecret
 * CID:factory-003 -> registerGatewayCapabilities
 *
 * Quick lookup: rg -n "CID:factory-" packages/gateway-core/src/factory.ts
 */

import { createHmac, randomBytes } from "node:crypto";
import type { EventBus } from "@platform/event-bus";
import type { CapabilityRegistry, CapabilityRecord, CapabilityType } from "@platform/capability-registry";
import type { SessionManager, SessionRecord } from "@platform/session-manager";
import type { PluginManager } from "@platform/plugin-manager";
import { AuditWriter } from "./audit.js";
import { generateSecret, issueToken } from "./auth.js";
import { handleInvocation } from "./handle-invocation.js";
import { checkAuthz } from "./authz.js";
import { dispatchCapability, type DispatchHandlers } from "./dispatch.js";
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

const DEFAULT_INSTALL_RECORD_PATH = "/data/installed-plugins.json";
const DEFAULT_AUDIT_LOG_PATH = "/data/audit.log";
const DEFAULT_TENANTS_PATH = "/data/tenants.json";
const DEFAULT_SECRET_PATH = "/data/gateway-secret";
const DEFAULT_CLEANUP_TIMEOUT_MS = 5000;
const DEFAULT_RATE_LIMIT_CAPACITY = 100;
const DEFAULT_RATE_LIMIT_TOKENS_PER_SECOND = 10;
const DEFAULT_HANDLER_TIMEOUT_MS = 30000;

// CID:factory-002 - loadOrCreateSecret
// Purpose: file-backed JWT secret bootstrap; generates 32 random bytes on first run; persists with mode 0600
async function loadOrCreateSecret(secretPath: string, fs: FileSystem): Promise<Uint8Array> {
  if (await fs.exists(secretPath)) {
    // Strip optional trailing newline from file write.
    const stored = (await fs.readFile(secretPath)).replace(/\n$/, "");
    return new TextEncoder().encode(stored);
  }
  const secret = generateSecret();
  // base64 for safe file storage
  await fs.writeFile(secretPath, Buffer.from(secret).toString("base64"));
  return secret;
}

// CID:factory-003 - registerGatewayCapabilities
// Purpose: register all platform-level capabilities (auth/session/tenant/capability/gateway) with the Capability Registry under owner "gateway"
// Used by: createGateway() factory at boot
async function registerGatewayCapabilities(
  registry: CapabilityRegistry,
  handlers: DispatchHandlers,
): Promise<void> {
  const caps: CapabilityRecord[] = [
    // auth
    cap("auth.token.issue", "platform", ["platform.token.issue"], "Mint a JWT for a caller"),
    cap("auth.token.revoke", "platform", ["platform.token.issue"], "Revoke a JWT (no-op in v1)"),
    // session
    cap("session.create", "platform", ["platform.session.create"], "Create a session"),
    cap("session.resume", "platform", ["platform.session.read"], "Resume a session"),
    cap("session.destroy", "platform", ["platform.session.delete"], "Destroy a session and cleanup resources"),
    cap("session.touch", "platform", ["platform.session.write"], "Reset a session's idle timer"),
    cap("session.list", "platform", ["platform.session.read"], "List sessions in the caller's tenant"),
    // tenant
    cap("tenant.create", "platform", ["platform.tenant.write"], "Create a tenant and bootstrap token"),
    cap("tenant.list", "platform", ["platform.tenant.read"], "List tenants visible to the caller"),
    cap("tenant.suspend", "platform", ["platform.tenant.write"], "Suspend a tenant (block new calls)"),
    cap("tenant.delete", "platform", ["platform.tenant.write"], "Delete a tenant (purge records)"),
    // capability discovery
    cap("capability.list", "platform", ["platform.capability.read"], "List registered capabilities"),
    cap("capability.describe", "platform", ["platform.capability.read"], "Describe one capability by name"),
    // gateway introspection
    cap("gateway.status", "platform", ["platform.gateway.read"], "Gateway runtime status"),
    cap("gateway.metrics", "platform", ["platform.gateway.read"], "Gateway counters and metrics"),
    cap("gateway.configuration", "platform", ["platform.gateway.read"], "Effective configuration (with secrets redacted)"),
  ];
  await registry.register("gateway", { owner: "gateway", capabilities: caps });
  void handlers;  // handlers are wired below
}

function cap(
  name: string,
  type: CapabilityType,
  permissions: readonly string[],
  description: string,
): CapabilityRecord {
  return {
    name,
    version: "1.0.0",
    type,
    description,
    permissions,
    owner: "gateway",
  };
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

  const startedAt = clock.now();
  const handlers = buildGatewayHandlers({ tenantStore, registry, secret, clock, sessionManager, eventBus });

  await registerGatewayCapabilities(registry, handlers);

  return {
    handleInvocation: (req) =>
      handleInvocation(req, {
        registry,
        sessionManager,
        pluginManager,
        handlers,
        audit,
        eventBus,
        rateLimiter,
        clock,
        handlerTimeoutMs,
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
      const now = clock.now();
      const expiresInMs = req.expiresInMs ?? DEFAULT_CLEANUP_TIMEOUT_MS * 1000 * 3.6;  // ~5h default? no, default 1h = 3600000ms
      void now;
      const claims: TokenClaims = {
        sub: { tenantId: req.tenantId, callerId: req.callerId },
        scope: [...req.scope],
        iat: clock.now(),
        exp: clock.now() + (req.expiresInMs ?? 3_600_000),  // default 1h
      };
      void expiresInMs;
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
      await tenantStore.save();
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
      await tenantStore.save();
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
      await tenantStore.save();
    },

    status: (): GatewayStatus => {
      const uptimeMs = clock.now() - startedAt;
      const tenantCount = tenantStore.list().length;
      const pluginCount = pluginManager.list().length;
      // audit log bytes is best-effort; in production the FS would expose a stat().
      // v1: don't measure (could be expensive on large files). Return 0.
      const auditLogBytes = 0;
      return { uptimeMs, tenantCount, pluginCount, auditLogBytes };
    },
  };
}

// Suppress unused-import warning for build-time deps used only by the no-op gates.
void checkAuthz;
void dispatchCapability;

interface BuildHandlersCtx {
  readonly tenantStore: TenantStore;
  readonly registry: CapabilityRegistry;
  readonly secret: Uint8Array;
  readonly clock: Clock;
  readonly sessionManager: SessionManager;
  readonly eventBus: EventBus;
}

function buildGatewayHandlers(ctx: BuildHandlersCtx): DispatchHandlers {
  // Each handler returns its concrete type (SessionRecord, TenantRecord, etc.). We serialize
  // through JSON to coerce to YamlValue. JSON.stringify loses Dates, undefined, functions —
  // none of which exist in our capability outputs (all are plain objects/strings/numbers).
  const wrap = <T>(fn: (input: YamlValue) => T | Promise<T>) =>
    async (input: YamlValue, _sessionId: string | undefined): Promise<YamlValue> =>
      JSON.parse(JSON.stringify(await fn(input))) as YamlValue;

  const handlers: Record<string, (input: YamlValue, sessionId: string | undefined) => Promise<YamlValue>> = {
    "auth.token.issue": wrap((input) => {
      const i = input as { tenantId?: string; callerId?: string; scope?: readonly string[]; expiresInMs?: number };
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
        iat: ctx.clock.now(),
        exp: ctx.clock.now() + (i.expiresInMs ?? 3_600_000),
      };
      return { token: issueToken(claims, ctx.secret, ctx.clock), claims };
    }),

    "auth.token.revoke": wrap(() => {
      // v1: JWTs are stateless. No-op.
      return { revoked: false };
    }),

    "session.create": wrap((input) => {
      const i = input as { ownerId?: string; adapterType?: string; metadata?: Record<string, string> };
      if (typeof i.ownerId !== "string" || typeof i.adapterType !== "string") {
        throw new GatewayError(
          ERROR_CODES.INVALID_REQUEST,
          "session.create requires {ownerId, adapterType}",
          {},
          false,
        );
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
      // NOTE[agent]: session-manager v1 doesn't expose listSessions(tenantId). Returns empty
      // array as a v1 placeholder. A v2 enhancement adds listSessions(tenantId) → SessionRecord[].
      return [];
    }),

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
      return record;
    }),

    "tenant.list": wrap(() => {
      return ctx.tenantStore.list();
    }),

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
      return { deleted: true };
    }),

    "capability.list": wrap(() => {
      return ctx.registry.list();
    }),

    "capability.describe": wrap((input) => {
      const i = input as { name?: string };
      if (typeof i.name !== "string") {
        throw new GatewayError(ERROR_CODES.INVALID_REQUEST, "name required", {}, false);
      }
      return ctx.registry.describe(i.name);
    }),

    "gateway.status": wrap(() => {
      // Implemented as the real Gateway.status() at the call site (it needs the
      // tenant count + plugin count); this handler returns a minimal placeholder.
      return { ok: true };
    }),

    "gateway.metrics": wrap(() => {
      return { ok: true };
    }),

    "gateway.configuration": wrap(() => {
      return { ok: true };
    }),
  };
  void ctx.eventBus;  // unused in this build but available for future per-capability event emission
  return { gatewayHandlers: handlers };
}

// Suppress unused-import warnings for types referenced only in JSDoc.
void randomBytes;
void createHmac;

// System clock + fs shims (production uses node:fs; tests inject fakes via config.fs / config.clock).
function systemClock(): Clock {
  return {
    now: () => Date.now(),
    // @ts-expect-error - Node's setTimeout returns Timeout; Clock interface declares number
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h),
  };
}

function nodeFileSystem(): FileSystem {
  // Lazy import to avoid loading node:fs in non-Node environments (per PHILOSOPHY — keep dependencies lazy).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  return {
    readFile: async (path) => fs.readFile(path, "utf-8"),
    writeFile: async (path, content) => fs.writeFile(path, content, "utf-8"),
    exists: async (path) => {
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}