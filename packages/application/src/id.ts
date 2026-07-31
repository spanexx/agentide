/*
 * Code Map: Application id generation
 * - createApplicationId: monotonic ULID factory; produces app_<26-char-ulid>
 * - ulid: re-exported for callers that need to parse/format the raw 26-char value
 *
 * The `app_` prefix is a value-type discriminator (lets grep / log filters /
 * future entity types like `tenant_`, `session_` coexist). The 26-char
 * ULID body itself is sortable by creation time (first 10 chars are
 * millisecond timestamp).
 *
 * CID Index:
 * CID:id-001 -> createApplicationId
 * CID:id-002 -> APPLICATION_ID_PREFIX
 * CID:id-003 -> APPLICATION_ID_PATTERN
 * CID:id-004 -> isApplicationId
 *
 * Quick lookup: rg -n "CID:id-" packages/application/src/id.ts
 */

import { monotonicFactory, ulid as createUlid } from "ulid";

export const APPLICATION_ID_PREFIX = "app_";

export const APPLICATION_ID_PATTERN = /^app_[0-9A-HJKMNP-TV-Z]{26}$/;

const nextUlid = monotonicFactory();

export function createApplicationId(): string {
  return `${APPLICATION_ID_PREFIX}${nextUlid()}`;
}

export function isApplicationId(value: string): boolean {
  return APPLICATION_ID_PATTERN.test(value);
}

export const createRawUlid = createUlid;
