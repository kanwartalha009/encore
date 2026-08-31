/**
 * Public privacy policy — required for the Shopify App Store listing.
 * Served unauthenticated on the app's own domain so the listing URL is
 * independent of any other deployment.
 */

const UPDATED = "August 31, 2026";

export default function Privacy() {
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
        Encore ("the App") provides preorder and back-in-stock functionality for
        Shopify stores. This policy describes what information the App collects
        from merchants and their customers, why it is collected, and how it is
        handled.
      </p>

      <h2>Information we collect</h2>
      <p>
        When a merchant installs the App, we receive the store's domain and an
        API access token via Shopify's standard authorization flow. To operate
        preorders and waitlists, the App stores: preorder rule configuration
        created by the merchant; product and variant identifiers and inventory
        signals needed to start and stop preorders; order references for orders
        that contain preorder items, including deposit and balance amounts; and
        customer email addresses (with locale) submitted voluntarily through the
        back-in-stock signup form or associated with a preorder, used solely to
        deliver the notifications the customer requested.
      </p>

      <h2>How we use information</h2>
      <p>
        Data is used exclusively to provide the App's features to the merchant:
        running preorder campaigns, enforcing purchase caps, tagging preorder
        orders, sending back-in-stock and preorder-related notifications, and
        showing merchants aggregate performance of their campaigns. We do not
        sell personal information, use it for advertising, or share it with
        third parties except the service providers required to deliver
        notifications the merchant configures (for example, the merchant's own
        Klaviyo account or Shopify Flow).
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        The App complies with Shopify's mandatory privacy webhooks. When a
        customer requests their data or its deletion, we honor the request via
        Shopify's <code>customers/data_request</code> and{" "}
        <code>customers/redact</code> processes. When a merchant uninstalls the
        App, the store's access token is invalidated immediately and all stored
        data for that store is permanently purged within 48 hours via the{" "}
        <code>shop/redact</code> process.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over HTTPS and stored with access limited to the
        App's backend. Third-party credentials the merchant connects (such as
        Klaviyo) are encrypted at rest.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or data requests, contact us through the support
        details listed on the App's Shopify App Store page, or use the Get help
        form inside the App.
      </p>
    </main>
  );
}
