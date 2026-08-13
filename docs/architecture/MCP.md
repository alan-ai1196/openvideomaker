# MCP: the agent boundary over the operation layer

Status: matches current code (round 14).

## Contract

`@openvideomaker/mcp` is an MCP server (specification 2025-06-18,
JSON-RPC 2.0 over newline-delimited stdio) exposing a SEMANTIC,
compact tool set - the same typed operation layer the Studio uses,
never raw state or a second business-logic path:

- project.create / project.inspect / project.dump
- timeline.inspect / transcript.inspect / character.inspect
- character.create
- edit.preview / edit.apply (EditScripts from `@openvideomaker/agent`
  - previews on a scratch copy, applies one undoable agent
  transaction)
- model.list / model.search / model.info (capability-first)

Resources: `project://current` (the live Video IR) and
`model://<registry-id>` (the registry entry). All boundaries are
zod-validated; tool failures return MCP content errors with messages,
not protocol faults.

## Honest scope

The server edits IN-MEMORY projects (the same engine as the Studio).
Persistence, model installation and generation/render submission
arrive with the desktop core in a later round; until then those
tools are simply not advertised. Never advertise a tool that cannot
actually run.

## CLI

`ovm mcp` starts the server over stdio; `packages/cli` also provides
`ovm doctor`, `ovm models list|search|info` and `ovm render`, each
delegating to the same packages the Studio uses.
