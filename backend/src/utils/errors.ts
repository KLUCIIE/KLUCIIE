import { z } from 'zod'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND')
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN')
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message, 'BAD_REQUEST')
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT')
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, message, 'RATE_LIMITED')
  }
}

export type ValidationErrorDetail = {
  field: string
  message: string
}

export class ValidationError extends AppError {
  constructor(details: ValidationErrorDetail[]) {
    super(400, 'Validation failed', 'VALIDATION_ERROR')
    this.details = details
  }
  details: ValidationErrorDetail[]
}

export function handleZodError(error: z.ZodError): ValidationError {
  return new ValidationError(
    error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  )
}
