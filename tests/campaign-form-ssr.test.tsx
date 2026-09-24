/**
 * SSR reproduction: the live /edit page truncates after the "Advanced" card —
 * the "Select product" section never renders. Render CampaignForm in edit mode
 * exactly like app.campaigns.$id.edit.tsx does and catch the real error.
 * Polaris web components render as plain custom-element tags on the server,
 * so this also guards the port off Polaris React (2026-09-24).
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import CampaignForm from "../app/components/CampaignForm";

const initialValues = {
  name: "test",
  internalNotes: "",
  markets: [] as string[],
  productMode: "specific",
  selectedProducts: [{ id: "gid://shopify/Product/1001", title: "Aurora Hoodie", variants: 3 }],
  selectedVariants: [
    { productId: "gid://shopify/Product/1001", variantId: "gid://shopify/ProductVariant/2001", productTitle: "Aurora Hoodie", variantTitle: "Indigo / S", unitsOffered: "100", endQty: "", availability: "now", availStart: "", availEnd: "" },
    { productId: "gid://shopify/Product/1001", variantId: "gid://shopify/ProductVariant/2002", productTitle: "Aurora Hoodie", variantTitle: "Indigo / M", unitsOffered: "100", endQty: "", availability: "now", availStart: "", availEnd: "" },
    { productId: "gid://shopify/Product/1001", variantId: "gid://shopify/ProductVariant/2003", productTitle: "Aurora Hoodie", variantTitle: "Indigo / L", unitsOffered: "100", endQty: "", availability: "now", availStart: "", availEnd: "" },
  ],
  perVariantRules: false,
  collectionId: "",
  triggerType: "manual",
  stockThreshold: "0",
  startDate: "",
  endDate: "",
  shipDate: "2026-07-10",
  cohortName: "July 2026 — test",
  shipBufferDays: "0",
  autoNotifyShipChange: true,
  paymentMode: "pay_now",
  depositKind: "percent",
  depositAmount: "20",
  balanceCaptureDays: "7",
  moqEnabled: false,
  moqUnits: "",
  moqDeadline: "",
  cartMode: "split",
  customerTags: "",
  restrictedCountries: "",
  orderTags: "",
  zoneOverrides: "",
  dunningSteps: "",
  discountEnabled: true,
  discountKind: "percent",
  discountAmount: "10",
  ctaLabel: "Preorder",
  ctaPlacement: "replace",
  deliveryNote: "",
  status: "LIVE",
} as never;

describe("CampaignForm SSR (edit mode)", () => {
  it("renders the full form including the Select product section", () => {
    const Stub = createRoutesStub([
      {
        path: "/app/campaigns/:id/edit",
        Component: () => (
          <CampaignForm
            mode="edit"
            pageTitle="test"
            pageSubtitle="Edit preorder"
            initialValues={initialValues}
            collections={[]}
            marketsList={null}
            currency="PKR"
            backTo="/app/campaigns"
          />
        ),
      },
    ]);
    const html = renderToString(
      <Stub initialEntries={["/app/campaigns/abc/edit"]} />,
    );
    expect(html).toContain("Select product");
    expect(html).toContain("Aurora Hoodie");
    expect(html).toContain("<s-page");
    expect(html).toContain("<s-table");
    // React 18 must never emit a stringified false boolean on a custom element.
    expect(html).not.toMatch(/(disabled|loading|checked|selected|required)="false"/);
  });
});
