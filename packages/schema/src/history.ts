import { z } from 'zod';
import { TransactionIdSchema } from './ids.js';
import { ActorSchema, OperationSchema } from './operations.js';

/**
 * A transaction is the unit of optimistic concurrency: it names the
 * checkpoint it was based on and carries one or more operations. Applying
 * it advances the project by one checkpoint per operation (undo operates
 * per operation; replay derives any historical state deterministically).
 */
export const TransactionSchema = z.object({
  txId: TransactionIdSchema,
  baseCheckpoint: z.number().int().nonnegative(),
  operations: z.array(OperationSchema).min(1),
  createdAt: z.iso.datetime(),
  actor: ActorSchema,
  note: z.string().max(2000).optional(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

/** The authoritative project change log: an append-only ordered list of transactions. */
export type ProjectLog = Transaction[];