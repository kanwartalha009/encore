/**
 * Client-safe display formatters.
 *
 * Must NOT import any `*.server` module. Routes use these helpers inside their
 * components (render), and React Router only strips server code from the
 * `loader`/`action`/`headers`/`middleware` exports — anything a component
 * touches gets bundled for the client. Keeping pure formatters here lets both
 * server modules and route components import them without dragging server-only
 * code (Prisma, secrets, etc.) into the client bundle.
 */

/** Format integer cents as a whole-dollar USD string, e.g. 123456 -> "$1,235". */
export function formatGmv(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
