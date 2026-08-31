/**
 * Public terms of service — linked from the Shopify App Store listing.
 * Served unauthenticated on the app's own domain.
 */

const UPDATED = "August 31, 2026";

export default function Terms() {
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
      <h1>Encore — Terms of Service</h1>
      <p>
        <em>Last updated: {UPDATED}</em>
      </p>
      <p>
        These terms govern use of the Encore app ("the App") by merchants who
        install it from the Shopify App Store. By installing or using the App
        you agree to these terms.
      </p>

      <h2>The service</h2>
      <p>
        The App lets merchants sell products on preorder, collect deposits and
        balances through Shopify's native payment and selling-plan
        infrastructure, cap preorder quantities, and capture and notify
        back-in-stock waitlists. Features may be added, changed, or removed as
        the App evolves.
      </p>

      <h2>Fees and billing</h2>
      <p>
        Paid plans are billed through the Shopify Billing API on the pricing
        shown in the App and on its listing, including any free trial period.
        Charges appear on the merchant's Shopify invoice. Plans can be changed
        or cancelled at any time from inside the App; uninstalling the App ends
        billing in accordance with Shopify's billing rules.
      </p>

      <h2>Merchant responsibilities</h2>
      <p>
        Merchants are responsible for the accuracy of their preorder offers —
        including ship-date estimates, deposit terms, and compliance of their
        storefront messaging with the consumer-protection laws that apply to
        their business. The App provides tooling; the commercial offer to the
        customer remains the merchant's.
      </p>

      <h2>Availability and liability</h2>
      <p>
        We aim for continuous availability but the App is provided "as is"
        without warranties of any kind. To the maximum extent permitted by law,
        our aggregate liability for any claim relating to the App is limited to
        the fees paid for the App in the three months preceding the claim. We
        are not liable for indirect or consequential damages, including lost
        profits or lost sales.
      </p>

      <h2>Data</h2>
      <p>
        Handling of merchant and customer data is described in our{" "}
        <a href="/privacy">Privacy Policy</a>, which forms part of these terms.
      </p>

      <h2>Termination</h2>
      <p>
        Merchants can stop using the App at any time by uninstalling it. We may
        suspend or terminate access for abuse, non-payment, or use that risks
        harm to Shopify, other merchants, or customers. Stored data is purged
        after uninstall as described in the Privacy Policy.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: use the support contact on the App's
        Shopify App Store listing or the Get help form inside the App.
      </p>
    </main>
  );
}
