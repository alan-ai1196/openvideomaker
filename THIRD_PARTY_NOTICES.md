# Third-Party Notices

OpenVideoMaker itself is licensed under Apache-2.0. This file records
runtime/tooling dependencies of the project code.

## Runtime dependencies

| Package | License | Purpose |
|---|---|---|
| zod | MIT | Schema validation at durable/untrusted boundaries |
| better-sqlite3 | MIT | SQLite project storage (native addon) |
| react / react-dom | MIT | Studio UI |
| @fontsource-variable/inter | OFL-1.1 (font) / MIT (package) | Studio typography |

## Vendored runner code

| Package | License | Purpose |
|---|---|---|
| LatentSync (bytedance/LatentSync, commit a229c3948406bc2cf6eaf4873e662e70c6a04746) | Apache-2.0 | Vendored inference package in `runners/latentsync/vendor/` (training/eval modules excluded; adapter-local patches marked `OVM adapter patch`) |

## Development dependencies

| Package | License | Purpose |
|---|---|---|
| TypeScript | Apache-2.0 | Type checking / compilation |
| Vitest | MIT | Testing |
| Vite / @vitejs/plugin-react | MIT | Studio build tooling |
| Playwright | Apache-2.0 | Browser-based UI validation |
| Turbo | MIT | Workspace build graph |
| pnpm | MIT | Package manager |

Model weights, model repositories, and runner ecosystems are separate
projects with their own licenses; the registry records those licenses and
the UI surfaces them. OpenVideoMaker's permissive license does not extend
to third-party models.