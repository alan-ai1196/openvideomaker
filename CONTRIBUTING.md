# Contributing

Thanks for your interest in OpenVideoMaker. The project is pre-release:
the foundation (project model + operation engine) is in place, and the
editor surfaces are being built on top of it.

## Before you start

1. Read `AGENTS.md` — the repository invariants are binding.
2. Check `docs/STATUS.md` and `docs/architecture/OVERVIEW.md` for the
   current truth.
3. Open an issue describing the problem before large changes.

## Development loop

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @openvideomaker/core test   # focused
```

## Pull request expectations

- Changes to project semantics must go through the operation layer with
  tests (operation behavior, invariants, replay where relevant).
- New operation types need schema + apply implementation + registry
  coverage (enforced by `test/registry.test.ts`).
- Docs update in the same PR when architectural truth changes.
- Commits are coherent milestones; no weights, caches, or build output.

## License

Project code is Apache-2.0. By contributing you agree to license your
contribution under it.