# ADR-0014: MCP is a semantic tool surface, not a second mutation path

## Context

Agents need an external interface, but exposing hundreds of tiny
model-specific tools or letting MCP mutate raw project state would
fork the product model. The invariant is: Studio, MCP, SDK and CLI
mutate projects only through the typed operation layer.

## Decision

- MCP exposes a compact, capability-first tool set (project/timeline/
  transcript/character inspect-and-create, edit.preview/edit.apply,
  model search/info) implemented over core sessions and
  EditScripts - the same code paths as the Studio.
- Edits arrive as EditScripts: one undoable agent transaction, with
  previews on scratch copies. The server never applies raw JSON
  patches to project state.
- Tool surface is capability-shaped: no model-specific tool names;
  generation/render/persistence tools are only advertised when the
  host can actually run them (desktop core - a later round).
- The `ovm` CLI aggregates doctor/models/render/mcp by delegating to
  the same packages.

## Consequences

- An agent editing via MCP produces the same history entries (actor:
  agent) and undo behavior as Studio or EditScript users.
- Adding a model or a core feature never requires MCP changes.
- The server is honest about scope: unimplemented surfaces are
  absent, not stubbed.

## Alternatives considered

- Exposing the raw operation vocabulary as MCP tools: rejected -
  error-prone for agents and invites divergent logic.
- Model-specific tools (run_<model>): rejected - violates
  capability-first and bloats the surface.
