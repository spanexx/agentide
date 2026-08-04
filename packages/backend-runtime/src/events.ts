/*
 * Code Map: event bus payload publishers for Backend Runtime
 * - emitConnectionAccepted: publish sdk.connection.accepted
 * - emitConnectionClosed: publish sdk.connection.closed
 *
 * Bus topic: sdk.connection.* (matches sdk-node's lifecycle topic family)
 * CID Index:
 * CID:events-001 -> emitConnectionAccepted
 * CID:events-002 -> emitConnectionClosed
 */

import type { EventBus } from "@spanexx/event-bus";
import type { ConnectionAcceptedPayload, ConnectionClosedPayload } from "./types.js";

export async function emitConnectionAccepted(
  eventBus: EventBus,
  payload: ConnectionAcceptedPayload,
): Promise<void> {
  await eventBus.publish("sdk.connection.accepted", payload);
}

export async function emitConnectionClosed(
  eventBus: EventBus,
  payload: ConnectionClosedPayload,
): Promise<void> {
  await eventBus.publish("sdk.connection.closed", payload);
}