import { HttpsError } from 'firebase-functions/v2/https';
import type { z } from 'zod';

export function parseCallableInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.map(String).join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    throw new HttpsError('invalid-argument', `Invalid request: ${details}`);
  }
  return result.data;
}
