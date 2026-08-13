import type { Actor, Operation, OperationType, Project, RawOperation, Transaction } from '@openvideomaker/schema';

export interface Violation {
  code: string;
  message: string;
  /** Dotted path into the project, e.g. "sequences.seq_1.tracks.trk_2.clips[3]". */
  path: string;
}

export interface ApplyContext {
  opId: Operation['opId'];
  actor: Actor;
  now: string;
}

export interface ApplyResult {
  txId: Transaction['txId'];
  /** New checkpoint (total applied operations). */
  checkpoint: number;
  operations: Operation[];
  project: Readonly<Project>;
}

export interface ApplyOptions {
  actor?: Actor;
  note?: string;
  /**
   * Expected current checkpoint. The transaction is rejected with a
   * ConflictError when it differs - stale changes never silently
   * overwrite newer state.
   */
  baseCheckpoint?: number;
}

export type ApplyFn<P = unknown> = (project: Project, params: P, ctx: ApplyContext) => void;

export interface ApplyRegistry {
  has(type: OperationType): boolean;
  apply(project: Project, op: Operation, now: string): void;
}

export type { Actor, Operation, OperationType, Project, RawOperation, Transaction };