# Prototype: install + first-boot UX for Agentide

**Question being answered**: does the install-script + first-boot output wording and ordering match what a self-hosted operator actually needs to see?

This is a UX/sequence prototype, not a logic prototype — the "logic" is just the sequence of console output the operator sees. Throwing away after the question is answered.

## Run

```bash
cd agentide
npx tsx prototypes/install-ux/simulate-install.ts
```

(uses `tsx` to run TS directly; equivalent to `node` after compile)

## What this simulates

Three scripts the operator runs (or sees output from):

1. `curl -fsSL https://agentide.io/install.sh | bash` — the one-liner that installs the binary
2. `./agentide init` — first-run bootstrap (generates tenant + operator token)
3. `./agentide start` — starts the platform

Each script's output is a sequence of `console.log` calls. The "logic" is just the print statements and their order — no real installation happens.

## What to judge

- **Critical info present?** bootstrap token, MCP URL, port, tenant id, data directory
- **Critical info visible?** does the operator have to scroll back to find the token? Or is it right at the end where they need it?
- **Trust signals?** version installed, license/source mentioned, error-message style for failures (not mocked here — just success path)
- **Next-step clarity?** does the operator know what to do next (configure agent, create tenant, install plugin)?

Edit `simulate-install.ts` to try alternative wordings. When you're happy with the output, the wording becomes the spec for the real `install.sh` + first-boot code in `@platform/agentide`. Delete this prototype.