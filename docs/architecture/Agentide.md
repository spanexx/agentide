# Agent Runtime Platform
## Architecture Book

> **Version:** Draft 0.2
>
> This document describes the architecture of the Agent Runtime Platform.
> The platform is designed to provide a secure, extensible, language-agnostic runtime for AI
> agents to interact with applications through capabilities.
>
> **Important:** This platform is **not** an MCP server.
> MCP is simply **one adapter** that allows AI agents to communicate with the platform.
>
> **Revision note (this pass):** Absorbs the novel content from *Architectural Refinement
> V1* — Control Plane/Execution Plane split, Capability & Runtime Manifests, Dashboard as a
> first-class product with DevTools/VS Code detail, and the final ownership model — directly
> into this document (drift item #8). Also addresses open questions on future-runtime
> ownership (#6) and Git Runtime's implementation approach (#7). Architectural Refinement V1
> itself is now a changelog pointing here rather than a parallel source of truth — see that
> document's revision note.

---

# Table of Contents

1. Vision
2. Goals
3. Core Philosophy
4. High-Level Architecture
5. Core Components
6. SDKs
7. Runtimes
8. Adapters
9. Gateway
10. Plugin System
11. Session Management
12. Capability System
13. Event Bus
14. Dashboard
15. Deployment Models
16. Ownership Model
17. Implementation Roadmap

---

# 1. Vision

The goal of the platform is to become an **operating system for AI agents**.

Instead of exposing raw REST APIs or tightly coupling applications to a specific protocol
like MCP, developers expose **Capabilities**.

The platform then allows any compatible AI agent to securely discover and execute those
capabilities through multiple adapters.

The architecture separates:

- Business Logic
- Browser Automation
- Agent Communication
- Session State
- Plugins

This keeps applications modular and future-proof. See **Vision** for the full narrative and
**Goals** for the principles this architecture is held to.

---

# 2. Goals

The platform should be:

- Language agnostic
- Plugin driven
- Protocol agnostic
- Secure
- Observable
- Extensible
- Easy to integrate
- Easy to self-host
- Easy to consume as a cloud service

See **Goals** for the full principle set, including the Agnostic by Design principle that
unifies the capability/protocol/language/framework agnosticism requirements.

---

# 3. Core Philosophy

Instead of exposing:

```
GET /customers
POST /orders
DELETE /products
```

Applications expose:

```
customer.read
customer.create
order.submit
inventory.update
```

(Browser automation capabilities like `browser.navigate` are exposed by the
`browser-runtime` plugin — backlog #12 — not by applications.)

Agents interact with **Capabilities**, never directly with APIs.

The gateway decides how those capabilities are executed. See **Capability System** for the
general definition and **Business/Platform/Runtime Capabilities** for how each type is
implemented.

---

# 4. High-Level Architecture

```
                    +----------------------+
                    |      AI Agent        |
                    +----------+-----------+
                               |
                    MCP / CLI / REST / WS
                               |
                     (Adapters)
                               |
                  +------------v------------+
                  |        Gateway          |
                  |  (Control Plane)        |
                  +------------+------------+
                               |
         +---------------------+----------------------+
         |                     |                      |
         |                     |                      |
+--------v-------+    +--------v-------+    +--------v-------+
| Capability     |    | Session        |    | Plugin         |
| Registry       |    | Manager        |    | Manager        |
+--------+-------+    +--------+-------+    +--------+-------+
         |                     |                     |
         +---------------------+---------------------+
                               |
                        Event Bus
                               |
        +----------------------+----------------------+
        |                      |                      |
+-------v------+      +--------v------+      +--------v------+
| Browser      |      | Backend       |      | Custom        |
| Runtime      |      | Runtime       |      | Runtime       |
| (Execution   |      | (Execution    |      | (Execution    |
|  Plane)      |      |  Plane)       |      |  Plane)       |
+-------+------+      +--------+------+      +--------+------+
        |                      |                      |
   Frontend SDK          Backend SDK            Other SDKs
        |                      |
 React/Angular/Vue      Node/Go/Rust/Python
```

The Gateway, Session Manager, Capability Registry, and Plugin Manager together form the
**Control Plane**. Runtimes form the **Execution Plane**. See **Terminology** for the
canonical definition of this split — this diagram reflects that terminology, superseding the
earlier "Data Plane" wording found in draft design notes.

---

# 5. Core Components

## Gateway

The Gateway is the entry point into the platform.

Responsibilities:

- Authentication
- Authorization
- Session creation
- Capability discovery
- Request routing
- Logging
- Metrics

The gateway **does not execute capabilities**.

Instead, it routes requests to the appropriate runtime. The Gateway is part of the Control
Plane — see **Section 9** for more detail.

---

## Session Manager

Responsible for:

- Creating sessions
- Managing browser instances
- Tracking active runtimes
- Managing temporary resources
- Cleanup

Sessions are execution contexts.

They are **not chat history**.

Sessions own the runtime resources created on their behalf — a browser instance, a Docker
container, temporary files — so that destroying a session cleans all of them up
automatically, rather than requiring each runtime to track cleanup independently.

---

## Capability Registry

Maintains every capability available to the platform.

Example:

```
customer.read
customer.create
browser.navigate
browser.click
docker.run
git.commit
```

The registry is queried by:

- Gateway
- CLI
- MCP Adapter
- Dashboard

Applications and runtime plugins register in bulk via a **Capability Manifest** or **Runtime
Manifest** respectively, rather than one capability at a time — see **Terminology** for the
manifest formats.

---

## Plugin Manager

Loads plugins dynamically.

Responsible for:

- Installing plugins
- Updating plugins
- Removing plugins
- Dependency resolution

Removing a plugin should never require changing core platform code.

Plugins conform to the Plugin Manifest format (see **Terminology → Plugin Manifest**).
Discovery and distribution of plugins not yet installed on a given Gateway is handled by the
**Plugin Marketplace** — a registry with tiered trust levels (Official/Verified/Community),
a publishing pipeline, and a private-source install path for unpublished, customer-built
plugins. See **Plugin Marketplace** for the full design.

---

## Event Bus

Allows components to communicate without tight coupling.

Example:

```
Browser Runtime

↓

browser.page.loaded

↓

Analytics Plugin
Debugger
Logger
```

Everything communicates through events instead of direct dependencies.

---

# 6. SDKs

The SDKs allow applications to expose capabilities.

They are installed directly into developer applications. "Backend SDK" and "Frontend SDK"
are roles, not package names — see **Terminology → SDK** for the full per-language package
table. The reference implementation, in order:

```
npm install @platform/sdk-node        (Backend SDK, Node/TypeScript — first, Phase 3)
```

Later, once additional backend languages ship (Phase 8):

```
pip install platform-sdk-python
```

```
cargo add platform-sdk-rust
```

```
npm install @platform/sdk-browser     (Frontend SDK)
```

---

## Backend SDK (role)

Responsibilities:

- Register capabilities
- Authenticate with Gateway
- Execute capability handlers
- Emit events

Example:

```
customer.read

↓

Fetch customer

↓

Return result
```

The first concrete implementation of this role is `@platform/sdk-node` (Phase 3). Additional
per-language implementations (`platform-sdk-python`, `platform-sdk-go`,
`platform-sdk-rust`, `platform-sdk-java`, `platform-sdk-dotnet`) follow the same role and
responsibilities, built in Phase 8.

---

## Frontend SDK

Runs inside browser applications. Concrete package: `@platform/sdk-browser`.

Responsibilities:

- Register application capabilities from the page (DOM-annotation model —
  annotated elements carry `data-sdk-*` attributes; see **Capability System**
  and the sdk-browser wayfinder map)
- UI state: the live, dev-controlled catalog of the page's annotated
  capabilities, scoped to the current page. The SDK keeps it in sync with the
  DOM (initial scan on `createSdk()` + `MutationObserver` walking
  `data-sdk-cap`), so the Gateway always sees what the page currently exposes
  — it is *not* a separate state object or store
- Browser communication: WebSocket transport to the Gateway (same wire
  protocol as the Backend SDK)
- Dispatch capability invocations back to the page as DOM events (CustomEvent
  fan-out; the app's own listeners handle them)

Example capabilities:

```
customer.read
order.submit
```

**Boundary at a glance:** the Frontend SDK is installed *inside* the app and
registers capabilities owned by the app — same role as `@platform/sdk-node`
in a Node app. Browser automation capabilities (`browser.*`) are provided by
`browser-runtime` (Runtime Plugin, backlog #12), not by the SDK.

---

# 7. Runtimes

The Gateway never executes work directly.

Execution happens inside runtimes, which together form the Execution Plane (see
**Terminology**).

## Browser Runtime

**Status: not yet built (backlog #12).** Specified to be responsible for:

- Launching browsers
- Managing tabs
- Navigation
- DOM interaction
- Screenshots

---

## Backend Runtime

**Status: built.** Executes backend capabilities.

Example:

```
customer.read

↓

Node Application

↓

Database
```

---

## Future Runtimes

- Docker Runtime
- Git Runtime
- File Runtime
- Kubernetes Runtime
- Database Runtime

**Status: not yet built.** Each runtime is a plugin, and each is named repeatedly across
Runtime Capabilities' namespace examples as if it already exists — that's aspirational, not
current state.

**Ownership model (addressing drift item #6):** future runtimes fall into one of three
ownership tracks, and each one should be labeled with which track it's on before work begins:

- **Core-team-built** — runtimes that are foundational enough (widely needed, security- or
  resource-sensitive) that the platform team builds and maintains them directly. Docker
  Runtime is a plausible candidate here, given container access has broad security
  implications.
- **Community-contributed** — runtimes built and maintained by outside contributors,
  published through the plugin distribution mechanism once one exists (see #5). Suited to
  runtimes with a narrower or more specialized audience.
- **Customer-built** — a customer builds a runtime plugin for their own internal use,
  installed only on their own self-hosted Gateway, never published anywhere.

No future runtime currently has a track assigned. This should happen before — not after —
implementation begins, since it affects where the code lives, who reviews it, and what
distribution mechanism it needs.

**Git Runtime implementation notes (addressing drift item #7):** when Git Runtime is built,
under whichever ownership track it lands on, its handlers should be implemented against a
native Git library (e.g. `isomorphic-git`, or bindings to `libgit2`) rather than shelling out
to the `git` CLI and parsing stdout. Runtime Capabilities requires structured inputs, outputs,
and errors from every handler; a CLI wrapper fights that requirement (parsing text output,
inconsistent formats across git versions), while a library gives a native structured
input/output/error contract. This is stated here as the default recommendation for Git
Runtime specifically, and as a general convention worth applying to any future runtime that
wraps an existing CLI tool.

---

# 8. Adapters

Adapters expose the platform to external clients.

Adapters contain **no business logic**.

They only translate protocols.

---

## MCP Adapter

Allows MCP-compatible agents to communicate with the Gateway.

---

## CLI Adapter

Allows developers to execute:

```
platform capabilities

platform sessions

platform browser

platform plugins
```

---

## REST Adapter

Useful for integrations.

---

## WebSocket Adapter

Useful for streaming.

---

## Future Adapters

- GraphQL
- gRPC
- VSCode
- JetBrains
- Slack
- Discord
- Teams

---

# 9. Gateway

The Gateway is the control plane's primary entry point.

It should remain lightweight.

Responsibilities:

- Session lifecycle
- Authentication
- Authorization
- Capability lookup
- Routing
- Metrics

Avoid placing execution logic here.

**On the Control Plane / Execution Plane split:** the Gateway, together with the Session
Manager, Capability Registry, and Plugin Manager, forms the Control Plane — the layer that
decides *what* should happen and *whether it's allowed*. Runtimes form the Execution Plane —
the layer that decides *how* it happens. This can run as a single process internally; the
split is architectural, not necessarily a deployment boundary. See **Terminology → Control
Plane / Execution Plane** for the canonical definitions.

---

# 10. Plugin System

Everything should be pluggable.

Examples:

```
Browser Plugin

Git Plugin

Docker Plugin

Database Plugin

Analytics Plugin

Debugger Plugin
```

Each plugin registers:

- Capabilities
- Events
- Configuration

...typically via a Plugin Manifest published at startup (see **Terminology → Plugin
Manifest**). Plugins fall into three categories:

- **Runtime Plugins** — provide an execution environment (Browser, Docker, Git Runtime)
- **Service Plugins** — provide supporting functionality without executing capabilities
  (logging, analytics, auth providers)
- **Developer Plugins** — extend developer tooling rather than platform runtime behavior
  (Dashboard extensions, VS Code, Chrome DevTools — see **Section 14**)

No plugin should directly depend on another plugin. Plugins communicate exclusively through
the Event Bus.

---

# 11. Session Management

A Session represents an execution context.

A session may contain:

- Browser instances
- Runtime state
- Authentication tokens
- Temporary files
- Background jobs

Sessions are automatically cleaned when complete, including every runtime resource the
session owns (see **Section 5 → Session Manager**).

---

# 12. Capability System

Everything revolves around capabilities.

Every capability contains:

Name

Description

Input Schema

Output Schema

Permissions

Version

Execution Handler

Type (`business`, `platform`, or `runtime`)

Example:

```
customer.read

Description:
Read customer information.

Input:

{
    id: string
}

Output:

{
    customer
}
```

For the full abstract definition, the capability lifecycle, and the classification test for
which type a new capability belongs to, see the dedicated **Capability System** document.
For concrete implementation detail per type, see **Business Capabilities**, **Platform
Capabilities**, and **Runtime Capabilities** — the latter of which defines the
read/act/destructive permission tiering convention that should be applied to any capability
whose actions vary meaningfully in risk.

---

# 13. Event Bus

Every component emits events.

Example:

```
Browser Opened

↓

browser.started

↓

Debugger

↓

Logger

↓

Analytics
```

This keeps plugins independent.

---

# 14. Dashboard

The Dashboard is a first-class product, not an auxiliary admin tool — it is the "Task
Manager" for the platform, and every developer working against the platform is expected to
use it regularly, not just administrators.

## Core Features

- Active Sessions
- Browser Instances
- Installed Plugins
- Registered Capabilities
- Runtime Health
- Metrics
- Logs
- Errors

## Extended Tooling

Beyond the web dashboard itself, two developer-tooling integrations extend the same
visibility into other environments developers already work in:

**Chrome DevTools Extension.** Surfaces platform activity directly inside the browser a
developer is already debugging in — active sessions, registered capabilities, browser
events, a capability execution timeline, performance data, and runtime logs, without
switching to a separate dashboard tab.

**VS Code Extension.** Brings platform awareness into the editor:

- Capability autocomplete while writing handler code
- Manifest validation (catching malformed Capability/Runtime Manifests before deploy)
- Runtime inspection
- Session debugging
- Gateway connection management
- Plugin management

Both extensions are Developer Plugins (see **Section 10**) — they extend developer tooling,
not platform runtime behavior, and are appropriate places for the community to contribute
given their lower security surface compared to Runtime Plugins.

---

# 15. Deployment Models

## Hosted Platform

Platform is provided as SaaS.

Developers:

Install SDK

↓

Register capabilities

↓

Gateway hosted by platform

In hosted deployments, write-tier Platform Capability permissions (e.g.
`platform.plugin.install`) are reserved for the platform operator, not individual tenants —
see **Platform Capabilities → Permission Ownership by Deployment Model** for the full
breakdown.

---

## Self Hosted

Organizations install:

Gateway

Session Manager

Plugin Manager

Dashboard

Internally.

In self-hosted deployments, the organization running the Gateway is the platform operator,
and may hold the full range of `platform.*` permissions — there is no separate tenant to
protect against.

---

# 16. Ownership Model

Every feature added to the platform should clearly belong to one of five ownership
boundaries. If ownership is unclear, the design should be reconsidered before implementation
proceeds.

```
Applications        own    Business Logic
Platform            owns   Coordination
Runtimes            own    Execution
Adapters            own    Communication
Plugins             own    Extensibility
```

A quick classification test for a new feature proposal:

- A Git integration? → Runtime Plugin (owns: Execution)
- A Slack integration? → Adapter or Service Plugin (owns: Communication or Extensibility)
- A browser tab? → Session Resource, owned by the Browser Runtime (owns: Execution)
- A REST endpoint? → Adapter (owns: Communication)
- A database query inside your app? → Capability Handler (owns: Business Logic)
- A new way to install plugins? → Plugin Manager, Control Plane (owns: Coordination)

This test, combined with the Capability System's "what does it touch?" test for classifying
capabilities (see **Capability System → Capability Types**), should resolve the large
majority of "where does this belong?" questions that come up as the platform grows.

---

# 17. Implementation Roadmap

## Phase 1

Core Platform

- Plugin Manager
- Capability Registry
- Session Manager
- Event Bus

---

## Phase 2

Gateway

- Authentication
- Sessions
- Capability Discovery
- Routing

---

## Phase 3

Backend SDK — Node/TypeScript

Package: `@platform/sdk-node`

---

## Phase 4

Frontend SDK

- Browser communication
- Navigation
- UI actions

---

## Phase 5

Browser Runtime

- Launch browser
- Tabs
- Navigation
- DOM interaction

---

## Phase 6

Adapters

- CLI
- MCP
- REST
- WebSocket

---

## Phase 7

Dashboard

- Sessions
- Capabilities
- Metrics
- Browser Inspector

---

## Phase 8

Additional Backend SDKs (same role as Phase 3, additional languages)

- Go — `platform-sdk-go`
- Python — `platform-sdk-python`
- Rust — `platform-sdk-rust`
- Java — `platform-sdk-java`
- .NET — `platform-sdk-dotnet` (NuGet: `Platform.Sdk`)

---

## Phase 9 (unscheduled — ownership track required before scheduling)

Future Runtimes

- Docker Runtime
- Git Runtime
- File Runtime
- Kubernetes Runtime
- Database Runtime

Per **Section 7**, none of these should move from "future" to a scheduled phase until an
ownership track (core-team / community / customer-built) is assigned. This phase exists as a
placeholder so the roadmap doesn't imply these are further along than they are.

---

## Phase 10

Plugin Marketplace

- Public plugin registry with trust tiers (Official / Verified / Community)
- Manifest validation and publishing flow
- `marketplace.search` / `marketplace.describe` / `marketplace.versions` Platform Capabilities
- Signature/checksum verification on install
- Private-source install path for customer-built, unpublished plugins

Design complete — see **Plugin Marketplace**. Scheduling still depends on Phase 9's future
runtimes actually being assigned ownership tracks, since the marketplace's Verified tier is
largely how community-contributed runtimes would reach a Gateway.

---

# Final Philosophy

The platform should be thought of as an **Agent Runtime Operating System**.

It provides:

- A unified capability model
- A plugin architecture
- Language-agnostic SDKs
- Multiple protocol adapters
- Browser automation
- Session management
- Runtime orchestration

MCP is simply one adapter into this ecosystem—not the foundation itself.

The long-term vision is to enable developers to build applications once, expose capabilities
once, and allow any AI agent to interact with those capabilities securely through a
consistent, extensible platform.
