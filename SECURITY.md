# Security

## Reporting

OpenVideoMaker is pre-release. Report security issues privately to the
maintainers before disclosing publicly. Do not open a public issue for a
credible vulnerability.

## Trust model

OpenVideoMaker's own code is Apache-2.0 and runs locally. The risky parts
of the product are not the UI but what it loads: model artifacts, runner
code, third-party endpoints, and project files.

### Downloading model artifacts never means executing downloaded code

- Weights/configs and runner code are separate concerns. Core TypeScript
  never executes arbitrary code from a downloaded model repository by
  default; any remote-code mechanism requires explicit trust and
  preferably isolation.
- The artifact store (`@openvideomaker/downloader`) is safe-but-dumb by
  design: content-addressed storage, sanitized relative paths (no
  traversal, no absolute paths), no archive extraction, no code execution.
  Installs require a registry-provided file manifest; entries without one
  refuse to install.
- Mirrors are explicit configuration (HF_ENDPOINT, registry http sources);
  redirects are limited to http(s) and credentials are never embedded in
  URLs or logged.
- Runners are first-party adapters, verified third-party adapters, or
  explicitly trusted user runtimes (isolated environments/containers).

### Process/wire boundaries

- Commands are built with argument arrays, never interpolated shell
  strings.
- Runner subprocesses speak a framed protocol over stdio; binary media
  travels as file/CAS references, never inside JSON.
- Untrusted payloads (projects, registry entries, manifests, MCP/HTTP
  requests) are schema-validated at the boundary.

### Electron (future)

- Context isolation on; no Node integration in renderers; narrow typed
  preload bridge; renderer privileges minimized.

### Threats we design against

- Arbitrary command execution via crafted media/model metadata;
- Path traversal and malicious archives in downloads;
- Credential leakage (no secrets in logs/docs/tests);
- SSRF via remote model/source configuration;
- Unsafe environment inheritance into runner processes;
- Untrusted local HTTP endpoints (ComfyUI/remote workers) with token
  scoping.

## What we do not do

- Ship model weights in the repo.
- Claim models are commercially usable; model licenses are surfaced in
  the registry and UI.
- Log secrets or accept `trust_remote_code`-style execution by default.