/*
 * Code Map: ClientService — pure-logic operations for service/app identities.
 * Owns: hashing, secret rotation, registration-code generation, rate-limit,
 * audit-log hook. Does NOT own HTTP — the routes (POST /oauth/token etc.)
 * call these methods from the gateway-core handle-invocation.
 *
 * CID Index:
 * CID:cs-002 -> ClientService
 * CID:cs-003 -> hashSecret(salt, secret)
 * CID:cs-004 -> randomClientId
 * CID:cs-005 -> randomSecret
 * CID:cs-006 -> randomRegistrationCode
 * CID:cs-007 -> listClients
 *
 * Quick lookup: rg -n "CID:cs-" packages/gateway-core/src/client-service.ts
 */

import { createHash, randomBytes } from "node:crypto";
import type { ClientRecord, ClientStore, RegistrationCode } from "./types.js";

export interface CreateClientRequest {
  tenantId: string;
  name: string;
  defaultScope: readonly string[];
}

export interface RotateRequest { clientId: string; }
export interface VerifyRequest { id: string; secret: string; }
export interface RevokeRequest { clientId: string; }
export interface CreateRegistrationCodeRequest {
  tenantId: string;
  defaultScope: readonly string[];
  ttlMs?: number; // default 5 min
}
export interface RedeemRequest { code: string; }
export interface VerifyResult { record: ClientRecord; wasOldSecret: boolean; }
export interface RedeemResult { clientId: string; plaintextSecret: string; }

const ROTATION_GRACE_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const CREATE_RATE_LIMIT_MAX = 5;
const CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// CID:cs-003 - hashSecret
export function hashSecret(salt: string, secret: string): string {
  const digest = createHash("sha256").update(salt + secret).digest("hex");
  return `sha256:${salt}:${digest}`;
}

// CID:cs-004 - randomClientId
export function randomClientId(): string {
  return `cli_${randomBytes(8).toString("hex")}`;
}

// CID:cs-005 - randomSecret
export function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

// CID:cs-006 - randomRegistrationCode
export function randomRegistrationCode(): string {
  return `rc_${randomBytes(8).toString("hex")}`;
}

// CID:cs-002 - ClientService
export class ClientService {
  private readonly createTimestamps: number[] = [];

  constructor(
    private readonly store: ClientStore,
    private readonly salt: () => string,
    private readonly clock: () => number,
  ) {}

  async createClient(req: CreateClientRequest): Promise<{ record: ClientRecord; plaintextSecret: string }> {
    this.checkCreateRateLimit();
    const id = randomClientId();
    const plaintextSecret = randomSecret();
    const hashedSecret = hashSecret(this.salt(), plaintextSecret);
    const now = this.clock();
    const record: ClientRecord = {
      id,
      tenantId: req.tenantId,
      name: req.name,
      hashedSecret,
      previousHashedSecrets: [],
      defaultScope: req.defaultScope,
      revoked: false,
      createdAt: now,
      lastUsedAt: null,
      lastRotatedAt: null,
      gracePeriodEndsAt: null,
    };
    const records = await this.store.load();
    await this.store.save([...records, record]);
    return { record, plaintextSecret };
  }

  // CID:cs-007 - listClients
  async listClients(tenantId?: string): Promise<readonly ClientRecord[]> {
    const records = await this.store.load();
    return tenantId === undefined ? records : records.filter((r) => r.tenantId === tenantId);
  }

  async verifyClient(req: VerifyRequest): Promise<ClientRecord | null> {
    const records = await this.store.load();
    const rec = records.find((r) => r.id === req.id);
    if (!rec || rec.revoked) return null;
    const hashed = hashSecret(this.salt(), req.secret);
    const isCurrent = hashed === rec.hashedSecret;
    // During the grace window after a rotation, the PREVIOUS hash is accepted
    // so the operator can deploy the new secret without a hard cutover.
    const inGrace =
      rec.gracePeriodEndsAt != null &&
      this.clock() < rec.gracePeriodEndsAt &&
      rec.previousHashedSecrets.includes(hashed);
    if (!isCurrent && !inGrace) return null;
    // update lastUsedAt
    const updated = { ...rec, lastUsedAt: this.clock() };
    const idx = records.indexOf(rec);
    const next = [...records.slice(0, idx), updated, ...records.slice(idx + 1)];
    await this.store.save(next);
    return updated;
  }

  async revokeClient(req: RevokeRequest): Promise<void> {
    const records = await this.store.load();
    const rec = records.find((r) => r.id === req.clientId);
    if (!rec) return;
    const idx = records.indexOf(rec);
    const updated = { ...rec, revoked: true };
    await this.store.save([...records.slice(0, idx), updated, ...records.slice(idx + 1)]);
  }

  async rotateClient(req: RotateRequest): Promise<{ plaintextSecret: string }> {
    const records = await this.store.load();
    const rec = records.find((r) => r.id === req.clientId);
    if (!rec) throw new Error(`client not found: ${req.clientId}`);
    const plaintextSecret = randomSecret();
    const hashedSecret = hashSecret(this.salt(), plaintextSecret);
    const now = this.clock();
    const idx = records.indexOf(rec);
    const updated: ClientRecord = {
      ...rec,
      hashedSecret,
      previousHashedSecrets: [...rec.previousHashedSecrets, rec.hashedSecret],
      lastRotatedAt: now,
      gracePeriodEndsAt: now + ROTATION_GRACE_MS,
    };
    await this.store.save([...records.slice(0, idx), updated, ...records.slice(idx + 1)]);
    return { plaintextSecret };
  }

  async createRegistrationCode(req: CreateRegistrationCodeRequest): Promise<{ code: string; expiresAt: number }> {
    const ttlMs = req.ttlMs ?? CODE_TTL_MS;
    const code = randomRegistrationCode();
    const expiresAt = this.clock() + ttlMs;
    const codes = await this.store.loadCodes();
    const record: RegistrationCode = {
      code,
      tenantId: req.tenantId,
      defaultScope: req.defaultScope,
      expiresAt,
      consumed: false,
    };
    await this.store.saveCodes([...codes, record]);
    return { code, expiresAt };
  }

  async redeemRegistrationCode(req: RedeemRequest): Promise<RedeemResult | null> {
    const codes = await this.store.loadCodes();
    const idx = codes.findIndex((c) => c.code === req.code);
    if (idx === -1) return null;
    const c = codes[idx];
    if (c.consumed) return null;
    if (this.clock() >= c.expiresAt) return null;
    // mark consumed
    const updated = { ...c, consumed: true };
    const next = [...codes.slice(0, idx), updated, ...codes.slice(idx + 1)];
    await this.store.saveCodes(next);
    // create the new client
    const { record, plaintextSecret } = await this.createClient({
      tenantId: c.tenantId,
      name: `from-${req.code.slice(0, 8)}`,
      defaultScope: c.defaultScope,
    });
    return { clientId: record.id, plaintextSecret };
  }

  private checkCreateRateLimit(): void {
    const now = this.clock();
    const windowStart = now - CREATE_RATE_LIMIT_WINDOW_MS;
    // Drop timestamps older than the window. findIndex returns the first
    // index whose timestamp is NEWER than windowStart; everything before it
    // is stale. splice(0, idx) removes those stale entries. If no entry is
    // newer (all stale), findIndex returns -1 -> clear the whole array.
    const firstNew = this.createTimestamps.findIndex((t) => t >= windowStart);
    const dropCount = firstNew === -1 ? this.createTimestamps.length : firstNew;
    if (dropCount > 0) this.createTimestamps.splice(0, dropCount);
    if (this.createTimestamps.length >= CREATE_RATE_LIMIT_MAX) {
      throw new Error(`rate_limited: max ${CREATE_RATE_LIMIT_MAX} client.create per ${CREATE_RATE_LIMIT_WINDOW_MS}ms`);
    }
    this.createTimestamps.push(now);
  }
}
