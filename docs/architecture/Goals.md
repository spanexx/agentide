# Goals

> **Revision note (this pass):** Consolidates four previously separate principles —
> Capability First, Protocol Agnostic, Language Agnostic, and Framework Independence — into a
> single "Agnostic by Design" principle with sub-bullets (drift item #2). They were the same
> idea (never hard-code an assumption about *how* someone talks to the platform) restated at
> four layers: capability naming, protocol, language, framework. Principles are renumbered
> below; nothing else changed in substance.

This document defines the fundamental goals of the Agent Runtime Platform.

These goals serve as the architectural principles that guide every design and implementation
decision. Every new feature, component, or plugin should align with these goals.

---

# Primary Goal

Build a platform that enables applications to become **AI-native** by exposing secure,
discoverable, and composable capabilities that can be consumed by any AI agent, regardless of
protocol, language, or runtime.

---

# Design Principles

## 1. Agnostic by Design

The platform must never hard-code an assumption about *how* someone communicates with it. This
principle applies at four layers, each with its own mechanism but the same underlying rule:

**Capability-level.** Applications should expose **Capabilities**, not APIs. A capability
represents an action an AI agent can perform.

Examples:

```
customer.read

customer.create

order.cancel

browser.navigate

browser.click
```

The platform should encourage developers to think in terms of business actions instead of
HTTP endpoints. See **Capability System** for the full definition.

**Protocol-level.** The platform must never depend on a single communication protocol.
Protocols should be implemented as Adapters.

Examples:

- MCP
- REST
- CLI
- WebSocket
- GraphQL
- gRPC
- Future AI protocols

Adding a new protocol must not require changing the platform's core.

**Language-level.** Applications should be able to integrate regardless of the programming
language they use.

Supported languages may include:

- TypeScript
- JavaScript
- Go
- Rust
- Python
- Java
- C#
- Kotlin

Each SDK should expose the same concepts while following the conventions of its ecosystem.

**Framework-level.** The platform should not be tied to any frontend or backend framework.

Examples:

Backend

- NestJS
- Express
- Fastify
- Go Fiber
- Gin
- Django
- Flask
- Spring Boot

Frontend

- Angular
- React
- Vue
- Svelte
- SolidJS

Framework support should be implemented through SDK integrations, not platform assumptions.

Taken together: the same capability, requested over any protocol, implemented in any
language, inside any framework, should behave identically from the agent's point of view. If
a future design decision would only work for one protocol, one language, or one framework,
it violates this principle and should be reconsidered.

---

## 2. Plugin First

Every major feature should be replaceable.

Examples include:

- Browser Runtime
- Authentication
- Logging
- Analytics
- Docker
- Git
- Database Connectors

Removing a plugin should never require modifying the platform core.

---

## 3. Modular Architecture

Every component should have a single responsibility.

Examples:

Gateway

- Authentication
- Routing
- Session coordination

Browser Runtime

- Browser lifecycle
- Navigation
- DOM interaction

Capability Registry

- Capability discovery
- Metadata
- Versioning

The platform should avoid tightly coupled components.

---

## 4. Separation of Concerns

The platform separates responsibilities into distinct layers.

Application

↓

SDK

↓

Gateway

↓

Runtime

↓

Execution

Each layer should know as little as possible about the others.

---

## 5. Session-Based Execution

Every interaction should execute inside a session.

A session provides:

- Context
- Permissions
- Runtime state
- Browser instances
- Temporary resources

Sessions make long-running AI workflows reliable and manageable.

---

## 6. Runtime Isolation

Execution should happen inside runtimes, not inside the Gateway.

Examples:

- Browser Runtime
- Backend Runtime
- Docker Runtime
- Git Runtime

The Gateway coordinates.

Runtimes execute.

---

## 7. Security by Default

Applications should never expose functionality automatically.

Developers must explicitly register capabilities.

Every capability should support:

- Authentication
- Authorization
- Permission scopes
- Audit logging
- Rate limiting

The safest configuration should always be the default. Where a capability's actions vary in
risk (e.g. a read vs. a destructive action within the same namespace), permission scopes
should be tiered accordingly rather than granted as one flat scope — see **Runtime
Capabilities → Permissions and Risk Tiers** for the current worked convention.

---

## 8. Observable by Design

Everything happening in the platform should be observable.

Developers should be able to inspect:

- Active sessions
- Runtime health
- Capability execution
- Browser actions
- Errors
- Performance metrics

Observability should be built into the platform—not added later.

---

## 9. Event-Driven Communication

Components should communicate using events instead of direct dependencies.

Example:

```
Browser Started

↓

browser.started

↓

Logger

↓

Debugger

↓

Analytics
```

This allows plugins to react independently without modifying existing code.

---

## 10. Extensibility

The platform should encourage extension rather than modification.

New functionality should be added through:

- Plugins
- SDK extensions
- Adapters
- Runtimes

Core platform changes should be rare.

---

## 11. Developer Experience

Integration should be simple.

Ideal workflow:

```
Install SDK

↓

Register Capabilities

↓

Connect Gateway

↓

Run Application
```

Developers should not need to understand the internal architecture to become productive.

---

## 12. Scalability

The platform should scale from local development to enterprise deployments.

Deployment options include:

- Local
- Self-hosted
- Managed cloud
- Hybrid

The architecture should remain consistent across all deployment models. Note that
"consistent architecture" does not mean "identical permissions" — see **Platform
Capabilities → Permission Ownership by Deployment Model** for where self-hosted and hosted
deployments intentionally diverge on who may hold certain permissions.

---

## 13. Backward Compatibility

Existing applications should continue working after platform upgrades.

Breaking changes should be avoided whenever possible.

When unavoidable:

- Deprecate first
- Document migration paths
- Support multiple versions during transition

---

## 14. Cloud and Local Parity

Developers should have the same experience whether using:

- Hosted Gateway
- Local Gateway
- Self-hosted Gateway

Moving between environments should require minimal configuration changes.

---

## 15. Future-Proof Architecture

Technology evolves.

Protocols evolve.

AI models evolve.

Programming languages evolve.

The platform should be designed so that new technologies can be adopted without requiring a
complete redesign.

---

# Non-Goals

The platform is **not** intended to:

- Replace application frameworks.
- Replace existing web servers.
- Replace databases.
- Replace browser automation tools.
- Become another AI model provider.
- Lock developers into a proprietary ecosystem.

Instead, it orchestrates and enhances these technologies through a unified runtime.

---

# Success Criteria

The platform succeeds when:

- Developers can integrate AI capabilities into existing applications in minutes.
- Applications expose capabilities instead of implementation details.
- AI agents can discover and execute capabilities consistently across languages.
- New protocols can be added without changing the platform core.
- Plugins can be installed or removed without breaking the system.
- Long-running AI workflows are reliable and observable.
- Browser interactions become application-aware instead of relying solely on fragile DOM
  automation.
- Developers view the platform as the standard runtime layer between applications and AI
  agents.

---

# Guiding Philosophy

Every architectural decision should answer **yes** to the following questions:

- Does this make the platform more modular?
- Does this reduce coupling?
- Can this be replaced by a plugin?
- Is this agnostic to protocol, language, and framework?
- Is it secure by default, with permissions scoped to actual risk?
- Is it observable?
- Does it improve the developer experience?
- Will this still make sense five years from now?
