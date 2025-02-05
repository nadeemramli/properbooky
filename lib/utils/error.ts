import { PostgrestError } from "@supabase/supabase-js";

/**
 * Custom error class for database operations
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly originalError: PostgrestError | null = null
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Type guard to check if an error is a PostgrestError
 */
export function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "details" in error &&
    "hint" in error
  );
}

/**
 * Safely extracts error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof DatabaseError) {
    return error.message;
  }
  if (isPostgrestError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

/**
 * Creates a DatabaseError from a PostgrestError
 */
export function createDatabaseError(error: unknown): DatabaseError {
  if (isPostgrestError(error)) {
    return new DatabaseError(error.message, error);
  }
  return new DatabaseError(getErrorMessage(error));
} 