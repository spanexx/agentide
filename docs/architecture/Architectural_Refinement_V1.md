# Architecture Notes & Design Refinements

> **Revision note (this pass):** This document is being retired as a standalone source of
> design ideas (drift item #8). Of its original 20 notes, ~13 duplicated content already
> fully specified in Goals, Core Concept, Runtime Capabilities, or Agentide — those are marked
> **Superseded** below, with a pointer to the doc that now owns that content. The ~6 notes
> that carried genuinely new information have been promoted into their proper home documents
> and are marked **Promoted**. Nothing in this document should be treated as current design
> guidance going forward — treat it as a historical record of where ideas originated, and
> follow the pointer to the live doc.

---

# Status of Each Note

## 1. Treat the Platform as an Operating System — Superseded

Promoted verbatim into Agentide's cover framing ("This platform is not an MCP server") and
Core Concept's OS mental-model table. See **Agentide** and **Core Concept**.

---

## 2. Three Types of Capabilities — Superseded

Fully specified, with worked examples and a classification test, in **Capability System →
Capability Types**, and implemented in detail across **Business Capabilities**, **Platform
Capabilities**, and **Runtime Capabilities**.

---

## 3. Capability Manifest — Promoted

Promoted into **Terminology → Capability Manifest**, and referenced from **Business
Capabilities → Registration** and **Agentide → Section 5 (Capability Registry)**.

---

## 4. Runtime Manifest — Promoted

Promoted into **Terminology → Plugin Manifest** (the Runtime Manifest is treated as the
Plugin Manifest format applied to a Runtime Plugin specifically). Referenced from **Runtime
Capabilities → Runtime Registration** and **Agentide → Section 5 (Plugin Manager)**.

---

## 5. Gateway as Two Logical Services — Promoted (with a correction)

Promoted into **Terminology → Control Plane / Execution Plane**, and reflected in Agentide's
architecture diagram (Section 4) and Gateway section (Section 9).

**Correction:** this note originally proposed the pairing **Control Plane / Data Plane**. The
canonical terminology adopted platform-wide is **Control Plane / Execution Plane** instead —
"Data Plane" is retired. See **Terminology → Control Plane** for the full explanation of why,
and the project drift/issue log, item #9, for the resolution history. Any other document or
future note still using "Data Plane" should be treated as using superseded terminology.

---

## 6. Browser Runtime Owns Browsers — Superseded

Fully covered in **Runtime Capabilities → Resource Ownership** and **Agentide → Section 9**.

---

## 7. Runtimes Own Resources — Superseded

Fully covered in **Runtime Capabilities → Resource Ownership**, with the browser/Docker/Git
examples carried over directly.

---

## 8. Sessions Own Runtime Resources — Superseded

Fully covered in **Core Concept → Session** and **Agentide → Section 5 (Session Manager)**.

---

## 9. Dashboard Is a First-Class Product — Promoted

Promoted into **Agentide → Section 14 (Dashboard)**, which now opens by stating the Dashboard
is a first-class product rather than an admin tool, matching this note's original framing.

---

## 10. Browser DevTools Integration — Promoted

Promoted into **Agentide → Section 14 → Extended Tooling**, with the feature list (active
sessions, capabilities, browser events, capability timeline, performance, runtime logs)
carried over.

---

## 11. VS Code Extension — Promoted

Promoted into **Agentide → Section 14 → Extended Tooling**, with the feature list
(autocomplete, manifest validation, runtime inspection, session debugging, Gateway
connection, plugin management) carried over.

---

## 12. Hosted + Self-Hosted Gateway — Superseded (partially promoted)

The base hosted/self-hosted description is superseded by **Agentide → Section 15 (Deployment
Models)**. The one line from this note not previously stated elsewhere — "the SDK should not
care which one it connects to" — has been folded into **Goals → Cloud and Local Parity**.

---

## 13. Event-Driven Everything — Superseded

Fully covered in **Core Concept → Event** and **Terminology → Event Bus**.

---

## 14. Applications Only Contain Business Logic — Superseded

Fully covered in **Goals → Separation of Concerns** and **Agentide → Section 16 (Ownership
Model)**.

---

## 15. Gateway Coordinates, Never Executes — Superseded

Fully covered in **Goals → Runtime Isolation** and **Terminology → Gateway / Control Plane**.

---

## 16. SDKs Are Thin — Superseded

Fully covered in **Terminology → SDK** and **Agentide → Section 6 (SDKs)**.

---

## 17. Plugins Should Never Depend on Plugins — Superseded

Fully covered in **Terminology → Plugin** and **Agentide → Section 10 (Plugin System)**.

---

## 18. Capability-First Philosophy — Superseded

Fully covered in **Goals → Agnostic by Design** (capability-level sub-principle).

---

## 19. Long-Term Vision — Superseded

Visual restatement of **Agentide → Section 4 (High-Level Architecture)**; no unique content
beyond what that diagram already shows.

---

## 20. Final Architectural Principle — Promoted

Promoted into **Agentide → Section 16 (Ownership Model)**, including the classification test
examples (Git integration → Runtime Plugin, Slack integration → Adapter/Service Plugin,
etc.), which is the single most quoted-worthy content this document produced.

---

# What's Left Open

Two items discussed alongside this document, but not fully resolved by the promotion above,
remain open in the project drift/issue log:

- **Plugin distribution / marketplace** (item #5) — this document's Capability/Runtime
  Manifest notes are the basis for a future manifest-based plugin standard, but the registry,
  publishing flow, and trust model for third-party plugins are not yet designed. See
  **Agentide → Phase 10** for the roadmap placeholder.
- **Future runtime ownership** (item #6) and **Git Runtime implementation approach** (item
  #7) — addressed with a proposed model in **Agentide → Section 7 (Future Runtimes)**, but not
  yet a finalized decision.

---

# Recommendation

This document has served its purpose as a scratch pad and can be considered closed. Future
design ideas of this kind should be proposed as edits to the relevant canonical document
directly (Terminology for vocabulary, Goals for principles, Agentide for architecture, the
Capability docs for capability-specific rules) plus a new entry in the drift/issue log if the
idea surfaces a gap — rather than accumulating in a new parallel notes document that will
eventually need this same reconciliation pass.
