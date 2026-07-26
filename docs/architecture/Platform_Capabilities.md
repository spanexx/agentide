# Platform Capabilities

> **Revision note (this pass):** Adds an explicit SaaS vs. self-hosted permission model
> (drift item #4), previously only implied and never stated. Cross-references Capability
> System for the general capability schema instead of restating it.

## Overview

Platform Capabilities are capabilities provided by the Agent Runtime Platform itself.

Unlike Business Capabilities, which are implemented by applications, Platform Capabilities
expose the internal services of the platform.

They allow AI agents, developers, dashboards, and adapters to interact with the platform in
a standardized way.

Examples include:

```
session.create

session.list

session.close

plugin.list

plugin.install

plugin.uninstall

runtime.health

runtime.list

gateway.status

capability.list
```

These capabilities are built into the platform and are always available, regardless of the
connected applications. For the general capability schema (name, description, version,
input/output schema, permissions, handler) that applies to every capability type, see
**Capability System**.

---

# Purpose

The platform itself performs many operations that are not related to an application's
business logic.

Examples include:

- Managing sessions
- Listing installed plugins
- Inspecting runtimes
- Discovering capabilities
- Checking platform health
- Monitoring resources

Instead of exposing these through private APIs, the platform exposes them as capabilities.

This creates a consistent interaction model.

Everything—whether application functionality or platform functionality—is accessed through
capabilities.

---

# Characteristics

Platform Capabilities are:

- Implemented by the platform
- Available to all adapters
- Managed by the Gateway
- Independent of applications
- Permission protected
- Discoverable

Unlike Business Capabilities, they do not belong to any developer application.

---

# Capability Categories

Platform Capabilities are grouped by domain.

```
session.*

plugin.*

marketplace.*

runtime.*

gateway.*

capability.*

dashboard.*

system.*
```

Each domain represents a core subsystem of the platform.

---

# Session Capabilities

The Session Manager exposes capabilities for managing execution contexts.

Examples:

```
session.create

session.get

session.list

session.update

session.close

session.destroy
```

Example:

```
session.create

↓

Gateway

↓

Session Manager

↓

New Session

↓

Session ID
```

These capabilities allow adapters and dashboards to manage active sessions.

---

# Plugin Capabilities

The Plugin Manager exposes capabilities for managing installed plugins.

Examples:

```
plugin.list

plugin.install

plugin.uninstall

plugin.enable

plugin.disable

plugin.reload
```

Example:

```
plugin.list

↓

Plugin Manager

↓

Installed Plugins
```

---

# Marketplace Capabilities

The Plugin Marketplace exposes read-only discovery of plugins available to install — as
opposed to `plugin.list`, which covers plugins already installed on this Gateway. See
**Plugin Marketplace** for the full design, including trust tiers and the publishing
pipeline.

Examples:

```
marketplace.search

marketplace.describe

marketplace.versions
```

Example:

```
marketplace.search "git"

↓

Plugin Registry

↓

Matching entries with trust tier and latest version
```

Unlike `plugin.install`, these are deliberately low-permission and widely grantable:

```yaml
permissions:
  - platform.marketplace.read
```

Browsing what exists should not require the elevated trust that actually installing something
does — that gate remains entirely on `plugin.install`, whose permission model is unchanged by
the marketplace's existence (see **Permission Ownership by Deployment Model** below).

---

# Runtime Capabilities (Platform-Owned)

The Runtime Manager exposes information about execution environments. Note: these are
*platform-owned* capabilities for managing runtimes (e.g. checking health, restarting) —
distinct from the *Runtime Capabilities* type described in the dedicated Runtime Capabilities
document, which covers capabilities like `browser.navigate` that a runtime itself exposes for
agents to use.

Examples:

```
runtime.list

runtime.health

runtime.metrics

runtime.restart

runtime.logs
```

Example:

```
runtime.health

↓

Runtime Manager

↓

Browser Runtime

↓

Healthy
```

These capabilities help monitor runtime availability.

---

# Gateway Capabilities

The Gateway exposes capabilities related to its own operation.

Examples:

```
gateway.status

gateway.metrics

gateway.version

gateway.configuration
```

These capabilities are primarily used by dashboards and administrators.

---

# Capability Registry Capabilities

The Capability Registry exposes discovery features.

Examples:

```
capability.list

capability.search

capability.describe

capability.version
```

Example:

```
capability.list

↓

Capability Registry

↓

All Registered Capabilities
```

This allows AI agents to discover available functionality dynamically.

---

# System Capabilities

The platform may expose general system information.

Examples:

```
system.info

system.version

system.health

system.metrics
```

These capabilities provide operational visibility into the platform.

---

# Example Metadata

```yaml
name: runtime.health
type: platform
description: Returns the health status of all registered runtimes.
permissions:
  - platform.runtime.read
runtime: gateway
```

Notice the `type` is `platform`, distinguishing it from business or runtime capabilities.

---

# Execution Flow

Platform Capabilities are typically handled directly by platform services.

```
AI Agent

↓

runtime.health

↓

Gateway

↓

Runtime Manager

↓

Health Check

↓

Response
```

Unlike Business Capabilities, no application is involved.

---

# Discovery

Platform Capabilities appear alongside other capabilities during discovery.

Example:

```json
[
  {
    "name": "session.create",
    "type": "platform"
  },
  {
    "name": "plugin.list",
    "type": "platform"
  },
  {
    "name": "customer.read",
    "type": "business"
  },
  {
    "name": "browser.navigate",
    "type": "runtime"
  }
]
```

Agents can understand not only what applications can do, but also what the platform itself
can do.

---

# Permissions

Because Platform Capabilities control the platform, they should require elevated
permissions.

Example:

```yaml
permissions:
  - platform.admin
```

Or more granular permissions:

```yaml
permissions:
  - platform.plugin.read
```

```yaml
permissions:
  - platform.plugin.install
```

```yaml
permissions:
  - platform.session.manage
```

Fine-grained permissions reduce security risks.

---

# Permission Ownership by Deployment Model

Platform Capability permissions — particularly write-tier ones like `platform.plugin.install`
or `platform.session.manage` — are not granted uniformly across deployment models. Who holds
them depends on who operates the Gateway (see **Agentide → Deployment Models**):

## Self-Hosted

The organization running the Gateway *is* the platform operator. Whoever administers that
deployment may hold the full range of `platform.*` permissions, including
`platform.plugin.install`, `platform.plugin.uninstall`, and `platform.admin`. There is no
separate "tenant" to protect against — the operator and the consumer of the platform are the
same party.

## Hosted (SaaS)

The platform provider operates a shared Gateway serving multiple customers. In this model:

- **Reserved for the platform operator only:** all write-tier `platform.plugin.*`
  permissions (`plugin.install`, `plugin.uninstall`, `plugin.enable`, `plugin.disable`,
  `plugin.reload`), and any capability that would affect the shared infrastructure other
  tenants also depend on. A customer installing an arbitrary plugin into a shared Gateway
  could affect every other tenant's applications — this is treated as an infrastructure
  change, not a tenant-scoped action.
- **Available to tenant applications:** registering their own Business Capabilities (ordinary
  SDK usage, not a `platform.*` permission at all), plus read-tier platform visibility such as
  `platform.plugin.read` or `platform.runtime.read`, scoped to what's relevant to that
  tenant's own sessions.
- **Session-scoped permissions** (e.g. `platform.session.manage`) may be granted to a tenant,
  but only for sessions belonging to that tenant — never platform-wide.

This split is not yet reflected in the permission examples elsewhere in this document, which
were written before hosted/self-hosted was considered a distinguishing factor. As a
convention going forward, any new Platform Capability's documentation should state which
deployment models it's available in, not just which permission scope it requires.

*(See also: Terminology → Tenant, which flags multi-tenancy as not yet formally designed.
This section describes the intended direction, not a finished specification — full tenant
isolation semantics remain open.)*

---

# Events

Platform Capabilities emit lifecycle events.

Examples:

```
session.created

session.destroyed

plugin.installed

plugin.uninstalled

runtime.started

runtime.stopped

gateway.started

gateway.shutdown
```

These events can be consumed by:

- Dashboard
- Monitoring
- Audit logs
- Notification services
- Analytics

---

# Best Practices

Platform Capabilities should:

- Be read-only where possible.
- Be highly observable.
- Return structured responses.
- Avoid exposing implementation details.
- Be protected by strict permissions.
- Be available regardless of connected applications.
- State which deployment models (self-hosted, hosted) they're available in.

---

# Anti-Patterns

Avoid:

- Mixing platform operations with business logic.
- Allowing applications to override platform capabilities.
- Exposing sensitive configuration by default.
- Using platform capabilities to manipulate application data.
- Granting write-tier `platform.plugin.*` or similar infrastructure-affecting permissions to
  individual tenants in a hosted deployment.

Platform Capabilities manage the platform—not the applications running on it.

---

# Example Use Cases

### Dashboard

The dashboard periodically calls:

```
runtime.health

↓

plugin.list

↓

session.list
```

to display the current state of the platform.

---

### CLI

The CLI executes:

```
plugin.install

plugin.list

gateway.status
```

to help administrators manage the platform. In a self-hosted deployment, this is the
organization's own administrator. In a hosted deployment, this is the platform provider's
internal tooling — not a customer-facing CLI command.

---

### AI Agent

An AI agent can ask:

```
capability.list
```

to discover everything it can interact with before attempting any task.

---

# Relationship to Other Capability Types

The platform defines three capability categories:

| Type | Implemented By | Purpose |
|------|----------------|---------|
| **Business** | Application | Execute business logic |
| **Platform** | Platform Core | Manage and inspect the platform |
| **Runtime** | Runtime Plugins | Execute environment-specific actions |

Examples:

```
customer.read
```

→ Business Capability

```
session.create
```

→ Platform Capability

```
browser.navigate
```

→ Runtime Capability

This separation keeps responsibilities clear and allows each category to evolve
independently.

---

# Summary

Platform Capabilities provide a consistent, capability-based interface to the platform
itself.

Rather than exposing internal management APIs, the platform treats its own functionality as
discoverable capabilities.

This ensures that applications, dashboards, CLIs, and AI agents all interact with the
platform using the same conceptual model: **everything is a capability** — while recognizing
that *who is allowed to invoke which platform capability* depends on whether the Gateway is
self-hosted or shared SaaS infrastructure.
