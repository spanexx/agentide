/*
 * Code Map: sdk-node public type surface
 *
 * - SdkConfig:    developer-provided config at createSdk() time
 * - SdkInstance:  the handle returned by createSdk()
 * - Handler:      the function signature for a capability handler
 * - HandlerContext: passed to every handler call
 * - Phase:        the lifecycle state of the SDK instance
 *
 * Phase 1 ships types only; behavior lands in Phases 2-6.
 */

export type Phase = "init" | "connected" | "registered" | "disconnected";

/** Logger surface handed to handlers via HandlerContext.
 *  Meta is scalar-only (avoiding `unknown` and `any`). For structured
 *  meta, serialize to JSON first and pass the resulting string.
 */
export interface Logger {
  info(message: string, meta?: Record<string, string | number | boolean | null>): void;
  warn(message: string, meta?: Record<string, string | number | boolean | null>): void;
  error(message: string, meta?: Record<string, string | number | boolean | null>): void;
}

/** Configuration for a handler invocation. */
export interface CallContext {
  /** Unique per call. */
  readonly id: string;
  /** Capability name (e.g. "customer.read"). */
  readonly capability: string;
  /** Caller's JWT — handlers can introspect for audit / RBAC. */
  readonly token: string;
  /** If the caller is operating inside a session, the session id. */
  readonly sessionId?: string;
}

/** Context passed to every handler call. */
export interface HandlerContext {
  readonly app: { readonly id: string; readonly name: string };
  readonly call: CallContext;
  readonly log: Logger;
}

/** A handler: pure async function from input to output. */
export type Handler<I = unknown, O = unknown> = (
  input: I,
  ctx: HandlerContext,
) => Promise<O>;

/** Connection target — where the SDK will open its WebSocket.
 *  token is omitted when the SDK authenticates via client_credentials
 *  (BI[29]): the TokenRefresher mints the JWT at connect() time.
 */
export interface GatewayTarget {
  readonly url: string;
  readonly token?: string;
}

/** Developer app identity. */
export interface AppIdentity {
  readonly id: string;
  readonly name: string;
}

/** Pluggable observability surface (Phase 2.3 in future.md). */
export interface Observability {
  readonly logger?: Logger;
}

/** Manifest loader source — either a file path or an inline object.
 *  Inline manifests use a concrete shape (see ParsedManifest in manifest.ts)
 *  rather than `unknown`; concrete types land in Phase 2.
 */
export type ManifestSource = string | Record<string, string | number | boolean | readonly (string | number | boolean)[]>;

/** Handler loader source — either a module path or an inline map. */
export type HandlerSource = string | Record<string, Handler>;

/** The config the developer passes to createSdk(). */
export interface SdkConfig {
  readonly gateway: GatewayTarget;
  readonly app: AppIdentity;
  readonly manifest: ManifestSource;
  readonly handlers: HandlerSource;
  readonly observability?: Observability;
  // CID:sdk-002 - client_credentials (BI[29])
  // When clientId + clientSecret are set, the SDK mints/refreshes JWTs at
  // POST {oauthUrl}/oauth/token instead of using gateway.token statically.
  // If BOTH gateway.token and clientId are present, clientId wins (migration).
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** Base URL for POST /oauth/token (required when clientId is set). */
  readonly oauthUrl?: string;
  /** Invoked once when the gateway reports client_revoked (401). */
  readonly onRevoked?: () => void;
  /** Test seams — default to globalThis.fetch / Date.now / Math.random. */
  readonly fetchImpl?: import("./refresher.js").FetchImpl;
  readonly clock?: () => number;
  readonly random?: () => number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly maxAttempts?: number;
}

/** Read-only state exposed via sdk.state(). */
export interface SdkState {
  readonly phase: Phase;
  readonly capabilities: Record<string, { tier: string | null; registered: boolean }>;
}

/** The handle returned by createSdk(). */
export interface SdkInstance {
  connect(): Promise<void>;
  register(): Promise<void>;
  invoke<I = unknown, O = unknown>(name: string, input: I): Promise<O>;
  disconnect(): Promise<void>;
  reset(): void;
  state(): SdkState;
  // CID:sdk-002 - token lifecycle (BI[29])
  /** Current JWT, or null when client_credentials mint hasn't landed /
   *  the client was revoked. Legacy static-token configs always return it. */
  token(): string | null;
  /** Mint (first call) or refresh when the JWT is within the refresh window
   *  (exp < 60s + jitter). Single in-flight refresh; no-op for legacy configs. */
  refreshIfNeeded(): Promise<void>;
}