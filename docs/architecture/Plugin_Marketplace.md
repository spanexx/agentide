# Plugin Marketplace

> **New document (this pass).** Resolves the last open item in the drift/issue log, #5: no
> doc previously specified where plugins come from. This document defines the manifest
> standard, registry, publishing flow, trust model, and installation resolution for
> distributing plugins beyond what a single Gateway builds in-house. It assumes familiarity
> with **Terminology → Plugin Manifest**, **Agentide → Section 7 (Future Runtimes, Ownership
> Model)**, and **Platform Capabilities → Permission Ownership by Deployment Model**.

---

# Why This Exists

The Plugin Manager can already install, update, and remove plugins. What was missing is
everything upstream of that: how a plugin gets published, how a Gateway discovers what's
available, and how much trust to extend to a plugin nobody on the platform team wrote.

This matters more for plugins than for Business Capabilities. A Business Capability handler
runs inside the developer's own application, in their own infrastructure — the platform never
executes their code. A **plugin**, by contrast, runs inside the platform itself, often with
access to real resources (browsers, containers, filesystems, credentials). A malicious or
careless plugin has a fundamentally larger blast radius than a malicious Business Capability.
The marketplace design below is built around that asymmetry.

---

# Registry Structure

The **Plugin Registry** is a public index of plugin manifests, conceptually similar to npm
or a Kubernetes Helm chart repository. Each entry is keyed by a globally unique plugin id and
tracks every published version.

A registry entry extends the Plugin Manifest (see **Terminology**) with marketplace-specific
metadata:

```yaml
runtime:
  id: git
version: 1.2.0
capabilities:
  - git.clone
  - git.commit
  - git.push

# Marketplace-specific fields, added on top of the base Plugin Manifest:
marketplace:
  author: "jane-dev"
  source: "https://github.com/jane-dev/agentide-git-runtime"
  license: "MIT"
  checksum: "sha256:9f2b..."
  signature: "..."          # required at Verified tier and above; see Trust Tiers
  trust_tier: "verified"    # official | verified | community
  published_at: "2026-06-01T00:00:00Z"
  deprecated: false
```

The registry itself is a **Control Plane–adjacent service** — it is not part of any single
Gateway. A Gateway queries the registry, but the registry's own trust decisions (see below)
are made independently of any one deployment.

---

# Trust Tiers

Every registry entry carries exactly one trust tier, and the tier is what determines both
review requirements and default visibility:

| Tier | Who builds it | Review | Signing required | Default visibility |
|---|---|---|---|---|
| **Official** | Platform core team | Full internal review | Yes, platform key | Visible and installable by default everywhere |
| **Verified** | Community, reviewed | Passed an automated + human review pass | Yes, author key registered with the registry | Visible by default; requires explicit `plugin.install` approval |
| **Community** | Anyone | Automated checks only (manifest validity, no code review) | Optional | Hidden by default; must be explicitly opted into per Gateway before it appears in search |

This tiering maps directly onto the ownership tracks defined in **Agentide → Section 7**:
core-team-built runtimes are published as Official; community-contributed runtimes are
published as Verified once reviewed (or sit as Community before/if they clear review);
customer-built runtimes are typically never published to the public registry at all — see
**Private and Unlisted Plugins** below.

**Verification is not a security guarantee, only a floor.** "Verified" means a reviewer
checked the manifest matches the declared capabilities, the code doesn't do anything
egregious on a static pass, and the author is a known identity — it is not a substitute for
an operator's own judgment about what they install on their Gateway.

---

# Publishing Flow

1. **Author writes a plugin** conforming to the Plugin Manifest schema and the relevant
   capability conventions (e.g. Runtime Capabilities' read/act/destructive permission
   tiering, if it's a Runtime Plugin).
2. **Author submits to the registry** with a manifest, source location, and license.
   Automated checks run immediately: manifest schema validation, capability name collision
   checks against existing registry entries, and a static scan for obviously disallowed
   behavior (e.g. undeclared network egress outside the plugin's stated resource ownership).
3. **Tier assignment.** Passing automated checks alone is sufficient for **Community** tier.
   To reach **Verified**, the submission additionally goes through human review — checking
   that the code's actual behavior matches its declared capabilities and permission tiers,
   and that resource ownership rules (see **Runtime Capabilities → Resource Ownership**) are
   respected, e.g. a Git Runtime plugin shouldn't be touching Docker resources.
4. **Signing.** Verified and Official entries are signed; Community entries may optionally be
   self-signed by the author but this is not independently checked.
5. **Publication.** The entry becomes queryable in the registry. Version updates go through
   the same pipeline — there is no fast path for updating an already-trusted plugin, since a
   previously safe plugin can turn malicious in a later version.
6. **Deprecation.** Authors (or the registry, for cause — e.g. a discovered vulnerability) can
   mark a version deprecated. Deprecated versions remain installable (for reproducibility) but
   are flagged in discovery results and excluded from "latest" resolution.

---

# Discovery

Plugin discovery is deliberately kept separate from Platform Capabilities' existing
`plugin.*` category, because `plugin.list` today means "what's installed on **this**
Gateway," while marketplace discovery means "what's available to install, possibly from
nowhere near this Gateway." Conflating the two would make `plugin.list` ambiguous.

New Platform Capability category: `marketplace.*`

```
marketplace.search       — query the registry by keyword/capability namespace
marketplace.describe     — full manifest + trust tier + review status for one plugin id
marketplace.versions     — list published versions of a given plugin id
```

These are **read-only** and, following the tiering convention from **Runtime Capabilities →
Permissions and Risk Tiers**, sit at the `read` level:

```yaml
permissions:
  - platform.marketplace.read
```

This is intentionally a low, widely-grantable permission — browsing what exists shouldn't
require elevated trust, only *installing* something should. That happens through the existing
`plugin.install` capability, whose permission model doesn't change:

```yaml
permissions:
  - platform.plugin.install
```

— still gated exactly as described in **Platform Capabilities → Permission Ownership by
Deployment Model**: operator-only in hosted/SaaS deployments, available to the self-hosted
administrator in self-hosted deployments.

Example discovery flow:

```
agent or developer

↓

marketplace.search "git"

↓

Registry

↓

[
  { id: "git", tier: "verified", latest: "1.2.0" },
  { id: "git-lfs-extras", tier: "community", latest: "0.3.1" }
]

↓

marketplace.describe "git"

↓

full manifest, capabilities, permissions, signature status

↓

(if authorized) plugin.install "git@1.2.0"
```

---

# Installation Resolution

When `plugin.install` is called with a registry id (as opposed to a local/private source —
see below), the Plugin Manager:

1. Resolves the id and version against the registry (defaulting to latest non-deprecated
   version if unspecified).
2. Fetches the manifest and verifies the **checksum**, and the **signature** if the plugin is
   Verified or Official tier. Community-tier plugins without a signature install with a
   surfaced warning, not a silent pass.
3. Checks the plugin's declared capabilities for **naming collisions** against capabilities
   already registered on this Gateway — installation fails rather than silently overwriting.
4. Checks **dependency requirements** the manifest declares (e.g. a minimum platform version).
5. Loads the plugin into the standard Runtime Plugin lifecycle (`Installed → Loaded →
   Initialized → Registers Capabilities → Running`, per **Runtime Capabilities → Runtime
   Lifecycle**).
6. Emits `plugin.installed` (already defined in **Platform Capabilities → Events**), now
   additionally carrying the plugin's trust tier and source registry, so audit logs capture
   not just *that* something was installed but *how trusted* it was at install time.

If any step fails, installation aborts before the plugin reaches the `Running` state — a
partially-installed plugin should never be reachable by the Capability Registry.

---

# Private and Unlisted Plugins

Not every plugin should go through the public registry. A customer-built runtime plugin
(**Agentide → Section 7**'s "customer-built" ownership track) is typically installed from a
private source — a private git repo, an internal artifact store, or a local file path — never
published anywhere.

`plugin.install` supports this as a first-class path, not just a registry lookup:

```
plugin.install --source <local-path-or-private-url>
```

Private-source installs skip the registry entirely — no trust tier, no signature check
against a registry key (though the operator may still require their own signing policy
internally). This path exists specifically so self-hosted organizations aren't forced to
publish internal tooling publicly just to use the standard install mechanism.

---

# Interaction with Deployment Models

Per **Platform Capabilities → Permission Ownership by Deployment Model**, install-tier
permissions are already operator-gated in hosted deployments. The marketplace adds one more
axis on top of that: **which trust tiers are enabled at all.**

## Self-Hosted

The operator controls their own Gateway's marketplace configuration directly — e.g. "only
Official and Verified plugins may be installed," or "allow Community tier with a warning," or
"disable the public registry entirely and only allow private-source installs." This is a
configuration choice, not a platform-enforced rule.

## Hosted (SaaS)

The platform operator sets the default policy for the shared Gateway — most plausibly
restricting installable plugins to Official and Verified tiers only, given that a Community-
tier plugin installed by mistake would affect infrastructure shared across tenants. Tenants
retain `platform.marketplace.read` to browse what's available (including, arguably, Community
tier, so they can see what exists even if they can't install it themselves), but
`plugin.install` stays reserved for the operator as already established.

---

# Security Posture Summary

- Browsing the marketplace is cheap and widely granted (`platform.marketplace.read`).
- Installing anything remains gated exactly as strictly as before (`platform.plugin.install`,
  operator-only in hosted deployments).
- Trust tier is surfaced at every step — search results, describe output, and the
  `plugin.installed` event — so nobody installs a Community-tier plugin without it being
  visibly labeled as such.
- Signature and checksum verification block installation of tampered Verified/Official
  packages; Community-tier packages are explicitly lower-assurance and labeled that way rather
  than being falsely equated with reviewed plugins.
- Private-source installs remain available so self-hosted operators aren't forced onto the
  public registry for internal tooling.

---

# What's Still Open

This document defines the mechanism; it does not resolve everything a real registry needs
before launch:

- **Review capacity and SLA** for reaching Verified tier — who actually performs human review,
  and how long does it take, is an operational question outside this document's scope.
- **Revocation** — if a Verified plugin is later found malicious, the registry can mark it
  deprecated, but whether/how already-installed instances get force-notified or force-removed
  is not specified here.
- **Monetization / licensing enforcement** — this document assumes plugins are free and
  open-license; a paid-plugin model would need its own design pass.
- **Sandboxing at runtime** — this document covers install-time trust decisions, not whether
  a Runtime Plugin is sandboxed (e.g. process isolation, resource limits) once running. That's
  a Runtime Plugin execution concern, not a marketplace concern, but the two are related and
  worth a dedicated pass later.

These are reasonable follow-ups, not blockers to adopting the mechanism above.
