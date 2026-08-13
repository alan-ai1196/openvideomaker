import type { Operation, Violation } from './types.js';

export type OvmErrorCode =
  | 'op.validation'
  | 'op.not-found'
  | 'op.immutable'
  | 'op.conflict'
  | 'op.invariant'
  | 'schema.parse';

/**
 * Base error for all core failures. Every user/agent-facing error carries
 * a stable machine-readable code, a human message answering what failed,
 * and structured details. Never surface raw stack traces to creators.
 */
export class OvmError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** A single operation failed its precondition. */
export class OperationError extends OvmError {
  readonly operation?: Operation;
  constructor(code: 'op.validation' | 'op.not-found' | 'op.immutable', message: string, operation?: Operation, details?: unknown) {
    super(code, message, details);
    this.operation = operation;
  }
}

/** The transaction was based on a stale project checkpoint. */
export class ConflictError extends OvmError {
  constructor(message: string) {
    super('op.conflict', message);
  }
}

/** The project violates a structural invariant after the transaction. */
export class InvariantError extends OvmError {
  readonly violations: Violation[];
  constructor(message: string, violations: Violation[]) {
    super('op.invariant', message, violations);
    this.violations = violations;
  }
}

/** An untrusted/durable boundary payload failed schema validation. */
export class SchemaError extends OvmError {
  readonly issues: unknown[];
  constructor(message: string, issues: unknown[]) {
    super('schema.parse', message, issues);
    this.issues = issues;
  }
}