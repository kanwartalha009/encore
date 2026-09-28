/**
 * Public privacy policy — required for the Shopify App Store listing.
 * Served unauthenticated on the app's own domain so the listing URL is
 * independent of any other deployment.
 *
 * 2026-09-28: lists every kind of data Encore stores (incl. names and phone
 * numbers), the service providers that process it, retention, and a real
 * contact. The company name and support email come from env
 * (ENCORE_LEGAL_NAME, ENCORE_SUPPORT_EMAIL) so no contact detail is invented
 * here; until they're set the page falls back to the in-app Get help form.
 */
import { useLoaderData } from "react-router";
import { legalContact } from "../lib/legal.server";

const UPDATED = "September 28, 2026";

export const loader = () => legalContact();

export default function Privacy() {
  const { company, email } = useLoaderData<typeof loader>();
  const who = company || "The developer of Encore";
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>Encore — Privacy Policy</h1>
      <p>
        <em>Last updated: {UPDATED}</em>
      </p>
      <p>
        Encore (“the App”) provides preorder, back-in-stock and low-stock
        features for Shopify stores. {who} (“we”) operates the App. This policy
        explains what information the App collects from merchants and their
        customers, why, who processes it, how long it is kept, and how to reach
        us. For customer data, the merchant is the data controller and we act
        as their processor.
      </p>

      <h2>Information we collect</h2>
      <p>
        <strong>From merchants:</strong> the store’s domain, name and email
        addresses, and an API access token received through Shopify’s standard
        authorization flow; the settings, preorder rules, email templates and
        translations the merchant creates; the plan and billing status of the
        App subscription; and, if the merchant connects Klaviyo, a Klaviyo
        access token or API key.
      </p>
      <p>
        <strong>About the merchant’s customers:</strong> for orders that
        contain preorder items — the customer’s name and email address, the
        order reference, the items, deposit and balance amounts, payment
        status, market and checkout language. For back-in-stock sign-ups — the
        email address, and a phone number if the store asks for one and the
        customer gives it, the product the customer is waiting for, language,
        market, whether and when they ticked the consent box, and whether the
        notification was sent. The App does not send text messages; if the
        merchant chooses, back-in-stock sign-ups (email and phone) are saved to
        the merchant’s own Klaviyo account or as customers in their Shopify
        store, and the merchant can export them. Customer data is used only to
        run the features the merchant turned on.
      </p>
      <p>
        <strong>Automatically:</strong> standard server logs (such as IP
        address and request time) kept by our hosting provider for security and
        troubleshooting. The storefront script does not use tracking cookies.
      </p>

      <h2>How we use information</h2>
      <p>
        Data is used only to provide the App to the merchant: running preorder
        campaigns, enforcing preorder limits, tagging preorder orders, sending
        the back-in-stock and preorder emails the merchant configures, and
        showing the merchant how their campaigns perform. We do not sell
        personal information or use it for advertising.
      </p>

      <h2>Service providers (subprocessors)</h2>
      <p>We share data only with the providers needed to run the App:</p>
      <ul>
        <li>Shopify — the platform the App runs on (store, order and product data).</li>
        <li>Railway — hosting and database for the App.</li>
        <li>
          Our transactional email provider — sends the back-in-stock and preorder
          emails when the merchant uses Encore’s own email sending (via Shopify Flow).
        </li>
        <li>
          Klaviyo — only when the merchant connects their own Klaviyo account;
          sign-ups and preorder events are sent to that account.
        </li>
        <li>
          The Nova Apps platform (operated by us) — installation, billing and
          support records, and copies of Shopify’s privacy requests so they can
          be tracked to completion.
        </li>
      </ul>

      <h2>Data retention and deletion</h2>
      <p>
        We keep data while the App is installed. The App handles Shopify’s
        mandatory privacy webhooks: a customer data request is gathered and
        sent to the store owner to answer, and a customer deletion request
        removes that customer’s back-in-stock sign-ups (by email or phone) and
        removes their name and email from preorder records. When a merchant
        uninstalls the App, the access token stops working immediately and all
        stored data for that store is permanently deleted 48 hours later
        (unless the App is reinstalled within that time). Customers can stop
        back-in-stock emails with the unsubscribe link in every such email.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over HTTPS and stored with access limited to the
        App’s backend. Klaviyo tokens and API keys are encrypted at rest
        (AES-256-GCM) and are never shown again after they are saved.
      </p>

      <h2>Your rights</h2>
      <p>
        Customers of a store should contact that store to access, correct or
        delete their data; the store can make the request through Shopify, and
        the App carries it out. Merchants can contact us directly.
      </p>

      <h2>Contact</h2>
      <p>
        {email ? (
          <>
            Privacy questions or requests: <a href={`mailto:${email}`}>{email}</a>
            {company ? ` (${company})` : ""}.
          </>
        ) : (
          <>For privacy questions or requests, use the Get help form inside the App.</>
        )}
      </p>
    </main>
  );
}
