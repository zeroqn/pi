/** Four one-line coercions and `bind`, duplicated rather than shared: the contract forbids an
 * import between the two packages (ticket 03, C8).
 */
export const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
export const num = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);
export const bool = (value: unknown): boolean => value === true;
export const errorText = (value: unknown): string => (value instanceof Error ? value.message : String(value));
