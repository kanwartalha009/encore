/**
 * POST /client-log — client-side error beacon (diagnostic).
 *
 * The embedded admin runs in an iframe whose console we can't see in
 * production. Any uncaught client exception is sent here via
 * navigator.sendBeacon (which does NOT go through App Bridge's patched fetch,
 * so it works even when the app's authenticated fetch path is broken) and
 * lands in the Railway deploy logs as a single [client-error] line.
 *
 * Unauthenticated by design (errors must be reportable when auth is the thing
 * that's broken): payload is length-capped, logged verbatim behind a fixed
 * prefix, and never stored or echoed back.
 */
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const text = (await request.text()).slice(0, 4000);
    // One line, fixed prefix — easy to filter in Railway logs.
    console.error(`[client-error] ${text.replace(/\n/g, " | ")}`);
  } catch {
    // never throw from a diagnostics endpoint
  }
  return new Response(null, { status: 204 });
};

export const loader = async () => new Response(null, { status: 204 });
