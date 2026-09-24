/**
 * Polaris `linkComponent` (R1.5 session fix, 2026-09-13).
 *
 * Every Polaris `Button url=`, `Link url=`, `Page backAction`, card action…
 * used to render a bare <a href>, i.e. a FULL document navigation inside the
 * admin iframe. That drops the `shop` / `host` / `id_token` params Shopify
 * appends, so `authenticate.admin` redirected to /auth/login and the merchant
 * saw a "Log in — Shop domain" form in the middle of their admin (Railway
 * 2026-09-13 16:14: `GET /app/low-stock 302` → `GET /auth/login 200`).
 *
 * Internal URLs now go through React Router's <Link>: client-side navigation,
 * loaders fetched with the App Bridge session token, no reload, and it is
 * what makes navigation feel instant. External / download links stay <a>.
 */
import { forwardRef } from "react";
import { Link } from "react-router";
import type { LinkLikeComponentProps } from "@shopify/polaris/build/ts/src/utilities/link/types";

const isInternal = (url: string) => url.startsWith("/") && !url.startsWith("//");

export const RouterLink = forwardRef<HTMLAnchorElement, LinkLikeComponentProps>(function RouterLink(
  { url, children, external, target, download, ...rest },
  ref,
) {
  if (external || download || target === "_blank" || !isInternal(url)) {
    return (
      <a
        ref={ref}
        href={url}
        target={external ? "_blank" : target}
        rel={external ? "noopener noreferrer" : undefined}
        download={download}
        {...rest}
      >
        {children}
      </a>
    );
  }
  return (
    <Link ref={ref} to={url} {...rest}>
      {children}
    </Link>
  );
});
