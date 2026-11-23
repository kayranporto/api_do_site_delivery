import { ValidationError } from '../errors/ValidationError.js';
import { BusinessRuleError } from '../errors/BusinessRuleError.js';
import { InvalidStateTransitionError } from '../errors/InvalidStateTransitionError.js';
import { RetryLimitExceededError } from '../errors/RetryLimitExceededError.js';
import { requiredString } from '../value-objects/requiredString.js';
import { OperationName } from '../value-objects/OperationName.js';
import { IdempotencyKey } from '../value-objects/IdempotencyKey.js';
import { RetryPolicy } from '../value-objects/RetryPolicy.js';

export const ExecutionStatus = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  RETRY_SCHEDULED: 'retry_scheduled',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted'
});

const FINAL_STATUSES = new Set([ExecutionStatus.SUCCEEDED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED, ExecutionStatus.INTERRUPTED]);

function asDate(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${fieldName} deve ser uma data válida.`);
  return date;
}

function assertJsonValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Números devem ser finitos.');
    return;
  }
  if (typeof value !== 'object') throw new Error('Valor não permitido em JSON.');
  if (seen.has(value)) throw new Error('Referência circular não é permitida.');
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    const isPlainObject = prototype === null || (
      Object.getPrototypeOf(prototype) === null
      && Object.prototype.hasOwnProperty.call(prototype, 'constructor')
      && typeof prototype.constructor === 'function'
      && prototype.constructor.name === 'Object'
    );
    if (!isPlainObject) {
      throw new Error('Somente objetos simples são permitidos.');
    }
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}

function cloneJson(value, fieldName) {
  if (value === null) return null;
  if (typeof value !== 'object') {
    throw new ValidationError(`${fieldName} deve ser um objeto JSON, um array ou null.`);
  }

  try {
    assertJsonValue(value);
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new ValidationError(`${fieldName} deve conter apenas dados JSON válidos.`, { cause: error });
  }
}

function cloneAttempt(attempt) {
  return {
    number: attempt.number,
    status: attempt.status,
    startedAt: new Date(attempt.startedAt),
    endedAt: attempt.endedAt ? new Date(attempt.endedAt) : null,
    errorCode: attempt.errorCode ?? null
  };
}

export class Execution {
  #id;
  #integrationId;
  #operationName;
  #input;
  #idempotencyKey;
  #retryPolicy;
  #status;
  #attempts;
  #nextAttemptAt;
  #completedAt;
  #createdAt;

  constructor({
    id,
    integrationId,
    operationName,
    input = null,
    idempotencyKey = null,
    retryPolicy = new RetryPolicy(),
    createdAt = new Date()
  }) {
    this.#id = requiredString(id, 'id', { min: 1, max: 80 });
    this.#integrationId = requiredString(integrationId, 'integrationId', { min: 1, max: 80 });
    this.#operationName = operationName instanceof OperationName ? operationName : new OperationName(operationName);
    this.#input = cloneJson(input, 'input');
    this.#idempotencyKey = idempotencyKey == null
      ? null
      : idempotencyKey instanceof IdempotencyKey ? idempotencyKey : new IdempotencyKey(idempotencyKey);
    this.#retryPolicy = retryPolicy instanceof RetryPolicy ? retryPolicy : new RetryPolicy(retryPolicy);
    this.#status = ExecutionStatus.PENDING;
    this.#attempts = [];
    this.#nextAttemptAt = null;
    this.#completedAt = null;
    this.#createdAt = asDate(createdAt, 'createdAt');
  }

  get id() { return this.#id; }
  get integrationId() { return this.#integrationId; }
  get operationName() { return this.#operationName; }
  get input() { return cloneJson(this.#input, 'input'); }
  get idempotencyKey() { return this.#idempotencyKey; }
  get retryPolicy() { return this.#retryPolicy; }
  get status() { return this.#status; }
  get attemptCount() { return this.#attempts.length; }
  get attempts() { return this.#attempts.map(cloneAttempt); }
  get nextAttemptAt() { return this.#nextAttemptAt ? new Date(this.#nextAttemptAt) : null; }
  get completedAt() { return this.#completedAt ? new Date(this.#completedAt) : null; }
  get createdAt() { return new Date(this.#createdAt); }
  get isFinal() { return FINAL_STATUSES.has(this.#status); }

  /** Reconstitui um agregado a partir de dados persistidos, validando sua consistência. */
  static reconstitute({
    id,
    integrationId,
    operationName,
    input = null,
    idempotencyKey = null,
    retryPolicy = new RetryPolicy(),
    createdAt,
    status,
    attempts = [],
    nextAttemptAt = null,
    completedAt = null
  }) {
    const execution = new Execution({
      id,
      integrationId,
      operationName,
      input,
      idempotencyKey,
      retryPolicy,
      createdAt
    });

    if (!Object.values(ExecutionStatus).includes(status)) {
      throw new ValidationError('status persistido é inválido.');
    }
    if (!Array.isArray(attempts)) throw new ValidationError('attempts deve ser uma lista.');

    const restoredAttempts = [];
    for (const [index, attempt] of attempts.entries()) {
      if (!attempt || attempt.number !== index + 1 || !['running', 'succeeded', 'failed'].includes(attempt.status)) {
        throw new ValidationError('Histórico de tentativas inconsistente.');
      }
      const startedAt = asDate(attempt.startedAt, `attempts[${index}].startedAt`);
      const endedAt = attempt.endedAt == null ? null : asDate(attempt.endedAt, `attempts[${index}].endedAt`);
      if (startedAt < execution.#createdAt || (endedAt && endedAt < startedAt)) {
        throw new ValidationError('Datas do histórico de tentativas são inconsistentes.');
      }
      const previousAttempt = restoredAttempts.at(-1);
      if (previousAttempt && (!previousAttempt.endedAt || startedAt < previousAttempt.endedAt)) {
        throw new ValidationError('Uma tentativa não pode começar antes do término da anterior.');
      }
      if ((attempt.status === 'running') !== (endedAt === null)) {
        throw new ValidationError('O término da tentativa não corresponde ao seu estado.');
      }
      const errorCode = attempt.errorCode == null ? null : requiredString(attempt.errorCode, 'errorCode', { min: 2, max: 64 }).toUpperCase();
      if (errorCode && !/^[A-Z][A-Z0-9_]*$/.test(errorCode)) {
        throw new ValidationError('errorCode persistido é inválido.');
      }
      if (attempt.status === 'failed' && !errorCode) {
        throw new ValidationError('Uma tentativa falha precisa de errorCode.');
      }
      if (attempt.status !== 'failed' && errorCode) {
        throw new ValidationError('Somente tentativas com falha podem conter errorCode.');
      }
      restoredAttempts.push({ number: attempt.number, status: attempt.status, startedAt, endedAt, errorCode });
    }

    const next = nextAttemptAt == null ? null : asDate(nextAttemptAt, 'nextAttemptAt');
    const completed = completedAt == null ? null : asDate(completedAt, 'completedAt');
    const last = restoredAttempts.at(-1);
    const previousAttemptsFailed = restoredAttempts.slice(0, -1).every((attempt) => attempt.status === 'failed');

    const consistent = (() => {
      switch (status) {
        case ExecutionStatus.PENDING:
          return restoredAttempts.length === 0 && next === null && completed === null;
        case ExecutionStatus.RUNNING:
          return Boolean(last && last.status === 'running' && previousAttemptsFailed && next === null && completed === null);
        case ExecutionStatus.RETRY_SCHEDULED:
          return Boolean(last && last.status === 'failed' && previousAttemptsFailed && next && completed === null
            && next >= last.endedAt && execution.#retryPolicy.canRetryAfter(restoredAttempts.length));
        case ExecutionStatus.SUCCEEDED:
          return Boolean(last && last.status === 'succeeded' && previousAttemptsFailed && completed
            && completed.getTime() === last.endedAt.getTime() && next === null);
        case ExecutionStatus.FAILED:
          return Boolean(last && last.status === 'failed' && previousAttemptsFailed && completed
            && completed.getTime() === last.endedAt.getTime() && next === null);
        case ExecutionStatus.CANCELLED:
          return Boolean((restoredAttempts.length === 0 || (last?.status === 'failed' && previousAttemptsFailed))
            && completed && completed >= execution.#createdAt
            && (!last || completed >= last.endedAt) && next === null);
        case ExecutionStatus.INTERRUPTED:
          return Boolean((restoredAttempts.length === 0 && completed && completed >= execution.#createdAt)
            || (last?.status === 'failed' && last.errorCode === 'EXECUTION_INTERRUPTED'
              && previousAttemptsFailed && completed
              && completed.getTime() === last.endedAt.getTime())) && next === null;
        default:
          return false;
      }
    })();

    if (!consistent || restoredAttempts.length > execution.#retryPolicy.maxAttempts) {
      throw new ValidationError('Estado persistido da execução não corresponde ao histórico de tentativas.');
    }

    execution.#status = status;
    execution.#attempts = restoredAttempts;
    execution.#nextAttemptAt = next;
    execution.#completedAt = completed;
    return execution;
  }

  startAttempt(at = new Date()) {
    const startedAt = asDate(at, 'startedAt');
    if (![ExecutionStatus.PENDING, ExecutionStatus.RETRY_SCHEDULED].includes(this.#status)) {
      throw new InvalidStateTransitionError(this.#status, 'startAttempt');
    }
    if (startedAt < this.#createdAt) {
      throw new ValidationError('startedAt não pode ser anterior a createdAt.');
    }
    if (this.#status === ExecutionStatus.RETRY_SCHEDULED && startedAt < this.#nextAttemptAt) {
      throw new BusinessRuleError('A próxima tentativa ainda não está liberada.', { code: 'RETRY_NOT_DUE' });
    }
    if (this.#attempts.length >= this.#retryPolicy.maxAttempts) {
      throw new RetryLimitExceededError(this.#retryPolicy.maxAttempts);
    }

    const attempt = {
      number: this.#attempts.length + 1,
      status: 'running',
      startedAt,
      endedAt: null,
      errorCode: null
    };
    this.#attempts.push(attempt);
    this.#status = ExecutionStatus.RUNNING;
    this.#nextAttemptAt = null;
    return attempt.number;
  }

  succeed({ completedAt = new Date() } = {}) {
    const endedAt = asDate(completedAt, 'completedAt');
    const attempt = this.#currentRunningAttempt('succeed');
    if (endedAt < attempt.startedAt) throw new ValidationError('completedAt não pode ser anterior a startedAt.');

    attempt.status = 'succeeded';
    attempt.endedAt = endedAt;
    this.#status = ExecutionStatus.SUCCEEDED;
    this.#completedAt = endedAt;
    return this;
  }

  fail({ failedAt = new Date(), errorCode, retryable = true } = {}) {
    const endedAt = asDate(failedAt, 'failedAt');
    const normalizedCode = requiredString(errorCode, 'errorCode', { min: 2, max: 64 }).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(normalizedCode)) {
      throw new ValidationError('errorCode deve conter apenas letras maiúsculas, números ou sublinhados.');
    }
    if (typeof retryable !== 'boolean') throw new ValidationError('retryable deve ser booleano.');

    const attempt = this.#currentRunningAttempt('fail');
    if (endedAt < attempt.startedAt) throw new ValidationError('failedAt não pode ser anterior a startedAt.');

    attempt.status = 'failed';
    attempt.endedAt = endedAt;
    attempt.errorCode = normalizedCode;

    if (retryable && this.#retryPolicy.canRetryAfter(attempt.number)) {
      const delayMs = this.#retryPolicy.delayForAttempt(attempt.number);
      this.#nextAttemptAt = new Date(endedAt.getTime() + delayMs);
      this.#status = ExecutionStatus.RETRY_SCHEDULED;
    } else {
      this.#nextAttemptAt = null;
      this.#completedAt = endedAt;
      this.#status = ExecutionStatus.FAILED;
    }

    return this;
  }

  interrupt(at = new Date()) {
    const interruptedAt = asDate(at, 'interruptedAt');
    if (![ExecutionStatus.PENDING, ExecutionStatus.RUNNING].includes(this.#status)) {
      throw new InvalidStateTransitionError(this.#status, 'interrupt');
    }
    if (interruptedAt < this.#createdAt) {
      throw new ValidationError('interruptedAt não pode ser anterior a createdAt.');
    }
    if (this.#status === ExecutionStatus.RUNNING) {
      const attempt = this.#currentRunningAttempt('interrupt');
      if (interruptedAt < attempt.startedAt) {
        throw new ValidationError('interruptedAt não pode ser anterior a startedAt.');
      }
      attempt.status = 'failed';
      attempt.endedAt = interruptedAt;
      attempt.errorCode = 'EXECUTION_INTERRUPTED';
    }
    this.#status = ExecutionStatus.INTERRUPTED;
    this.#nextAttemptAt = null;
    this.#completedAt = interruptedAt;
    return this;
  }

  cancel(at = new Date()) {
    const cancelledAt = asDate(at, 'cancelledAt');
    if (![ExecutionStatus.PENDING, ExecutionStatus.RETRY_SCHEDULED].includes(this.#status)) {
      throw new InvalidStateTransitionError(this.#status, 'cancel');
    }
    if (cancelledAt < this.#createdAt) {
      throw new ValidationError('cancelledAt não pode ser anterior a createdAt.');
    }
    const lastAttempt = this.#attempts.at(-1);
    if (lastAttempt?.endedAt && cancelledAt < lastAttempt.endedAt) {
      throw new ValidationError('cancelledAt não pode ser anterior ao término da última tentativa.');
    }

    this.#status = ExecutionStatus.CANCELLED;
    this.#nextAttemptAt = null;
    this.#completedAt = cancelledAt;
    return this;
  }

  #currentRunningAttempt(action) {
    if (this.#status !== ExecutionStatus.RUNNING) {
      throw new InvalidStateTransitionError(this.#status, action);
    }
    const attempt = this.#attempts.at(-1);
    if (!attempt || attempt.status !== 'running') {
      throw new InvalidStateTransitionError(this.#status, action);
    }
    return attempt;
  }

  toJSON() {
    return {
      id: this.#id,
      integrationId: this.#integrationId,
      operationName: this.#operationName.toJSON(),
      input: cloneJson(this.#input, 'input'),
      idempotencyKey: this.#idempotencyKey?.toJSON() ?? null,
      retryPolicy: this.#retryPolicy.toJSON(),
      status: this.#status,
      attempts: this.#attempts.map((attempt) => ({
        number: attempt.number,
        status: attempt.status,
        startedAt: attempt.startedAt.toISOString(),
        endedAt: attempt.endedAt?.toISOString() ?? null,
        errorCode: attempt.errorCode
      })),
      nextAttemptAt: this.#nextAttemptAt?.toISOString() ?? null,
      completedAt: this.#completedAt?.toISOString() ?? null,
      createdAt: this.#createdAt.toISOString()
    };
  }
}
