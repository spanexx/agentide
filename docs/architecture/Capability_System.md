# Capability System

> **Revision note (this pass):** Completes the doc (previously cut off mid-sentence at
> "Every capability contains metadata" — drift item #1). This document is now the canonical,
> abstract definition of what a capability *is*, in general — independent of who owns it.
> For the concrete implementation of each capability type, see the three specialized docs:
> **Business Capabilities**, **Platform Capabilities**, and **Runtime Capabilities**. This
> doc should not duplicate their worked examples; they should not duplicate this doc's
> general schema.

## Overview

The Capability System is the heart of the Agent Runtime Platform.

Every interaction between an AI agent and an application is expressed as a capability.

The platform does not expose REST endpoints, controller methods, database operations, or
browser selectors. Instead, it exposes meaningful business actions called **Capabilities**.

This abstraction allows AI agents to interact with applications without knowing their
internal implementation.

---

# What is a Capability?

A Capability is a unit of work that an application, the platform, or a runtime plugin
intentionally exposes to the platform.

Think of it as a contract between whoever owns the capability and the AI agent invoking it.

Examples:

```
customer.read

customer.update

product.search

cart.add

checkout.start

browser.navigate

browser.click
```

Capabilities describe **intent**, not implementation.

---

# Why Capabilities?

Traditional APIs expose implementation.

```
GET /customers/:id

POST /orders

PATCH /products
```

An AI agent has to understand:

- URLs
- HTTP Methods
- Authentication
- Request formats
- Response formats

The platform removes this complexity.

Instead:

```
customer.read

↓

Platform

↓

Application
```

The owner of the capability decides how it is executed. The agent never needs to know.

---

# Capability Naming

Capabilities follow a consistent naming convention.

```
<domain>.<action>
```

Examples:

```
customer.read

customer.create

customer.update

customer.delete
```

```
order.submit

order.cancel

order.refund
```

```
browser.navigate

browser.click

browser.type
```

This naming convention makes capabilities predictable and discoverable, and it applies
uniformly across all three capability types — the domain simply signals ownership context
(e.g. `browser.*` signals the Browser Runtime, `session.*` signals the platform core), while
the action is always a single, focused verb.

Avoid names that leak implementation vocabulary instead of intent — e.g. `database.query`,
`http.post`, `controller.run`. A capability name should read as a business or environment
action, never as a technical operation. See **Business Capabilities → Naming Guidelines** for
the fuller set of anti-patterns.

---

# Capability Structure

Every capability, regardless of type, is defined by the same seven pieces of metadata:

| Field | Purpose |
|---|---|
| **Name** | The `<domain>.<action>` identifier agents use to invoke it |
| **Description** | Human- and agent-readable explanation of what it does |
| **Version** | Supports parallel versions during migration (e.g. `customer.read` v1 and v2) |
| **Input Schema** | What the capability accepts, validated before execution |
| **Output Schema** | The structure the capability guarantees on success |
| **Permissions** | The scope(s) required to invoke it |
| **Execution Handler** | The function that actually performs the work |

A capability also carries a **Type** field — `business`, `platform`, or `runtime` — which
determines who implements the handler and where execution happens. See **Capability Types**
below.

This structure is intentionally minimal and constant across all three types. What differs
between types is *who writes the handler* and *where it executes* — not the shape of the
metadata itself. For the full worked schema with concrete field values, see the `type:
business` example in **Business Capabilities** (the fullest worked example in the doc set);
Platform and Runtime Capabilities follow the identical shape with `type: platform` and
`type: runtime` respectively.

---

# Capability Types

A capability belongs to exactly one of three types, distinguished by ownership:

| Type | Owned By | Handler Written By | Execution Path | Example |
|---|---|---|---|---|
| **Business** | The application | The application developer | `Gateway → Backend Runtime → Backend SDK → Application → Database` | `customer.read` |
| **Platform** | The platform core | The platform team | `Gateway → relevant Manager (Session/Plugin/Runtime) → Response` | `session.create` |
| **Runtime** | A runtime plugin | The plugin author | `Gateway → Runtime Plugin → external system` | `browser.navigate` |

A simple test for classifying a new capability: **what does it touch?**

- Touches your application's own domain data → **Business**
- Touches the platform's own internal state (sessions, plugins, runtime health) → **Platform**
- Touches an external execution environment (a browser, a container, a repository) →
  **Runtime**

Full detail, registration mechanics, and worked examples for each type live in their
dedicated documents:

- **Business Capabilities** — registration code, composition patterns, versioning,
  anti-patterns, a full e-commerce example
- **Platform Capabilities** — capability categories (`session.*`, `plugin.*`, `runtime.*`,
  `gateway.*`, `capability.*`, `system.*`), permission tiering, use cases
- **Runtime Capabilities** — namespace-per-runtime structure, session awareness, resource
  ownership rules, composition with Business Capabilities

---

# Capability Lifecycle

Every capability, regardless of type, moves through the same lifecycle:

```
Registered

↓

Validated

↓

Discovered

↓

Executed

↓

Completed
```

- **Registered** — the owner (application, platform core, or runtime plugin) declares the
  capability, typically via a manifest at startup (see **Terminology → Capability Manifest /
  Plugin Manifest**).
- **Validated** — the platform checks the capability's metadata is well-formed and its name
  doesn't collide with an existing registration.
- **Discovered** — the capability becomes visible in the Capability Registry, queryable via
  `capability.list` and `capability.search`.
- **Executed** — an agent invokes it; input is validated against the input schema before the
  handler runs.
- **Completed** — the handler returns a result matching the output schema, or a structured
  error; lifecycle events (`capability.started`, `capability.completed`, `capability.failed`)
  are emitted throughout.

---

# Discovery

Regardless of type, every capability is discoverable through the same interface, and a
discovery response mixes all three types together with their `type` field distinguishing
them:

```json
[
  { "name": "customer.read", "type": "business" },
  { "name": "session.create", "type": "platform" },
  { "name": "browser.navigate", "type": "runtime" }
]
```

This is what lets an AI agent call `capability.list` once and understand everything it can
do — what the connected application offers, what the platform itself offers, and what
execution environments are available — without needing three separate discovery mechanisms.

---

# Permissions

Every capability declares the permission scope(s) required to invoke it. The Gateway performs
authorization against these scopes before routing to the handler — no capability executes
without passing this check first.

Permission granularity is not identical across types today:

- **Platform Capabilities** model fine-grained read/write scopes for the same subsystem (e.g.
  `platform.plugin.read` vs. `platform.plugin.install`).
- **Business** and **Runtime Capabilities** currently use a single scope per action (e.g.
  `runtime.browser.navigate`), without a read/write split — see **Runtime Capabilities →
  Permissions** for the open question this raises for actions with mixed risk levels (a
  screenshot vs. a destructive click) within one namespace.

---

# Summary

The Capability System is the single abstraction the entire platform is built on. Every
action an AI agent can take — whether it touches an application's business logic, the
platform's own internals, or an external execution environment — is expressed the same way:
a named, versioned, permission-scoped, schema-validated unit of work.

The three capability types exist to give each of those three concerns a clear owner without
fragmenting the interface agents use to discover and invoke them. An agent calling
`capability.list` never needs to know or care which type it's looking at to understand what
it does — only the platform's internal routing cares, and that routing is exactly what the
`type` field exists to drive.
