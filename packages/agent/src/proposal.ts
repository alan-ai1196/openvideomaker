import type { EditPlan, EditScript, OperationType, Project } from '@openvideomaker/schema';
import type { ProjectSession } from '@openvideomaker/core';
import { applyEditScript, previewEditScript } from './editScript.js';

/**
 * A reviewable agent proposal: plan (intent + evidence) and script
 * (the declarative edits) with a computed dry-run preview. Proposals
 * are ephemeral review artifacts; the authoritative project changes
 * are the typed operations produced when one is applied.
 */

export type ProposalState = 'proposed' | 'applied' | 'rejected';

export interface ProposalPreview {
  ok: boolean;
  errors: string[];
  appliedTypes: OperationType[];
  violations: Array<{ code: string; message: string; path: string }>;
}

export interface EditProposal {
  id: string;
  plan: EditPlan;
  script: EditScript;
  state: ProposalState;
  preview: ProposalPreview;
  createdAt: string;
  appliedAt: string | null;
}

export function createProposal(project: Project, plan: EditPlan, script: EditScript): EditProposal {
  const preview = previewEditScript(project, script);
  return {
    id: 'proposal-' + globalThis.crypto.randomUUID(),
    plan,
    script,
    state: 'proposed',
    preview: {
      ok: preview.ok,
      errors: preview.errors,
      appliedTypes: preview.appliedTypes,
      violations: preview.violations.map((v) => ({ code: v.code, message: v.message, path: v.path })),
    },
    createdAt: new Date().toISOString(),
    appliedAt: null,
  };
}

/** Apply a proposal's script to the session; the edit is undoable like any other. */
export function applyProposal(session: ProjectSession, proposal: EditProposal, options?: { actorName?: string }): { ok: boolean; errors: string[] } {
  if (proposal.state === 'applied') return { ok: true, errors: [] };
  const result = applyEditScript(session, proposal.script, options);
  if (result.ok) {
    proposal.state = 'applied';
    proposal.appliedAt = new Date().toISOString();
  }
  return result;
}
