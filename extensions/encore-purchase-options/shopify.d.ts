import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/PurchaseOptionsAction.tsx' {
  const shopify:
    | import('@shopify/ui-extensions/admin.product-purchase-option.action.render').Api
    | import('@shopify/ui-extensions/admin.product-variant-purchase-option.action.render').Api;
  const globalThis: { shopify: typeof shopify };
}
