import {
  newOperationId,
  newProjectId,
  newSequenceId,
  newTransactionId,
  OperationSchema,
  ProjectSchema,
  type Actor,
  type Operation,
  type OperationType,
  type Project,
  type ProjectId,
  type ProjectLog,
  type ProjectSettings,
  type RawOperation,
  type Transaction,
} from '@openvideomaker/schema';
import { applyOperation } from './apply/applyOperation.js';
import { deepFreeze } from './freeze.js';
import { blankProject } from './builders.js';
import { ConflictError, InvariantError, OvmError, SchemaError } from './errors.js';
import { TransactionScope } from './scope.js';
import type { ApplyOptions, ApplyResult } from './types.js';
import { collectViolations } from './validate/invariants.js';

function totalOps(log: readonly Transaction[]): number {
  let n = 0;
  for (const tx of log) n += tx.operations.length;
  return n;
}

/**
 * The authoritative in-memory project session.
 *
 * Every mutation - from Studio, MCP, SDK, CLI or an agent - goes through
 * apply()/transaction() and becomes typed operations in an append-only
 * log. Undo operates per operation, redo replays the log, replay from a
 * saved log reproduces any historical state deterministically, and
 * optimistic concurrency uses operation checkpoints so stale writers
 * fail loudly instead of overwriting newer work.
 */
export class ProjectSession {
  #project: Project;
  #log: Transaction[];
  #checkpoint: number;

  private constructor(project: Project, log: Transaction[], checkpoint: number) {
    this.#project = project;
    this.#log = log;
    this.#checkpoint = checkpoint;
  }

  /**
   * Create a new project, a default sequence, and record both operations.
   * (A project always starts with one sequence; the no-sequences invariant
   * protects against corrupted states from this point on.)
   */
  static create(name: string, options?: { settings?: Partial<ProjectSettings> }): ProjectSession {
    const projectId = newProjectId();
    const session = new ProjectSession(blankProject(projectId), [], 0);
    session.apply([
      { type: 'project.create', params: { projectId, name, settings: options?.settings } },
      { type: 'sequence.create', params: { sequenceId: newSequenceId() } },
    ]);
    return session;
  }

  /**
   * Restore a session from a snapshot + its change log. The snapshot is
   * trusted for fast loading (it was written by the same core); the log
   * remains the authoritative append-only history for future operations.
   */
  static open(project: Project, log: ProjectLog): ProjectSession {
    let parsed: Project;
    try {
      parsed = ProjectSchema.parse(project);
    } catch (err) {
      throw new SchemaError('invalid project snapshot: ' + (err as Error).message, [err]);
    }
    const checkpoint = totalOps(log);
    return new ProjectSession(deepFreeze(parsed), log.map((t) => ({ ...t, operations: [...t.operations] })), checkpoint);
  }

  /** Deterministically replay a change log from its blank project base. */
  static fromLog(log: ProjectLog): ProjectSession {
    const first = log[0]?.operations[0];
    if (!first || first.type !== 'project.create') {
      throw new OvmError('schema.parse', 'a project log must start with a project.create operation');
    }
    const projectId: ProjectId = first.params.projectId;
    const project = blankProject(projectId);
    for (const tx of log) {
      for (const op of tx.operations) applyOperation(project, op, op.at);
    }
    const violations = collectViolations(project);
    if (violations.length > 0) {
      throw new InvariantError('replayed log produces an invalid project', violations);
    }
    return new ProjectSession(deepFreeze(project), log.map((t) => ({ ...t, operations: [...t.operations] })), totalOps(log));
  }

  get projectId(): ProjectId {
    return this.#project.id;
  }

  get project(): Readonly<Project> {
    return this.#project;
  }

  /** Number of applied operations. Undo/redo move this pointer. */
  get checkpoint(): number {
    return this.#checkpoint;
  }

  get log(): readonly Transaction[] {
    return this.#log;
  }

  get canUndo(): boolean {
    return this.#checkpoint > 0;
  }

  get canRedo(): boolean {
    return this.#checkpoint < totalOps(this.#log);
  }

  /** Export the append-only change log for durable persistence. */
  exportLog(): ProjectLog {
    return structuredClone(this.#log);
  }

  /**
   * Apply a transaction of raw operations.
   *
   * @throws SchemaError on malformed operations
   * @throws ConflictError when baseCheckpoint is stale
   * @throws OperationError when an operation precondition fails
   * @throws InvariantError when the result violates project invariants
   */
  apply(operations: readonly RawOperation[], options: ApplyOptions = {}): ApplyResult {
    if (operations.length === 0) {
      throw new OvmError('op.validation', 'a transaction requires at least one operation');
    }
    const now = new Date().toISOString();
    const actor: Actor = options.actor ?? { kind: 'user' };
    const base = options.baseCheckpoint ?? this.#checkpoint;
    if (base !== this.#checkpoint) {
      throw new ConflictError(
        'stale base checkpoint ' + base + ' (current: ' + this.#checkpoint + ') - reload and rebase before applying',
      );
    }

    const fullOps: Operation[] = operations.map((raw) => {
      try {
        return OperationSchema.parse({ ...raw, opId: newOperationId(), at: now, actor });
      } catch (err) {
        throw new SchemaError('invalid operation: ' + (err as Error).message, [err]);
      }
    });

    const txId = newTransactionId();
    const draft = structuredClone(this.#project) as Project;
    for (const op of fullOps) applyOperation(draft, op, now);

    const violations = collectViolations(draft);
    if (violations.length > 0) {
      const summary = violations.map((v) => v.code + ' @ ' + v.path + ': ' + v.message).join('; ');
      throw new InvariantError('transaction violates project invariants: ' + summary, violations);
    }

    const tx: Transaction = {
      txId,
      baseCheckpoint: base,
      operations: fullOps,
      createdAt: now,
      actor,
      note: options.note,
    };

    // Truncate any redo tail: transactions fully beyond the checkpoint die.
    let applied = 0;
    let keep = 0;
    for (const existing of this.#log) {
      if (applied + existing.operations.length <= this.#checkpoint) {
        applied += existing.operations.length;
        keep += 1;
      } else {
        break;
      }
    }
    if (keep < this.#log.length) this.#log = this.#log.slice(0, keep);

    this.#log.push(tx);
    this.#checkpoint += fullOps.length;
    this.#project = deepFreeze(draft);
    return { txId, checkpoint: this.#checkpoint, operations: fullOps, project: this.#project };
  }

  /**
   * Collect operations through a typed scope, then apply them as one
   * transaction. This is the ergonomic path for agents and scripts that
   * need to batch many edits without many round trips.
   */
  transaction(fn: (tx: TransactionScope) => void, options: ApplyOptions = {}): ApplyResult {
    const scope = new TransactionScope();
    fn(scope);
    return this.apply(scope.operations, options);
  }

  /** Undo one operation. Returns false at the start of history. */
  undo(): boolean {
    if (this.#checkpoint <= 0) return false;
    this.#checkpoint -= 1;
    this.#project = deepFreeze(this.#rebuild());
    return true;
  }

  /** Redo one undone operation. Returns false at the tip of history. */
  redo(): boolean {
    if (this.#checkpoint >= totalOps(this.#log)) return false;
    this.#checkpoint += 1;
    this.#project = deepFreeze(this.#rebuild());
    return true;
  }

  #rebuild(): Project {
    const first = this.#log[0]?.operations[0];
    if (!first || first.type !== 'project.create') {
      throw new OvmError('op.immutable', 'session log is missing its project.create root');
    }
    const project = blankProject(first.params.projectId);
    let applied = 0;
    outer: for (const tx of this.#log) {
      for (const op of tx.operations) {
        if (applied >= this.#checkpoint) break outer;
        applyOperation(project, op, op.at);
        applied += 1;
      }
    }
    return project;
  }
}