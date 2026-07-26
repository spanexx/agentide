# Terminology

> **Revision note (this pass):** Resolves drift item #9 (Control Plane vs. Data Plane vs.
> Execution Plane naming conflict). This document is the canonical source of truth for all
> platform terminology — other docs should cross-reference it rather than redefine terms.

This document defines the core terminology used throughout the Agent Runtime Platform.

Having a consistent vocabulary ensures that developers, contributors, and plugin authors
interpret the architecture in the same way. **When any other document's wording conflicts
with a definition here, this document wins.**

---

# Platform

The **Platform** is the complete ecosystem that enables AI agents to interact with
applications.

It consists of:

- Gateway
- Session Manager
- Capability Registry
- Plugin Manager
- Event Bus
- SDKs
- Runtimes
- Adapters
- Dashboard

The platform is the product.

---

# Application

An **Application** is software built by a developer that integrates with the platform.

Examples:

- E-commerce websites
- CRM systems
- Banking applications
- SaaS products
- Internal business tools

Applications expose capabilities through an SDK. Applications are never installed into the
platform — they connect outward to the Gateway from wherever they already run.

---

# SDK

An SDK (Software Development Kit) allows applications to communicate with the platform.

Responsibilities include:

- Registering capabilities
- Authenticating with the Gateway
- Receiving capability execution requests
- Returning execution results

**"SDK" names a role, not a single package.** There are two roles — Backend SDK and Frontend
SDK (see their entries below) — and each backend-role SDK gets its own package per language.
Naming convention for concrete packages:

| Role | Language | Package |
|---|---|---|
| Backend | Node/TypeScript | `@platform/sdk-node` |
| Backend | Python | `platform-sdk-python` |
| Backend | Go | `platform-sdk-go` |
| Backend | Rust | `platform-sdk-rust` |
| Backend | Java | `platform-sdk-java` |
| Backend | .NET | `platform-sdk-dotnet` (NuGet: `Platform.Sdk`) |
| Frontend | Browser (JS/TS only) | `@platform/sdk-browser` |

"Backend SDK" is not itself a package name — calling one specific language's package "the
Backend SDK" (as earlier drafts did for the Node/TypeScript one) becomes ambiguous the moment
a second backend-language package exists. Every concrete package name carries its language
explicitly, per the table above.

The Frontend SDK role does not get this per-language treatment: it runs inside a browser, so
it is inherently JS/TS regardless of what framework (React, Vue, Angular, Svelte) consumes
it — see **Goals → Agnostic by Design (framework layer)**. There is no "Python Frontend SDK"
to disambiguate against.

SDKs do not contain business logic. They provide the bridge between an application and the
platform.

---

# Capability

A **Capability** is the smallest unit of functionality that an AI agent can execute.

Examples:

```
customer.read

customer.create

product.search

cart.add

browser.navigate

browser.click
```

A capability should represent a meaningful business action rather than a technical
implementation.

Every capability contains metadata including:

- Name
- Description
- Version
- Input Schema
- Output Schema
- Permissions
- Execution Handler
- **Type** — one of `business`, `platform`, or `runtime` (see Capability Types below)

For the full anatomy of a capability and naming conventions, see the **Capability System**
document. For how each type is implemented, see **Business Capabilities**, **Platform
Capabilities**, and **Runtime Capabilities**.

---

# Capability Types

Every capability belongs to exactly one of three types, distinguished by who owns and
implements it:

| Type | Owned By | Purpose | Example |
|------|----------|---------|---------|
| **Business** | The application developer | Execute domain-specific business logic | `customer.read` |
| **Platform** | The platform core | Manage and inspect the platform itself | `session.create` |
| **Runtime** | A runtime plugin | Interact with an execution environment | `browser.navigate` |

This distinction is surfaced in discovery responses via the capability's `type` field, so
agents, dashboards, and CLIs can tell at a glance who is responsible for each capability they
see.

---

# Capability Handler

A Capability Handler is the function responsible for executing a capability.

Example:

```
customer.read

↓

CustomerReadHandler

↓

Database Query

↓

Return Result
```

Handlers are implemented by whoever owns the capability's type: the application (Business),
the platform core (Platform), or the runtime plugin (Runtime).

---

# Capability Registry

The Capability Registry is the catalog of every capability available to the platform.

It stores metadata but does not execute capabilities.

Responsibilities:

- Discovery
- Versioning
- Lookup
- Metadata
- Permissions

---

# Gateway

The Gateway is the entry point into the platform.

Responsibilities include:

- Authentication
- Authorization
- Session creation
- Capability discovery
- Request routing
- Metrics
- Logging

The Gateway coordinates requests but never executes business logic. See **Control Plane**
below for how the Gateway's own internal responsibilities are organized.

---

# Control Plane

The **Control Plane** is the set of platform components responsible for coordinating the
system — deciding *what* should happen and *whether it's allowed* — without performing the
work itself.

It consists of:

- Gateway
- Session Manager
- Capability Registry
- Plugin Manager

Concretely, the Control Plane handles: authentication, authorization, session lifecycle,
capability discovery, plugin lifecycle, and routing decisions. It does not touch a browser,
run a container, or query an application's database.

The Control Plane may run as a single process internally, but is described as a logical split
because its responsibilities are architecturally distinct from execution.

*(Superseded terminology: earlier design notes used "Data Plane" to describe the counterpart
to the Control Plane, scoped narrowly to request routing and response handling within the
Gateway. That term has been retired in favor of Execution Plane below, which covers the full
set of components that actually perform work — not just the Gateway's routing logic. If a
future need arises to distinguish "routing/response handling inside the Gateway" from
"execution inside runtimes" as two separate concepts, that should be introduced as a new,
explicitly-named subdivision rather than reviving "Data Plane," to avoid re-creating this
ambiguity.)*

---

# Execution Plane

The **Execution Plane** is the set of platform components responsible for actually performing
work — deciding and carrying out *how* something happens, once the Control Plane has approved
it.

It consists of:

- Browser Runtime
- Backend Runtime
- Docker Runtime
- Git Runtime
- File Runtime
- (any other installed Runtime Plugin)

Execution is isolated from coordination: runtimes never authenticate requests, never decide
permissions, and never perform capability discovery. Those remain Control Plane
responsibilities.

---

# Session

A Session represents the lifecycle of an interaction between an AI agent and the platform.

A session may contain:

- Runtime state
- Browser instances
- Authentication context
- Temporary resources
- Execution history

Sessions isolate one execution context from another. **A session is not chat history** — it
is an execution context, analogous to an operating system process.

---

# Session Manager

The Session Manager creates, tracks, and destroys sessions.

Responsibilities:

- Create sessions
- Resume sessions
- Cleanup
- Resource tracking
- Timeout handling

The Session Manager is part of the Control Plane.

---

# Runtime

A Runtime is an execution environment responsible for performing work. Runtimes are part of
the Execution Plane.

Examples:

- Browser Runtime
- Backend Runtime
- Docker Runtime
- Git Runtime
- Database Runtime

The Gateway (Control Plane) delegates work to runtimes; it never performs the work itself.

---

# Browser Runtime

The Browser Runtime manages browser instances.

Responsibilities:

- Launch browser
- Close browser
- Manage tabs
- Navigate
- Click
- Type
- Capture screenshots

It owns browser resources — no other runtime or component manipulates them directly.

---

# Backend Runtime

The Backend Runtime executes Business Capabilities inside an application.

Example:

```
customer.read

↓

Backend Runtime

↓

Application

↓

Database
```

---

# Adapter

An Adapter translates an external protocol into platform requests.

Examples:

- MCP Adapter
- CLI Adapter
- REST Adapter
- WebSocket Adapter

Adapters never contain business logic. They translate requests and responses only, and hold
no state of their own.

---

# Plugin

A Plugin extends the platform without modifying its core.

Examples:

- Browser Runtime
- Git Runtime
- Docker Runtime
- Analytics
- Logging
- Authentication Provider

Plugins are independently installable and conform to a defined Plugin Manifest (see
**Plugin Manifest** below). No plugin should directly depend on another plugin — plugins
communicate only through the Event Bus.

---

# Plugin Manager

The Plugin Manager is responsible for:

- Installing plugins
- Loading plugins
- Updating plugins
- Uninstalling plugins
- Dependency validation

The Plugin Manager is part of the Control Plane.

The source and distribution mechanism for plugins — a registry with tiered trust levels that
plugins conforming to the Plugin Manifest can be published to and installed from — is
specified in **Plugin Marketplace**.

---

# Plugin Manifest

A **Plugin Manifest** is a declarative description of a plugin's identity, version, and the
capabilities it registers, published as a single document rather than requiring capabilities
to be registered one at a time.

Example (for a Runtime Plugin):

```yaml
runtime:
  id: browser
version: 1.0
capabilities:
  - browser.navigate
  - browser.click
  - browser.type
```

Applications publish an equivalent manifest for their own capability set (see **Capability
Manifest** below). The manifest format is intended to be the basis of any future plugin
distribution standard: a plugin that conforms to the manifest schema should be installable
by the Plugin Manager regardless of who authored it.

---

# Capability Manifest

A **Capability Manifest** is an application's declarative description of every capability it
registers with the platform, published as one document at startup instead of registering
capabilities individually.

Example:

```yaml
application:
  id: ecommerce
version: 1.0
capabilities:
  - customer.read
  - customer.update
  - order.submit
```

Benefits include single registration, faster startup, easier discovery, versioning support,
dashboard integration, capability diffing, and hot reload.

---

# Event

An Event represents something that happened inside the platform.

Examples:

```
session.created

browser.started

browser.closed

capability.executed

plugin.loaded
```

Events are immutable.

---

# Event Bus

The Event Bus delivers events between components.

Components communicate through events instead of direct references. This reduces coupling
and increases extensibility, and is the only sanctioned way for plugins to react to each
other's activity — never through direct dependencies.

---

# Runtime Plugin

A Runtime Plugin provides an execution environment. Runtime Plugins are part of the
Execution Plane.

Examples:

- Browser Runtime
- Docker Runtime
- Kubernetes Runtime

Runtime plugins execute work and own their own resources.

---

# Service Plugin

A Service Plugin provides supporting functionality that does not execute capabilities.

Examples:

- Authentication
- Metrics
- Logging
- Monitoring
- Notifications

These plugins enhance the platform but are not part of the Execution Plane in the same sense
as Runtime Plugins — they observe and support rather than perform agent-directed work.

---

# Developer Plugin

A Developer Plugin extends the tooling developers use to work with the platform, rather than
extending the platform's runtime behavior.

Examples:

- Dashboard extensions
- VS Code extension
- Chrome DevTools extension

---

# Frontend SDK

The Frontend SDK runs inside browser applications.

Responsibilities include:

- Registering browser capabilities
- Communicating with the Gateway
- Exposing application-aware browser actions

It enables AI agents to interact with applications safely, without relying solely on generic
DOM automation. Concrete package: `@platform/sdk-browser` (see **SDK** above for why this
role, unlike Backend SDK, doesn't get a per-language package family).

---

# Backend SDK

The Backend SDK is a **role**, not a single package — any SDK that runs inside a backend
application and performs the responsibilities below, in whatever language that backend is
written in. See **SDK** above for the full per-language package table
(`@platform/sdk-node`, `platform-sdk-python`, `platform-sdk-go`, etc.).

Responsibilities include:

- Registering backend capabilities
- Executing capability handlers
- Returning execution results

---

# Dashboard

The Dashboard is the primary interface for developers to monitor the platform, and is treated
as a first-class part of the platform rather than an auxiliary admin tool.

Features include:

- Active Sessions
- Installed Plugins
- Registered Capabilities
- Runtime Health
- Logs
- Metrics
- Browser Inspection

---

# AI Agent

An AI Agent is any system capable of discovering and executing capabilities through the
platform.

Examples include:

- ChatGPT
- Claude
- Gemini
- Custom autonomous agents
- Enterprise AI assistants

The platform does not depend on any specific AI provider.

---

# Resource

A Resource is any object owned by a session.

Examples:

- Browser instance
- Browser tab
- Authentication token
- Temporary file
- Database transaction

Resources are automatically cleaned up when a session ends. Resources are always owned by
exactly one runtime and scoped to exactly one session.

---

# Tenant (Future)

A Tenant represents an isolated organization or customer using the platform.

Each tenant has:

- Users
- Applications
- Plugins
- Sessions
- Permissions

Tenant support enables multi-organization deployments. **Status: not yet designed.** In
particular, the interaction between tenancy and Platform Capability permissions (e.g. whether
`platform.plugin.install` is available to a tenant at all in a hosted deployment, or reserved
for the platform operator) is not yet specified — see the project drift/issue log, item #4.

---

# Summary

At its core, the platform is built around a simple relationship:

```
Application
      │
      ▼
    SDK
      │
      ▼
Capability
      │
      ▼
Gateway (Control Plane)
      │
      ▼
Runtime (Execution Plane)
      │
      ▼
Execution
```

Everything else — plugins, sessions, adapters, dashboards, manifests, and events — exists to
support this lifecycle while keeping the platform modular, secure, and extensible.
