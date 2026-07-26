# Business Capabilities

> **Revision note (this pass):** Light-touch update. Cross-references Capability System for
> the general capability schema and lifecycle instead of implicitly duplicating them. No
> structural changes — this document remains the fullest worked example of a capability
> end-to-end and is treated as such by Capability System, Platform Capabilities, and Runtime
> Capabilities, which point back here rather than repeating its examples.

## Overview

Business Capabilities are the primary way an application exposes its functionality to AI
agents.

They represent meaningful business operations rather than technical implementation details.

A Business Capability is implemented by the application developer using one of the platform
SDKs.

Examples include:

```
customer.read

customer.create

order.submit

invoice.generate

product.search

payment.capture
```

These capabilities are specific to the application's domain and are registered with the
platform through the Backend SDK. For the general capability schema and lifecycle that apply
to every capability type, see **Capability System**.

---

# Purpose

Business Capabilities provide a stable, AI-friendly interface to an application's business
logic.

Instead of exposing:

```
GET /customers

POST /orders

DELETE /products
```

The application exposes:

```
customer.read

order.create

product.delete
```

The AI agent doesn't need to understand HTTP methods, URLs, controllers, or database schemas.

It only needs to know which capabilities are available.

---

# Characteristics

Every Business Capability should:

- Represent one business action
- Be discoverable
- Be independently executable
- Be versioned
- Be permission-aware
- Be documented
- Validate its inputs
- Return structured outputs

---

# Capability Structure

Every Business Capability consists of:

```yaml
name: customer.read

description: Retrieve a customer by their unique identifier.

version: 1.0.0

type: business

runtime: backend

permissions:
  - customer.read

input:
  id: string

output:
  customer: Customer
```

This is the same seven-field structure common to all capability types (see **Capability
System → Capability Structure**) — `type: business` and `runtime: backend` are what mark it
as owned by the application rather than the platform core or a runtime plugin.

---

# Registration

Business Capabilities are registered during application startup.

Example:

```ts
platform.capability({
    name: "customer.read",
    description: "Retrieve customer information",

    input: CustomerSchema,

    async execute({ id }) {
        return customerService.findById(id);
    }
});
```

The SDK automatically registers the capability with the Gateway. For registering an
application's entire capability set at once rather than one at a time, see **Terminology →
Capability Manifest**.

---

# Discovery

Applications do not expose routes.

They expose capabilities.

Example discovery response:

```json
[
  {
    "name": "customer.read",
    "description": "Retrieve customer information"
  },
  {
    "name": "customer.create",
    "description": "Create a new customer"
  }
]
```

AI agents can understand what an application can do without reading documentation.

---

# Execution Flow

```
AI Agent

↓

customer.read

↓

Gateway

↓

Capability Registry

↓

Backend Runtime

↓

Backend SDK

↓

Application

↓

Business Logic

↓

Database

↓

Response
```

Notice that the Gateway never communicates directly with the database.

---

# Handler Example

```ts
platform.capability({
    name: "product.search",

    description: "Search products",

    input: SearchProductSchema,

    async execute(input) {
        return productService.search(input);
    }
});
```

The platform knows nothing about the implementation.

It only invokes the handler.

---

# Good Capability Design

A capability should perform **one** business action.

Good:

```
customer.read

customer.update

customer.delete
```

Bad:

```
customer.manage
```

Small capabilities are:

- Easier to test
- Easier to secure
- Easier to reuse
- Easier to compose

---

# Capability Composition

Complex workflows should be built from multiple capabilities.

Example:

```
checkout.start

↓

payment.authorize

↓

inventory.reserve

↓

order.create

↓

notification.send
```

Instead of:

```
checkout.everything
```

The platform should orchestrate multiple capabilities rather than exposing one large
operation. Business Capabilities can also compose with Runtime Capabilities in the same
session — see **Runtime Capabilities → Capability Composition** for an example that
interleaves the two.

---

# Input Validation

Every capability defines an input schema.

Example:

```ts
const CustomerSchema = z.object({
    id: z.string().uuid()
});
```

Validation occurs before execution.

```
Input

↓

Schema Validation

↓

Execute
```

Invalid requests never reach the business logic.

---

# Output Contract

Capabilities should return predictable structures.

Good:

```json
{
    "customer": {
        "id": "123",
        "name": "John Doe"
    }
}
```

Avoid returning inconsistent shapes depending on execution paths.

---

# Permissions

Each capability explicitly declares the permissions required.

Example:

```yaml
permissions:

- customer.read
```

The Gateway performs authorization before execution.

This ensures handlers only execute when the caller is authorized.

Unlike Runtime Capabilities, Business Capabilities are not currently required to follow a
read/act/destructive tiering convention (see **Runtime Capabilities → Permissions and Risk
Tiers**), since a single capability like `customer.delete` is already a single, narrowly
named action rather than a broad namespace covering actions of mixed risk. If a future
Business Capability were to bundle multiple risk levels under one name, the same tiering
logic would apply — this is a candidate to watch for as the capability catalog grows.

---

# Versioning

Business logic evolves.

Capabilities should support versioning.

Example:

```
customer.read

v1

↓

customer.read

v2
```

Older versions may remain available during migration periods.

---

# Events

Business Capabilities emit lifecycle events.

```
capability.started

↓

capability.completed

↓

capability.failed
```

These events can be consumed by:

- Logging
- Analytics
- Metrics
- Audit systems
- Monitoring plugins

Business logic remains unaware of these subscribers.

---

# Error Handling

Capabilities should return structured errors.

Example:

```json
{
    "code": "CUSTOMER_NOT_FOUND",
    "message": "Customer does not exist."
}
```

Avoid exposing stack traces or implementation details.

---

# Naming Guidelines

Use the format:

```
<domain>.<action>
```

Examples:

```
customer.read

customer.create

customer.update

customer.delete

order.submit

invoice.generate

payment.capture

inventory.adjust
```

Names should describe **intent**, not implementation.

Avoid:

```
database.query

service.execute

controller.run

http.post
```

---

# Best Practices

✅ Keep capabilities small.

✅ Make them idempotent when possible.

✅ Use descriptive names.

✅ Validate all inputs.

✅ Return structured outputs.

✅ Declare permissions.

✅ Emit lifecycle events.

✅ Keep business logic inside the application.

---

# Anti-Patterns

Avoid capabilities that:

- Perform multiple unrelated actions.
- Expose technical implementation details.
- Depend on another capability internally.
- Return inconsistent response structures.
- Bypass permission checks.
- Mix business logic with platform logic.

---

# Example: E-Commerce Application

A shopping platform might expose:

```
product.search

product.read

cart.add

cart.remove

cart.view

checkout.start

payment.authorize

payment.capture

order.submit

order.cancel

customer.read

customer.update
```

Notice that every capability represents a meaningful business action rather than an API
endpoint.

---

# Summary

Business Capabilities are the foundation of the Agent Runtime Platform.

They provide a stable, secure, and discoverable interface between applications and AI agents.

Applications own the implementation.

The platform owns the execution lifecycle.

The Gateway owns routing and security.

Together, they create a consistent contract that remains stable even as the application's
internal architecture evolves.
