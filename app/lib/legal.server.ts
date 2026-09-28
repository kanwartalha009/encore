/**
 * Company name + support email for the public privacy / terms pages
 * (2026-09-28). Set on the server so the pages never show invented details:
 *   ENCORE_LEGAL_NAME     e.g. the registered company name
 *   ENCORE_SUPPORT_EMAIL  the support / privacy contact address
 */
export function legalContact(): { company: string; email: string } {
  const email = (process.env.ENCORE_SUPPORT_EMAIL ?? "").trim();
  return {
    company: (process.env.ENCORE_LEGAL_NAME ?? "").trim(),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
  };
}
