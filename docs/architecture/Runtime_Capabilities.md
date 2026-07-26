# Runtime Capabilities

> **Revision note (this pass):** Adds a permission tiering convention (drift item #3) so
> Runtime Capabilities carries the same read/write discipline Platform Capabilities already
> has. Cross-references Capability System for the general capability schema instead of
> restating it. Cross-references Terminology for Execution Plane / Runtime Plugin
> definitions.

## Overview

Runtime Capabilities are capabilities exposed by **Runtime Plugins**, part of the
**Execution Plane** (see Terminology).

Unlike Business Capabilities, which belong to applications, and Platform Capabilities, which
belong to the platform core, Runtime Capabilities are provided by execution environments.

A Runtime Capability performs work against a specific environment or external system.

Examples include:

```
browser.navigate

browser.click

browser.type

browser.screenshot

docker.run

docker.stop

docker.logs

git.clone

git.commit

git.push

filesystem.read

filesystem.write

database.query
```

Every Runtime Capability belongs to exactly one Runtime Plugin. For the general capability
schema (name, description, version, input/output schema, permissions, handler) that applies
to every capability type, see **Capability System**.

---

# Purpose

Runtime Capabilities provide reusable execution environments that applications and AI agents
can leverage without implementing them themselves.

Instead of every application implementing browser automation, Docker management, or Git
integration, these capabilities are provided by reusable runtime plugins.

For example:

```
browser.navigate
```

does not belong to an e-commerce application.

It belongs to the Browser Runtime.

Likewise,

```
docker.run
```

belongs to the Docker Runtime.

This separation keeps applications focused on business logic while runtimes provide
infrastructure capabilities.

---

# Characteristics

Runtime Capabilities are:

- Implemented by Runtime Plugins
- Independent of applications
- Discoverable
- Permission-aware (see **Permissions and Risk Tiers** below)
- Session-aware
- Reusable across applications
- Executed by the owning runtime

---

# Runtime Namespaces

Each runtime owns its own namespace.

## Browser Runtime

```
browser.navigate

browser.click

browser.type

browser.scroll

browser.wait

browser.screenshot

browser.close
```

## Docker Runtime

```
docker.run

docker.stop

docker.restart

docker.logs

docker.exec

docker.remove
```

## Git Runtime

```
git.clone

git.checkout

git.commit

git.push

git.pull

git.branch
```

*(Note: Git Runtime is not yet built — see the project drift/issue log, items #6 and #7, for
open questions on ownership and implementation approach, e.g. shelling out to the git CLI vs.
a library such as `isomorphic-git`.)*

## Filesystem Runtime

```
filesystem.read

filesystem.write

filesystem.move

filesystem.delete

filesystem.list
```

## Database Runtime

```
database.query

database.transaction.begin

database.transaction.commit

database.transaction.rollback
```

Each namespace clearly identifies the runtime responsible for execution.

---

# Runtime Registration

When a runtime starts, it registers its capabilities with the Capability Registry, typically
via a Runtime Manifest (see **Terminology → Plugin Manifest**):

```yaml
runtime:
  id: browser
version: 1.0
capabilities:
  - browser.navigate
  - browser.click
  - browser.type
```

This makes runtime capabilities discoverable just like any other capability.

---

# Capability Metadata

Example:

```yaml
name: browser.navigate
type: runtime
runtime: browser
description: Navigate the current browser tab to a URL.
permissions:
  - runtime.browser.act
input:
  url: string
output:
  success: boolean
```

(Note the permission scope `runtime.browser.act`, not a single flat `runtime.browser.navigate`
— see **Permissions and Risk Tiers** below for why.)

---

# Execution Flow

Unlike Business Capabilities, Runtime Capabilities never execute inside an application.

Example:

```
AI Agent

↓

browser.navigate

↓

Gateway

↓

Browser Runtime

↓

Browser Instance

↓

Navigation

↓

Response
```

The application is not involved.

---

# Session Awareness

Most Runtime Capabilities execute within a session.

Example:

```
Session

↓

Browser Instance

↓

Tab

↓

browser.click
```

The Browser Runtime retrieves the browser associated with the current session before
executing the request.

Without sessions, every browser action would require launching a new browser.

---

# Resource Ownership

Each runtime owns its own resources.

Example:

Browser Runtime owns:

- Browsers
- Tabs
- Cookies
- Local Storage
- Downloads

Docker Runtime owns:

- Containers
- Networks
- Images
- Volumes

Git Runtime owns:

- Repositories
- Branches
- Working Trees

No runtime should manipulate resources owned by another runtime.

---

# Runtime Isolation

Runtimes are isolated from one another.

For example:

```
Browser Runtime

≠

Docker Runtime
```

They communicate through the Event Bus rather than direct dependencies.

---

# Events

Runtime Capabilities emit lifecycle events.

Examples:

```
browser.started

browser.closed

browser.navigation.completed

docker.container.started

docker.container.stopped

git.commit.created
```

Other plugins may subscribe without modifying runtime code.

Examples:

- Dashboard
- Logger
- Analytics
- Metrics
- Audit Trail

---

# Permissions and Risk Tiers

Runtime Capabilities within a single namespace vary widely in risk. A screenshot is
read-only and reversible. A click can submit an order, delete a record, or push a commit —
irreversible, state-changing actions. Granting access to "the Browser Runtime" as a single
undifferentiated scope means granting access to both at once, with no way to separate them.

To close this gap, Runtime Capabilities adopt the same tiering discipline Platform
Capabilities already applies to its own subsystems (see **Platform Capabilities →
Permissions**), using three tiers instead of Platform's two, because runtime actions include
a distinct destructive category that platform management actions generally don't:

```
runtime.<namespace>.read          — observe only, no state change
runtime.<namespace>.act           — perform a normal, typically reversible action
runtime.<namespace>.destructive   — perform an irreversible or high-impact action
```

Worked examples:

| Capability | Tier | Scope |
|---|---|---|
| `browser.screenshot` | read | `runtime.browser.read` |
| `browser.navigate` | act | `runtime.browser.act` |
| `browser.click` | act | `runtime.browser.act` |
| `docker.logs` | read | `runtime.docker.read` |
| `docker.run` | act | `runtime.docker.act` |
| `docker.remove` | destructive | `runtime.docker.destructive` |
| `git.branch` (list) | read | `runtime.git.read` |
| `git.commit` | act | `runtime.git.act` |
| `git.push` | destructive | `runtime.git.destructive` |
| `filesystem.list` | read | `runtime.filesystem.read` |
| `filesystem.write` | act | `runtime.filesystem.act` |
| `filesystem.delete` | destructive | `runtime.filesystem.destructive` |

Not every capability needs a destructive tier — `browser.*` has no natural destructive action
today beyond `browser.close`, which is arguably still just `act`. Runtime plugin authors
should apply judgment: if an action is irreversible or has significant blast radius outside
the current session, it belongs in `destructive`; otherwise `act` is sufficient.

An agent scoped to `runtime.browser.read` and `runtime.browser.act` but not
`runtime.docker.destructive` can browse and take screenshots freely, click through a checkout
flow, but cannot tear down a Docker container — a materially safer default than one flat
`runtime.*` grant per plugin.

This convention is new as of this revision. Existing single-scope examples elsewhere in the
doc set (e.g. earlier drafts using `runtime.git.commit` directly as a scope name) should be
migrated to the tiered form above.

---

# Capability Composition

Runtime Capabilities can be composed with Business Capabilities.

Example:

```
customer.read

↓

browser.navigate

↓

browser.click

↓

order.submit

↓

browser.screenshot
```

Each capability executes independently while the session maintains context.

---

# Error Handling

Runtime errors should return structured responses.

Example:

```json
{
    "code": "BROWSER_NOT_FOUND",
    "message": "No active browser exists for this session."
}
```

Avoid exposing implementation details such as stack traces.

---

# Runtime Lifecycle

A runtime follows a defined lifecycle.

```
Installed

↓

Loaded

↓

Initialized

↓

Registers Capabilities

↓

Running

↓

Stopped

↓

Unloaded
```

Capabilities become unavailable when their runtime stops.

---

# Best Practices

Runtime Capabilities should:

- Perform one task.
- Own their resources.
- Be session-aware.
- Emit lifecycle events.
- Validate inputs.
- Return structured outputs.
- Clean up resources automatically.
- Declare a permission tier (`read`, `act`, or `destructive`) appropriate to their impact.
- Never contain application business logic.

---

# Anti-Patterns

Avoid Runtime Capabilities that:

- Depend on Business Capabilities.
- Modify platform configuration.
- Perform multiple unrelated actions.
- Bypass session management.
- Access another runtime's resources directly.
- Default to a broad or destructive permission tier when a narrower one would do.

For example:

Bad:

```
browser.checkoutOrder
```

This belongs in the application as a Business Capability.

Good:

```
browser.click
```

```
browser.navigate
```

These are generic browser operations.

---

# Example: Browser Runtime

The Browser Runtime may expose:

```
browser.launch

browser.close

browser.navigate

browser.reload

browser.back

browser.forward

browser.click

browser.doubleClick

browser.hover

browser.type

browser.pressKey

browser.select

browser.scroll

browser.wait

browser.screenshot

browser.download

browser.upload

browser.cookies.get

browser.cookies.set
```

These capabilities are reusable across every application integrated with the platform. Under
the tiering convention above, `browser.screenshot` and `browser.cookies.get` would sit at
`read`; most interaction capabilities (`click`, `type`, `navigate`, `select`) sit at `act`;
none currently rise to `destructive`.

---

# Relationship to Other Capability Types

The platform defines three capability categories (see **Capability System → Capability
Types** for the full classification test):

| Type | Owner | Purpose |
|------|-------|---------|
| **Business** | Application | Execute domain-specific business logic |
| **Platform** | Platform Core | Manage and observe the platform |
| **Runtime** | Runtime Plugins | Interact with execution environments |

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

Each category has a single responsibility and a clear ownership model.

---

# Summary

Runtime Capabilities provide reusable execution environments for AI agents.

They abstract infrastructure concerns—such as browser automation, container management, file
systems, and version control—into discoverable, secure capabilities.

Applications remain focused on business logic, while runtime plugins provide the
infrastructure needed to execute tasks across diverse environments. The read/act/destructive
permission tiering introduced in this revision ensures that reusability doesn't come at the
cost of coarse, all-or-nothing access — an agent can be scoped precisely to what a task
actually requires.

Together with Business and Platform Capabilities, Runtime Capabilities complete the
platform's unified capability model, ensuring that **every action, regardless of its origin,
is represented as a capability**.
