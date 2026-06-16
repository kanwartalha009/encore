# Encore — Shopify Flow templates (build + export on the Mac)

Flow **template** extensions ship a `.flow` workflow file that is **exported from
the Flow editor** — it can't be hand-authored. Build each workflow once in a dev
store that has Encore + Flow installed, export it, and add a `flow_template`
extension here referencing the `.flow` file. See
https://shopify.dev/docs/apps/build/flow/templates/create-a-template

For each template: in **Apps → Flow → Create workflow**, pick the Encore trigger,
then add **Encore — Send email** (set `message_type` + map `recipient` and the
variables), export, and drop the `.flow` here with a matching `shopify.extension.toml`:

```toml
[[extensions]]
type = "flow_template"
name = "Encore — Email customer on restock"
handle = "encore-tmpl-back-in-stock"
template = "./back-in-stock.flow"
```

## Templates to build

1. **Email customer on restock** — Trigger `Encore — Back-in-stock ready` → `Encore — Send email` (`message_type = back_in_stock`, `recipient = {{ trigger.email }}`, map `product` / `variant` / `product_url` / `locale`).
2. **Email customer on pre-order** — Trigger `Encore — Preorder placed` → `Encore — Send email` (`message_type = preorder_confirmation`, `recipient = {{ order.customer.email }}`, map `product` / `ship_date` / `order_name`).
3. **Email customer on ship-date change** — Trigger `Encore — Ship date updated` → `Encore — Send email` (`message_type = ship_date_update`, map `old_ship_date` / `new_ship_date`).
4. **Email customer balance due** — Trigger `Encore — Balance due` → `Encore — Send email` (`message_type = balance_due`, map `balance` / `due_date` / `pay_link`).
5. **Enrich pre-order orders** — Trigger `Encore — Preorder placed` → built-in *Add order tags* / *Add order metafield* / *Add order note* with the ship date + deposit/balance (no Encore action needed).

Leave copy fields blank to use the merchant's editable templates (Settings →
Notifications); fill `subject_override` / `body_override` only for per-workflow tweaks.
