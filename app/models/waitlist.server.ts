import prisma from "../db.server";

export type WaitlistGroup = {
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  subscribers: number;
  email: number;
  sms: number;
  both: number;
  newestSignupAt: string | null;
  convertedCount: number;
  notified: number;
  failed: number;
};

export async function listWaitlistGroups(
  shop: string,
): Promise<WaitlistGroup[]> {
  const subs = await prisma.waitlistSubscription.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  const map = new Map<string, WaitlistGroup>();
  for (const s of subs) {
    const key = `${s.productId}::${s.variantId ?? ""}`;
    let g = map.get(key);
    if (!g) {
      g = {
        productId: s.productId,
        productTitle: s.productTitle ?? s.productId,
        variantTitle: s.variantTitle ?? null,
        subscribers: 0,
        email: 0,
        sms: 0,
        both: 0,
        newestSignupAt: null,
        convertedCount: 0,
        notified: 0,
        failed: 0,
      };
      map.set(key, g);
    }
    g.subscribers += s.subscribed ? 1 : 0;
    if (s.channel === "EMAIL") g.email += 1;
    else if (s.channel === "SMS") g.sms += 1;
    else if (s.channel === "BOTH") g.both += 1;
    if (!g.newestSignupAt || s.createdAt > new Date(g.newestSignupAt)) {
      g.newestSignupAt = s.createdAt.toISOString();
    }
    if (s.convertedAt) g.convertedCount += 1;
    const ns = (s as unknown as { notifyStatus?: string | null }).notifyStatus;
    if (ns === "SENT") g.notified += 1;
    else if (ns === "FAILED") g.failed += 1;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.subscribers - a.subscribers,
  );
}
