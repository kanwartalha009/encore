import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Encore — Preorder &amp; Back in Stock</h1>
        <p className={styles.text}>
          Sell what isn&apos;t on the shelf yet. Preorders, deposits and
          back-in-stock alerts for Shopify stores — set up in minutes, no code.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Enter your shop domain to install or open Encore</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Continue
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Preorders that run themselves</strong>. Sell out-of-stock or
            upcoming products with automatic start and stop rules — full
            payment, deposits, or pay later.
          </li>
          <li>
            <strong>Never oversell</strong>. Hard caps enforced at checkout, and
            every preorder tagged and tracked through to fulfillment.
          </li>
          <li>
            <strong>Back-in-stock alerts that convert</strong>. Capture demand
            with waitlists and notify customers by email the moment inventory
            returns.
          </li>
        </ul>
        <p style={{ marginTop: 24, fontSize: 13, opacity: 0.7 }}>
          <a href="/privacy">Privacy Policy</a>
          {" · "}
          <a href="/terms">Terms of Service</a>
        </p>
      </div>
    </div>
  );
}
