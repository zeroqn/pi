/** The coercions rlm's host functions need, duplicated rather than shared: the contract forbids an
 * import between the two packages (ticket 03, C8). `bind` lives in `host-util.ts`.
 */
export const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
export const num = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);
export const errorText = (value: unknown): string => (value instanceof Error ? value.message : String(value));
