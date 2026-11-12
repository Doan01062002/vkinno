export const isCheckError = (e: unknown) => e instanceof Error && e.message.includes('CHECK constraint failed');
export const isUniqueError = (e: unknown, column: string) =>
  e instanceof Error && e.message.includes('UNIQUE constraint failed') && e.message.includes(column);
