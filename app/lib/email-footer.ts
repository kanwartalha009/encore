/**
 * Shopper-facing unsubscribe copy (2026-09-28) — the back-in-stock email footer
 * and the /unsubscribe page, in every language Encore's emails support.
 * Pure data + helpers, safe on client and server. `{store}` is the store name.
 */

export type UnsubCopy = {
  footer: string;
  title: string;
  question: string;
  button: string;
  done: string;
  invalid: string;
};

export const UNSUB_COPY: Record<string, UnsubCopy> = {
  en: {
    footer: "You're getting this because you asked {store} to tell you when this item is back. Stop these emails:",
    title: "Unsubscribe",
    question: "Stop back-in-stock emails from {store}?",
    button: "Unsubscribe",
    done: "You're unsubscribed. You won't get more back-in-stock emails from {store}.",
    invalid: "This link has expired or isn't valid.",
  },
  es: {
    footer: "Recibes este correo porque pediste a {store} que te avisara cuando este artículo volviera. Dejar de recibir estos correos:",
    title: "Cancelar suscripción",
    question: "¿Dejar de recibir avisos de reposición de {store}?",
    button: "Cancelar suscripción",
    done: "Suscripción cancelada. No recibirás más avisos de reposición de {store}.",
    invalid: "Este enlace ha caducado o no es válido.",
  },
  fr: {
    footer: "Vous recevez cet e-mail car vous avez demandé à {store} d'être prévenu du retour de cet article. Ne plus recevoir ces e-mails :",
    title: "Se désabonner",
    question: "Ne plus recevoir les alertes de retour en stock de {store} ?",
    button: "Se désabonner",
    done: "Vous êtes désabonné. Vous ne recevrez plus d'alertes de retour en stock de {store}.",
    invalid: "Ce lien a expiré ou n'est pas valide.",
  },
  de: {
    footer: "Du erhältst diese E-Mail, weil du {store} gebeten hast, dich zu benachrichtigen, sobald dieser Artikel wieder da ist. Diese E-Mails abbestellen:",
    title: "Abmelden",
    question: "Keine Wieder-verfügbar-E-Mails mehr von {store} erhalten?",
    button: "Abmelden",
    done: "Du bist abgemeldet. Du erhältst keine Wieder-verfügbar-E-Mails mehr von {store}.",
    invalid: "Dieser Link ist abgelaufen oder ungültig.",
  },
  it: {
    footer: "Ricevi questa email perché hai chiesto a {store} di avvisarti quando questo articolo tornerà disponibile. Non ricevere più queste email:",
    title: "Annulla iscrizione",
    question: "Non ricevere più gli avvisi di disponibilità di {store}?",
    button: "Annulla iscrizione",
    done: "Iscrizione annullata. Non riceverai più avvisi di disponibilità da {store}.",
    invalid: "Questo link è scaduto o non è valido.",
  },
  pt: {
    footer: "Recebe este email porque pediu à {store} para avisar quando este artigo voltasse. Deixar de receber estes emails:",
    title: "Cancelar subscrição",
    question: "Deixar de receber alertas de reposição da {store}?",
    button: "Cancelar subscrição",
    done: "Subscrição cancelada. Não vai receber mais alertas de reposição da {store}.",
    invalid: "Este link expirou ou não é válido.",
  },
  nl: {
    footer: "Je ontvangt deze e-mail omdat je {store} hebt gevraagd je te laten weten wanneer dit artikel terug is. Deze e-mails stopzetten:",
    title: "Afmelden",
    question: "Geen weer-op-voorraad-e-mails meer van {store}?",
    button: "Afmelden",
    done: "Je bent afgemeld. Je ontvangt geen weer-op-voorraad-e-mails meer van {store}.",
    invalid: "Deze link is verlopen of ongeldig.",
  },
  pl: {
    footer: "Otrzymujesz tę wiadomość, ponieważ poprosiłeś(-aś) {store} o powiadomienie, gdy ten produkt wróci. Zrezygnuj z tych e-maili:",
    title: "Wypisz się",
    question: "Zrezygnować z powiadomień o dostępności od {store}?",
    button: "Wypisz się",
    done: "Wypisano. Nie otrzymasz już powiadomień o dostępności od {store}.",
    invalid: "Ten link wygasł lub jest nieprawidłowy.",
  },
};

/** Copy for a buyer locale ("pt-BR" → pt), English when unsupported. */
export function unsubCopy(locale?: string | null): UnsubCopy {
  const base = String(locale ?? "").toLowerCase().split(/[-_]/)[0];
  return UNSUB_COPY[base] ?? UNSUB_COPY.en;
}

export function fillStore(text: string, store: string): string {
  return text.split("{store}").join(store || "this store");
}

/** Plain-text footer appended to a back-in-stock email. */
export function unsubscribeFooter(locale: string | null | undefined, store: string, url: string): string {
  return `\n\n—\n${fillStore(unsubCopy(locale).footer, store)}\n${url}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where shopper replies go: the merchant's Reply-to email (Settings → Advanced)
 * when it's a real address, else the store's contact email. The old
 * placeholder default hello@<shop>.myshopify.com isn't a mailbox, so it's ignored.
 */
export function pickReplyTo(saved: unknown, contactEmail?: string | null): string | undefined {
  const s = typeof saved === "string" ? saved.trim() : "";
  if (s && EMAIL_RE.test(s) && !/@[^@]*\.myshopify\.com$/i.test(s)) return s;
  const c = (contactEmail ?? "").trim();
  return c && EMAIL_RE.test(c) ? c : undefined;
}
