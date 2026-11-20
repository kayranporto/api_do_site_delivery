import { z } from 'zod';

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).optional(),
  initialDelayMs: z.number().int().min(0).max(86_400_000).optional(),
  maxDelayMs: z.number().int().min(0).max(86_400_000).optional(),
  backoffMultiplier: z.number().min(1).max(10).optional()
}).strict().optional();

export const createIntegrationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  providerKey: z.string().trim().min(2).max(63),
  configurationReference: z.string().trim().min(3).max(128),
  secretReference: z.string().trim().regex(/^env:[A-Z][A-Z0-9_]{0,127}$/).nullable().optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  retryPolicy: retryPolicySchema
}).strict();

export const executeOperationSchema = z.object({
  operationName: z.string().trim().min(1).max(100),
  payload: z.unknown().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional()
}).strict();
