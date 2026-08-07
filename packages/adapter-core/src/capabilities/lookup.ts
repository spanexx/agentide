/*
 * Code Map: adapter-core capability lookup (A6, ships unwired)
 * - createCapabilityLookup: lean shared list/describe over the kernel's
 *   capability.list / capability.describe. The kernel owns tier filtering
 *   (checkAuthz over caller scope — factory.ts); this module only builds the
 *   canonical invocation, feeds it `readClaims(token).scope`, and maps errors
 *   through the A5 converter.
 * - Deliberately NOT wired into the WS door in v1 (no discovery frames, A6 Q4);
 *   MCP migration (A8) renders tool cards from the neutral results.
 *
 * CID Index:
 * CID:adapter-core-008 -> createCapabilityLookup + CapabilityCard + LookupOutcome
 */

import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import { readClaims } from "../read-claims.js";
import type { ErrorConverter } from "../error-converter.js";

// CID:adapter-core-008 - CapabilityCard
// Purpose: neutral catalog entry (A6): the door renders protocol-specific
//   tool cards from these bytes; ordering = kernel registry order (no sort).
export interface CapabilityCard {
  readonly name: string;
  readonly description: string;
  readonly tier: string | null;
}

export interface CapabilityDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<object> | null;
  readonly tier: string | null;
}

export type LookupOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string | number; readonly message: string } };

export interface CapabilityLookup {
  /** Kernel-filtered catalog for the token's scope. Empty scope → [] (BI[7] defensive). */
  list(token: string): Promise<LookupOutcome<readonly CapabilityCard[]>>;
  /** Single capability detail. Unknown name → error (kernel decides). */
  describe(name: string, token: string): Promise<LookupOutcome<CapabilityDescriptor>>;
}

export interface CapabilityLookupOptions {
  readonly gateway: Gateway;
  readonly errors: ErrorConverter;
}

// CID:adapter-core-008 - createCapabilityLookup
// Purpose: A6 seam — one shared discovery path for all doors. Scope is read
//   from the (unsigned, kernel-verified) token via readClaims (A2); the kernel
//   does the actual tier filter, so core never re-implements authz.
export function createCapabilityLookup(options: CapabilityLookupOptions): CapabilityLookup {
  const { gateway, errors } = options;
  return {
    async list(token) {
      const scope = readClaims(token).scope;
      if (scope.length === 0) return { ok: true, value: [] };
      const result = await gateway.handleInvocation({
        token,
        capability: { name: "capability.list" },
        input: { scope },
      });
      if ("error" in result) {
        return { ok: false, error: errors(result.error) };
      }
      const cards = extractCards(result.output);
      return { ok: true, value: cards };
    },
    async describe(name, token) {
      const result = await gateway.handleInvocation({
        token,
        capability: { name: "capability.describe" },
        input: { name },
      });
      if ("error" in result) {
        return { ok: false, error: errors(result.error) };
      }
      return { ok: true, value: extractDescriptor(result.output) };
    },
  };
}

function extractCards(output: YamlValue): readonly CapabilityCard[] {
  if (!Array.isArray(output)) return [];
  const cards: CapabilityCard[] = [];
  for (const rec of output) {
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) continue;
    const card = rec as Readonly<Record<string, YamlValue>>;
    const name = card["name"];
    const description = card["description"];
    const tier = card["tier"];
    if (typeof name !== "string" || typeof description !== "string") continue;
    cards.push({ name, description, tier: typeof tier === "string" ? tier : null });
  }
  return cards;
}

function extractDescriptor(output: YamlValue): CapabilityDescriptor {
  const rec =
    typeof output === "object" && output !== null && !Array.isArray(output)
      ? (output as Readonly<Record<string, YamlValue>>)
      : {};
  // Kernel describe shape: DescribeResult { capability: CapabilityRecord | null,... }
  // (capability-registry store.ts) — nested. Flat fallback tolerated for A6
  // unedited-fixture tests and any leaner future producers (A8 finding: shipped
  // unwired, kernel shape verified 2026-08-07).
  const record =
    (typeof rec["capability"] === "object" && !Array.isArray(rec["capability"]) && rec["capability"] !== null
      ? (rec["capability"] as Readonly<Record<string, YamlValue>>)
      : rec) ?? rec;
  const name = record["name"];
  const description = record["description"];
  const inputSchema = record["inputSchema"];
  const tier = record["tier"];
  return {
    name: typeof name === "string" ? name : "",
    description: typeof description === "string" ? description : "",
    inputSchema: typeof inputSchema === "object" && inputSchema !== null ? inputSchema : null,
    tier: typeof tier === "string" ? tier : null,
  };
}
