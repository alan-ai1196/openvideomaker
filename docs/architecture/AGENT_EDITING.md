# Agent editing: plans, scripts, proposals

Status: matches current code (round 13).

## The contract

The editing agent never touches project state directly and never runs
unrestricted code. It works through three explicit artifacts:

1. **EditPlan** (`@openvideomaker/schema`) - intent: goal, evidence
   (transcript ranges, time ranges, clips, notes), constraints,
   intended changes, expected outcome. Planning is separate from
   mutation.
2. **EditScript** (`@openvideomaker/schema`) - a RESTRICTED
   declarative program over the editing domain (track.create,
   clip.insert/remove/move/trim, text/caption insert, media.insert)
   with explicit `$variable` bindings for entities the script itself
   creates. There is no eval, no filesystem, no network - steps are
   zod-validated data.
3. **Proposals** (`@openvideomaker/agent`) - a plan + script with a
   computed dry-run preview (operations, invariant checks). Apply
   lands one ordinary operation transaction (undoable, replayable,
   actor 'agent'); reject discards.

`compileEditScript` resolves steps against the current project plus
the script's own bindings and emits the SAME typed operations the
Studio uses. `previewEditScript` applies to a scratch copy - the live
project is never mutated by a preview.

## Deterministic planner

`suggestDemoEdits(project)` inspects the CURRENT project and proposes
concrete edits (tighten the intro, captions from a transcript). It
drives the Studio Agent panel today and is the contract the LLM
planner will satisfy later: the engine does not care who wrote the
script.

## Verification

Deterministic checks always run first (invariants, missing
references, overlap, caption ranges); semantic render-conditioned
review will build on render plans in a later round. The agent should
detect objective defects before asking for human review.

## Honest state

The LLM-driven planner (a chat/model-backed agent) does not exist yet;
the Studio panel says so and demonstrates the proposal pipeline with
the deterministic planner. MCP edit tools (a later round) will expose
the same plan/script/proposal artifacts.
