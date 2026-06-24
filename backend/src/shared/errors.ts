export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, `${resource.toUpperCase()}_NOT_FOUND`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SYNC_CONFLICT', 409, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 'FORBIDDEN', 403);
  }
}

export class MachineUnreachableError extends AppError {
  constructor(machineId: string, reason: string) {
    super(
      `Machine ${machineId} is unreachable: ${reason}`,
      'MACHINE_UNREACHABLE',
      503,
      { machineId, reason },
    );
  }
}

export class SSHError extends AppError {
  constructor(machineId: string, command: string, message: string) {
    super(
      `SSH command failed on ${machineId}: ${message}`,
      'SSH_ERROR',
      500,
      { machineId, command },
    );
  }
}

export class SyncError extends AppError {
  constructor(operationId: string, message: string, details?: Record<string, unknown>) {
    super(message, 'SYNC_ERROR', 500, { operationId, ...details });
  }
}
