/* SOURCE of assets/encore.js — edit HERE, then minify (see banner in assets/encore.js). */
/* Encore storefront runtime.
 *
 * One file, referenced by every Encore app block (Shopify dedupes it). It reads
 * the per-block data-* attributes rendered in Liquid, asks the app over the
 * /apps/encore/config app proxy whether this product is on preorder / low stock
 * / back-in-stock, and enhances the page accordingly. No theme code is touched.
 *
 * Written in plain ES5-style functions for broad theme compatibility.
 */
(function () {
  "use strict";

  var PROXY = (window.EncoreProxyBase || "/apps/encore").replace(/\/$/, "");
  var configCache = {};

  // ---------- helpers ----------
  function pageMarket() {
    var el = document.querySelector("[data-encore-preorder][data-market]");
    return el ? el.getAttribute("data-market") || "" : "";
  }

  function fetchConfig(productId, locale, market) {
    var key = productId + "|" + (locale || "") + "|" + (market || "");
    if (configCache[key]) return configCache[key];
    var url =
      PROXY +
      "/config?product_id=" +
      encodeURIComponent(productId) +
      "&locale=" +
      encodeURIComponent(locale || "") +
      "&market_id=" +
      encodeURIComponent(market || "");
    configCache[key] = fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then(function (r) {
        return r && r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
    return configCache[key];
  }

  function interpolate(tmpl, vars) {
    return String(tmpl == null ? "" : tmpl)
      .replace(/\{\{\s*shipping_date\s*\}\}/g, vars.date || "")
      .replace(/\{\{\s*date\s*\}\}/g, vars.date || "")
      .replace(/\{\s*n\s*\}/g, vars.n != null ? vars.n : "")
      .replace(/\{\{\s*count\s*\}\}/g, vars.n != null ? vars.n : "");
  }

  function readJSON(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function closestForm(el) {
    var f = el.closest ? el.closest('form[action*="/cart/add"]') : null;
    return f || document.querySelector('form[action*="/cart/add"]');
  }

  function currentVariantId(form, fallback) {
    if (form) {
      var input = form.querySelector('[name="id"]');
      if (input && input.value) return input.value;
    }
    var m = /[?&]variant=(\d+)/.exec(window.location.search);
    return m ? m[1] : fallback;
  }

  // Fire cb whenever the shopper changes variant. Themes differ wildly here:
  // some use named selects (id / options[]), Debut/Brooklyn use unnamed
  // `data-single-option-selector`s and update the hidden master select
  // programmatically (no event), OS 2.0 themes swap sections in place and
  // rewrite the URL. So: any change inside the form, the common custom
  // events, popstate, AND a cheap watch on the master variant id.
  function onVariantChange(form, cb) {
    var last = currentVariantId(form, null);
    function check() {
      var now = currentVariantId(form, null);
      if (now !== last) {
        last = now;
        cb();
      }
    }
    var later = function () {
      window.setTimeout(check, 60);
    };
    document.addEventListener("change", later, true);
    document.addEventListener("variant:change", later);
    document.addEventListener("variantChange", later);
    document.addEventListener("variant:changed", later);
    window.addEventListener("popstate", later);
    if (form && window.MutationObserver) {
      new MutationObserver(later).observe(form, { subtree: true, attributes: true, childList: true });
    }
    window.setInterval(check, 400);
  }

  function setProp(form, name, value) {
    if (!form) return;
    var existing = form.querySelectorAll('input[data-encore="1"]');
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getAttribute("data-encore-name") === name) {
        existing[i].value = value;
        return;
      }
    }
    var input = document.createElement("input");
    input.type = "hidden";
    input.setAttribute("data-encore", "1");
    input.setAttribute("data-encore-name", name);
    input.name = "properties[" + name + "]";
    input.value = value;
    form.appendChild(input);
  }

  function setSellingPlan(form, id) {
    if (!form) return;
    var input = form.querySelector('input[name="selling_plan"][data-encore="1"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.setAttribute("data-encore", "1");
      input.name = "selling_plan";
      form.appendChild(input);
    }
    input.value = id;
  }

  var THEME_BUY_SELECTORS = [
    '[name="add"]',
    ".product-form__submit",
    ".shopify-payment-button",
    'button[type="submit"]',
  ];

  function hideThemeBuyButtons(form, root) {
    if (!form) return;
    THEME_BUY_SELECTORS.forEach(function (s) {
      var nodes = form.querySelectorAll(s);
      for (var i = 0; i < nodes.length; i++) {
        if (root.contains(nodes[i])) continue;
        if (nodes[i].__encoreDisplay == null) nodes[i].__encoreDisplay = nodes[i].style.display || "";
        nodes[i].style.display = "none";
      }
    });
  }

  function showThemeBuyButtons(form, root) {
    if (!form) return;
    THEME_BUY_SELECTORS.forEach(function (s) {
      var nodes = form.querySelectorAll(s);
      for (var i = 0; i < nodes.length; i++) {
        if (root.contains(nodes[i])) continue;
        if (nodes[i].__encoreDisplay != null) {
          nodes[i].style.display = nodes[i].__encoreDisplay;
          nodes[i].__encoreDisplay = null;
        }
      }
    });
  }

  function clearEncoreFields(form) {
    if (!form) return;
    var nodes = form.querySelectorAll('input[data-encore="1"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
  }

  // Per-variant offer state from the config, ignoring stock:
  //   "none"     → this variant is not part of the campaign
  //   "soldout"  → its preorder allocation is exhausted
  //   "offer"    → preorder can be offered
  function variantOffer(p, vid) {
    if (!p) return "none";
    if (p.variants && p.variantScoped) {
      var v = p.variants[String(vid)];
      if (!v) return "none";
      return v.soldOut ? "soldout" : "offer";
    }
    if (p.soldOut || !p.active) return p.soldOut ? "soldout" : "none";
    return "offer";
  }

  // Variant-level stock from the embed's inventory JSON; falls back to the
  // block's product-level attribute. Untracked variants are always in stock.
  function variantInStock(root, productId, vid) {
    var inv = readJSON('[data-encore-inventory="' + productId + '"]');
    var row = inv && inv[String(vid)];
    if (row) return row.tracked ? Number(row.qty) > 0 : true;
    return root.getAttribute("data-in-stock") === "true";
  }

  // ---------- Universal auto-mount (works on ANY theme, vintage included) ----
  // The app embed renders hidden fallback shells for the Preorder button,
  // Notify-me and Low-stock UI on every product page. If the merchant added
  // the matching app block, the block wins and the fallback is discarded.
  // Otherwise the shell is moved right next to the theme's add-to-cart button
  // and initialized like a block — zero theme edits required.
  function findProductForm() {
    // Prefer the form whose hidden [name=id] exists (the real product form,
    // not a search or quick-buy form).
    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('[name="id"]')) return forms[i];
    }
    return forms[0] || null;
  }

  function findBuyAnchor(form) {
    if (!form) return null;
    var sels = ['[name="add"]', ".product-form__submit", 'button[type="submit"]', 'input[type="submit"]'];
    for (var i = 0; i < sels.length; i++) {
      var n = form.querySelector(sels[i]);
      if (n) return n;
    }
    return null;
  }

  function autoMount() {
    var wrap = document.querySelector("[data-encore-auto-wrap]");
    if (!wrap) return;
    var form = findProductForm();
    var anchor = findBuyAnchor(form);
    var kinds = ["data-encore-preorder", "data-encore-notify", "data-encore-lowstock"];
    for (var i = 0; i < kinds.length; i++) {
      // Query globally, not just inside the wrap: on a section re-render the
      // shell may already have been moved next to the buy button.
      var auto = document.querySelector("[" + kinds[i] + "][data-encore-auto]");
      if (!auto) continue;
      // A real app block for this feature exists → block wins, drop the
      // fallback (even if it was mounted earlier) so nothing renders twice.
      if (document.querySelector("[" + kinds[i] + "]:not([data-encore-auto])")) {
        if (auto.parentNode) auto.parentNode.removeChild(auto);
        continue;
      }
      if (wrap.contains(auto)) {
        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(auto, anchor.nextSibling);
        } else if (form) {
          form.appendChild(auto);
        }
        // else: no add-to-cart form found — leave the shell in the hidden wrap
        // (nothing renders; better than a floating button in the wrong place).
      }
    }
  }


  // ---------- Smart badge placement ----------
  // Where the "Preorder" badge goes, in priority order for "auto":
  //   price  → inline right after the product price
  //   image  → overlay on the main product image (top-left / top-right)
  //   button → above the Preorder button (always works)
  var PRICE_SELECTORS = [
    ".price__regular .price-item--regular",
    ".price-item--regular",
    ".product__price",
    ".product-single__price",
    ".product-price",
    "[data-product-price]",
    ".price__current",
    ".product__price-container .price",
    ".price",
    '[class*="price"]:not([class*="compare"]):not([class*="unit"])',
  ];

  // Product-card detection. Deliberately NOT ".grid__item" — Debut, Dawn and
  // most OS 2.0 themes use grid__item for page-layout columns too, which would
  // rule out the main product price and image. Cards are lists / articles /
  // explicit card classes / recommendation sections.
  var CARD_SELECTOR =
    "li, article, .card, .card-wrapper, .product-card, .product-item, .grid-product, " +
    ".product-grid-item, .grid__item--collection, [class*='recommend'], [class*='recently'], " +
    "[class*='related'], [class*='upsell'], [class*='cross-sell']";
  function inCard(el) {
    return !!(el.closest && el.closest(CARD_SELECTOR));
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findPriceEl(form, root) {
    for (var i = 0; i < PRICE_SELECTORS.length; i++) {
      var nodes = document.querySelectorAll(PRICE_SELECTORS[i]);
      var best = null;
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        if (root.contains(n) || !isVisible(n)) continue;
        if (n.closest && n.closest("header, footer, nav, [data-encore-preorder]")) continue;
        // Prefer the price that sits BEFORE the Encore block in document order
        // (the main product price — many themes render it INSIDE the buy form,
        // e.g. Debut, so we anchor on the block, not the form) and skip prices
        // inside product cards (recommendations / recently viewed).
        if (root.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
        if (inCard(n)) continue;
        best = n; // last match preceding the block = closest to it
      }
      if (best) return best;
    }
    return null;
  }

  function findMainImage(form, root) {
    var imgs = document.querySelectorAll("img");
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (root.contains(im) || !isVisible(im)) continue;
      if (im.closest && im.closest("header, footer, nav, [class*='thumb']")) continue;
      if (inCard(im)) continue;
      var r = im.getBoundingClientRect();
      if (r.width < 200) continue;
      var area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = im; }
    }
    return best;
  }

  function placeBadge(badge, root, form, ui, position) {
    var pos = position || "auto";
    if (pos === "auto" || pos === "price") {
      var price = findPriceEl(form, root);
      if (price && price.parentNode) {
        badge.className += " encore-badge--inline";
        price.parentNode.insertBefore(badge, price.nextSibling);
        return "price";
      }
      if (pos === "price") pos = "auto";
    }
    if (pos === "auto" || pos === "image-left" || pos === "image-right") {
      var img = findMainImage(form, root);
      var host = img && img.parentNode;
      if (host) {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        badge.className += " encore-badge--overlay " + (pos === "image-right" ? "encore-badge--tr" : "encore-badge--tl");
        host.appendChild(badge);
        return pos === "image-right" ? "image-right" : "image-left";
      }
    }
    ui.insertBefore(badge, ui.firstChild);
    return "button";
  }

  // ---------- Preorder ----------
  function initPreorder(root) {
    if (root.__encoreInit) return;
    root.__encoreInit = true;

    var productId = root.getAttribute("data-product-id");
    var locale = root.getAttribute("data-locale") || "en";
    var placement = root.getAttribute("data-placement") || "stack";
    var showBadge = root.getAttribute("data-show-badge") === "true";
    var ui = root.querySelector("[data-encore-pre-ui]");
    var btn = root.querySelector("[data-encore-pre-btn]");
    var note = root.querySelector("[data-encore-pre-note]");
    var market = root.getAttribute("data-market") || pageMarket();

    fetchConfig(productId, locale, market).then(function (cfg) {
      // Drop the CLS skeleton now that we know the answer (button takes its
      // place at the same height, or the slot collapses if not on preorder).
      var skel = root.querySelector("[data-encore-pre-skeleton]");
      if (skel && skel.parentNode) skel.parentNode.removeChild(skel);

      if (!cfg || !cfg.preorder) return;
      var p = cfg.preorder;
      var form = closestForm(root);

      // Auto-mounted shells carry no per-block placement choice — follow the
      // placement configured in the Encore admin instead.
      if (root.hasAttribute("data-encore-auto") && p.placement) placement = p.placement;
      var replaceTheme = placement === "replace" || !!p.hideBuyNow;
      var idleLabel = p.label || btn.textContent;
      var badge = null;
      var mixedEl = null;
      var current = null;

      function ensureBadge() {
        if (badge || !showBadge || p.showBadge === false) return;
        badge = document.createElement("span");
        badge.className = "encore encore-badge encore-badge--" + (p.badgeStyle || "pill");
        badge.textContent = p.badge || "Preorder";
        badge.setAttribute("data-encore-badge", "1");
        placeBadge(badge, root, form, ui, p.badgePosition || root.getAttribute("data-badge-position") || "auto");
      }

      // Everything the cart line needs: properties + selling plan + market.
      function armForm() {
        if (!form) return;
        if (p.lineItem && p.lineItem.enabled) {
          setProp(form, "_preorder", "true");
          if (p.shipDate) setProp(form, "_preorder_ship_date", p.shipDate);
          var label = p.lineItem.preorderLabel || "Preorder";
          var value = p.shipText
            ? (p.lineItem.shipLabel || "Ships") + " " + p.shipText
            : p.fallback || "Preorder";
          setProp(form, label, value);
        }
        if (p.sellingPlanId) setSellingPlan(form, p.sellingPlanId);
        if (market) setProp(form, "_preorder_market", market);
      }

      function showPreorder() {
        armForm();
        btn.textContent = idleLabel;
        btn.disabled = false;
        btn.removeAttribute("aria-disabled");
        btn.classList.remove("encore-btn--soldout");
        note.textContent = p.shipText ? interpolate(p.message, { date: p.shipText }) : p.fallback || "";
        ensureBadge();
        if (badge) badge.hidden = false;
        if (replaceTheme) hideThemeBuyButtons(form, root);
        ui.hidden = false;
        // Mixed-cart hint: only when the cart ALREADY holds in-stock items.
        var mixedCopy = mixedCartCopy(cfg, p);
        if (mixedCopy && !mixedEl && note.parentNode) {
          cartState().then(function (st) {
            if (!st || !st.regular || mixedEl) return;
            mixedEl = document.createElement("div");
            mixedEl.className = "encore encore-mixed-note";
            mixedEl.textContent = mixedCopy;
            note.parentNode.insertBefore(mixedEl, note.nextSibling);
          });
        }
        if (mixedEl) mixedEl.hidden = false;
      }

      function showSoldOut() {
        clearEncoreFields(form);
        hideThemeBuyButtons(form, root);
        btn.textContent = p.soldOutLabel || "Sold out";
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
        btn.classList.add("encore-btn--soldout");
        note.textContent = p.soldOutMessage || "";
        if (badge) badge.hidden = true;
        if (mixedEl) mixedEl.hidden = true;
        ui.hidden = false;
      }

      function showNothing() {
        clearEncoreFields(form);
        showThemeBuyButtons(form, root);
        if (badge) badge.hidden = true;
        if (mixedEl) mixedEl.hidden = true;
        ui.hidden = true;
      }

      // Re-evaluated for the selected variant: campaigns are configured per
      // variant (units offered), so the button, badge, selling plan and
      // properties must follow the picker, not the product.
      function apply() {
        var vid = currentVariantId(form, root.getAttribute("data-variant-id"));
        var offer = variantOffer(p, vid);
        var stocked = variantInStock(root, productId, vid);
        var next;
        if (offer === "none") next = "none";
        else if (offer === "soldout") next = stocked ? "none" : "soldout";
        else if (stocked && p.trigger !== "always" && !p.forcePreorder) next = "none";
        else next = "preorder";
        if (next === current) return;
        current = next;
        if (next === "preorder") showPreorder();
        else if (next === "soldout") showSoldOut();
        else showNothing();
      }

      // Add to cart directly (R1.5 E2E fix). Themes attach their own submit
      // handler to the product form and many (Debut, Brooklyn, Venture…)
      // swallow the submit when their Add-to-cart button is disabled — which
      // is exactly the sold-out state a preorder lives in. Posting the form's
      // own fields to /cart/add.js sidesteps that and keeps every property,
      // the selling plan and the chosen variant intact.
      btn.addEventListener("click", function () {
        if (!form || btn.__busy || current !== "preorder") return;
        addPreorderToCart(form, btn, note, p);
      });

      onVariantChange(form, apply);
      apply();
    });
  }

  function addPreorderToCart(form, btn, note, p) {
    var idEl = form.querySelector('[name="id"]');
    if (!idEl || !idEl.value) return;
    var body = new FormData(form);
    if (!body.get("quantity")) body.set("quantity", "1");
    var idle = btn.textContent;
    var errEl = form.querySelector("[data-encore-pre-error]");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.setAttribute("data-encore-pre-error", "1");
      errEl.className = "encore encore-pre-error";
      errEl.setAttribute("role", "alert");
      errEl.hidden = true;
      if (note && note.parentNode) note.parentNode.insertBefore(errEl, note);
      else btn.parentNode.appendChild(errEl);
    }
    errEl.hidden = true;
    btn.__busy = true;
    btn.setAttribute("aria-busy", "true");
    btn.classList.add("encore-btn--busy");
    btn.textContent = p.addingLabel || "Adding…";

    fetch("/cart/add.js", {
      method: "POST",
      body: body,
      credentials: "same-origin",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, status: r.status, json: j };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          var msg = (res.json && (res.json.description || res.json.message)) || "Could not add to cart.";
          errEl.textContent = msg;
          errEl.hidden = false;
          reset();
          return;
        }
        btn.textContent = p.addedLabel || "Added ✓";
        try {
          document.dispatchEvent(new CustomEvent("encore:added", { detail: res.json }));
          // Let themes with a cart drawer refresh their count.
          document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
        } catch (e) {}
        window.setTimeout(function () {
          window.location.href = "/cart";
        }, 250);
      })
      .catch(function () {
        errEl.textContent = "Network error — please try again.";
        errEl.hidden = false;
        reset();
      });

    function reset() {
      btn.__busy = false;
      btn.removeAttribute("aria-busy");
      btn.classList.remove("encore-btn--busy");
      btn.textContent = idle;
    }
  }

  // ---------- Countdown (R1) ----------
  // Ticks down to the matched campaign's endDate. Renders nothing for
  // campaigns without an end date, and follows the same stock/trigger gating
  // as the preorder button so the two never disagree.
  function initCountdown(root) {
    if (root.__encoreInit) return;
    root.__encoreInit = true;

    var productId = root.getAttribute("data-product-id");
    var locale = root.getAttribute("data-locale") || "en";
    var market = root.getAttribute("data-market") || pageMarket();
    var ui = root.querySelector("[data-encore-count-ui]");
    var labelEl = root.querySelector("[data-encore-count-label]");
    var timeEl = root.querySelector("[data-encore-count-time]");

    fetchConfig(productId, locale, market).then(function (cfg) {
      if (!cfg || !cfg.preorder || !cfg.preorder.active) return;
      var p = cfg.preorder;
      if (!p.endDate) return;
      var inStock = root.getAttribute("data-in-stock") === "true";
      if (inStock && p.trigger !== "always" && !p.forcePreorder) return;

      var end = Date.parse(p.endDate);
      if (!end || end <= Date.now()) return;

      labelEl.textContent = root.getAttribute("data-label") || "Preorder ends in";

      function pad(n) {
        return n < 10 ? "0" + n : "" + n;
      }
      var timer = null;
      function tick() {
        var left = end - Date.now();
        if (left <= 0) {
          if (timer) window.clearInterval(timer);
          ui.hidden = true;
          return;
        }
        var s = Math.floor(left / 1000);
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        timeEl.textContent =
          (d > 0 ? d + "d " : "") + pad(h) + "h " + pad(m) + "m " + pad(sec) + "s";
      }
      tick();
      timer = window.setInterval(tick, 1000);
      ui.hidden = false;
    });
  }

  // ---------- Collection-page preorder badges (R1) ----------
  // Enabled via the app embed's "collection badges" setting. Scans product-card
  // links on the page, asks the app which handles are on a live preorder
  // (/apps/encore/badges) and drops a small badge into each matching card.
  function productHandleFromHref(href) {
    var m = /\/products\/([a-z0-9-]+)/i.exec(href || "");
    return m ? m[1].toLowerCase() : "";
  }

  function initCollectionBadges() {
    var settings = window.EncoreSettings || {};
    // The app's Design setting decides (the /badges response carries
    // `enabled`); the theme embed checkbox is an additional force-on. Runs on
    // every page with product cards, including "you may also like" on PDPs.

    var links = document.querySelectorAll('a[href*="/products/"]');
    if (!links.length) return;
    // On a product page the page's own product is handled by the preorder
    // block — never badge its breadcrumb / share / canonical links.
    var currentHandle = productHandleFromHref(window.location.pathname);

    // handle → [best anchor per card]
    var byHandle = {};
    var handles = [];
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      // Skip links inside an Encore product-page block (that page has its own UI).
      if (a.closest && a.closest("[data-encore-preorder]")) continue;
      // Only same-store product links (share buttons embed the product URL in
      // a pinterest/facebook href and would otherwise match).
      var href = a.getAttribute("href") || "";
      var resolved;
      try {
        resolved = new URL(href, window.location.href);
      } catch (e) {
        continue;
      }
      if (resolved.host !== window.location.host) continue;
      var h = productHandleFromHref(resolved.pathname);
      if (!h || h === currentHandle) continue;
      if (a.closest && a.closest("header, footer, nav, [class*='share'], [class*='breadcrumb']")) continue;
      if (!byHandle[h]) {
        byHandle[h] = [];
        handles.push(h);
      }
      byHandle[h].push(a);
    }
    if (!handles.length) return;
    handles = handles.slice(0, 24);

    var locale = settings.locale || (document.documentElement.lang || "en").slice(0, 2);
    var url =
      PROXY +
      "/badges?handles=" +
      encodeURIComponent(handles.join(",")) +
      "&locale=" +
      encodeURIComponent(locale) +
      "&market_id=" +
      encodeURIComponent(pageMarket());
    fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) {
        return r && r.ok ? r.json() : null;
      })
      .then(function (res) {
        if (!res || !res.handles || !res.handles.length) return;
        if (res.enabled === false && !settings.collectionBadges) return;
        var label = res.label || "Preorder";
        for (var i = 0; i < res.handles.length; i++) {
          var anchors = byHandle[res.handles[i]] || [];
          for (var j = 0; j < anchors.length; j++) {
            // One badge per card: mark the closest card container.
            var card =
              (anchors[j].closest &&
                anchors[j].closest("li, article, .card, .card-wrapper, .grid__item, .product-card, .product-item, .grid-product")) ||
              anchors[j];
            if (card.getAttribute("data-encore-badged")) continue;
            card.setAttribute("data-encore-badged", "1");
            var badge = document.createElement("span");
            badge.className = "encore encore-card-badge";
            badge.textContent = label;
            // Overlay on the card image (top-left) when there is one; otherwise
            // fall back to an inline badge above the card link.
            var cardImg = card.querySelector ? card.querySelector("img") : null;
            var host = cardImg && cardImg.parentNode;
            if (host && isVisible(cardImg)) {
              if (getComputedStyle(host).position === "static") host.style.position = "relative";
              badge.className += " encore-card-badge--overlay";
              host.appendChild(badge);
            } else {
              anchors[j].parentNode.insertBefore(badge, anchors[j]);
            }
            break;
          }
        }
      })
      .catch(function () {});
  }

  // ---------- Low stock ----------
  function buildLowstock(preset, qty, threshold, textTmpl) {
    var frag = document.createDocumentFragment();
    var text = interpolate(textTmpl || "Only {n} left", { n: qty });
    var pct = Math.max(6, Math.min(100, Math.round((qty / threshold) * 100)));

    function textEl() {
      var t = document.createElement("div");
      t.className = "encore-lowstock__text";
      t.textContent = text;
      return t;
    }
    function bar(pulse) {
      var b = document.createElement("div");
      b.className = "encore-bar" + (pulse ? " encore-bar--pulse" : "");
      var fill = document.createElement("div");
      fill.className = "encore-bar__fill";
      fill.style.width = pct + "%";
      b.appendChild(fill);
      return b;
    }

    if (preset === "text") {
      frag.appendChild(textEl());
    } else if (preset === "segmented") {
      var seg = document.createElement("div");
      seg.className = "encore-seg";
      var cells = 5;
      var on = Math.max(1, Math.round((qty / threshold) * cells));
      for (var i = 0; i < cells; i++) {
        var c = document.createElement("div");
        c.className = "encore-seg__cell" + (i < on ? " encore-seg__cell--on" : "");
        seg.appendChild(c);
      }
      frag.appendChild(textEl());
      frag.appendChild(seg);
    } else if (preset === "pill") {
      var pill = document.createElement("div");
      pill.className = "encore-pill";
      var dot = document.createElement("span");
      dot.className = "encore-pill__dot";
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode(text));
      frag.appendChild(pill);
    } else if (preset === "pulse") {
      frag.appendChild(textEl());
      frag.appendChild(bar(true));
    } else {
      // bar_text and color both render bar + text
      frag.appendChild(textEl());
      frag.appendChild(bar(false));
    }
    return frag;
  }

  function lowstockSeverity(qty, threshold) {
    var ratio = qty / threshold;
    if (ratio <= 0.25) return "crit";
    if (ratio <= 0.6) return "warn";
    return "ok";
  }

  function initLowstock(root) {
    if (root.__encoreInit) return;
    root.__encoreInit = true;

    var productId = root.getAttribute("data-product-id");
    var locale = root.getAttribute("data-locale") || "en";
    var presetAttr = root.getAttribute("data-preset") || "bar_text";
    var thresholdAttr = parseInt(root.getAttribute("data-threshold"), 10) || 10;
    var ui = root.querySelector("[data-encore-low-ui]");
    var inv = readJSON('[data-encore-inventory="' + productId + '"]') || {};
    var form = closestForm(root);

    fetchConfig(productId, locale, pageMarket()).then(function (cfg) {
      var ls = cfg && cfg.lowStock;
      var enabled = ls ? ls.enabled !== false : true;
      if (!enabled) return;
      var threshold = ls && ls.threshold ? ls.threshold : thresholdAttr;
      var preset = ls && ls.preset ? ls.preset : presetAttr;
      var textTmpl = ls && ls.text ? ls.text : "Only {n} left";

      function render() {
        var vid = currentVariantId(form, root.getAttribute("data-variant-id"));
        var rec = inv[String(vid)];
        ui.innerHTML = "";
        root.className = root.className.replace(/\s*encore-lowstock--\w+/g, "");
        if (!rec || !rec.tracked) {
          ui.hidden = true;
          return;
        }
        var qty = rec.qty;
        if (qty == null || qty <= 0 || qty > threshold) {
          ui.hidden = true;
          return;
        }
        ui.hidden = false;
        if (preset === "color") {
          root.className += " encore-lowstock--" + lowstockSeverity(qty, threshold);
        }
        ui.appendChild(buildLowstock(preset, qty, threshold, textTmpl));
      }

      onVariantChange(form, render);
      render();
    });
  }

  // ---------- Back in stock (notify me) ----------
  function openNotifyModal(opts) {
    var cfg = opts.cfg || {};
    var bis = cfg.backInStock || {};
    var modal = document.createElement("div");
    modal.className = "encore encore-modal";
    modal.innerHTML =
      '<div class="encore-modal__backdrop" data-close></div>' +
      '<div class="encore-modal__card" role="dialog" aria-modal="true">' +
      '<button class="encore-modal__close" data-close aria-label="Close">&times;</button>' +
      '<h3 class="encore-modal__title"></h3>' +
      '<p class="encore-modal__sub"></p>' +
      '<form data-encore-notify-form>' +
      '<div class="encore-field"><label></label><input type="email" name="email" required autocomplete="email" /></div>' +
      '<div class="encore-field" data-phone hidden><label></label><input type="tel" name="phone" autocomplete="tel" /></div>' +
      '<label class="encore-consent"><input type="checkbox" name="consent" /><span></span></label>' +
      '<button type="submit" class="encore-btn"></button>' +
      '<p class="encore-modal__msg" data-msg hidden></p>' +
      "</form>" +
      "</div>";

    var t = function (key, fallback) {
      return (bis[key] != null && bis[key] !== "") ? bis[key] : fallback;
    };
    modal.querySelector(".encore-modal__title").textContent = t("title", "Get notified");
    modal.querySelector(".encore-modal__sub").textContent =
      opts.productTitle || "We'll email you when it's back in stock.";
    var fields = modal.querySelectorAll(".encore-field label");
    fields[0].textContent = "Email address";
    fields[1].textContent = "Phone (optional)";
    modal.querySelector(".encore-consent span").textContent = t(
      "consentText",
      "I agree to be notified by email about this product."
    );
    modal.querySelector('button[type="submit"]').textContent = t("submit", "Notify me");
    if (opts.collectPhone) modal.querySelector("[data-phone]").hidden = false;

    var card = modal.querySelector(".encore-modal__card");
    card.style.setProperty("--encore-accent", opts.accent || "#1a1a1a");
    card.style.setProperty("--encore-on-accent", opts.onAccent || "#ffffff");

    function close() {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }
    var closers = modal.querySelectorAll("[data-close]");
    for (var i = 0; i < closers.length; i++) closers[i].addEventListener("click", close);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", esc);
      }
    });

    var form = modal.querySelector("[data-encore-notify-form]");
    var msg = modal.querySelector("[data-msg]");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = {
        product_id: opts.productId,
        variant_id: opts.variantId,
        product_title: opts.productTitle,
        market: pageMarket(),
        locale: ((document.documentElement && document.documentElement.lang) || "en").slice(0, 2),
        email: form.email ? form.email.value : "",
        phone: form.phone ? form.phone.value : "",
      };
      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      fetch(PROXY + "/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(data),
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { ok: r.ok };
          });
        })
        .then(function (res) {
          if (res && res.ok) {
            form.innerHTML = "";
            msg.hidden = false;
            msg.className = "encore-modal__msg encore-modal__msg--ok";
            msg.textContent = t("success", "You're on the list — we'll let you know when it's back.");
            form.appendChild(msg);
          } else {
            throw new Error("failed");
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          msg.hidden = false;
          msg.className = "encore-modal__msg encore-modal__msg--err";
          msg.textContent = "Something went wrong. Please try again.";
        });
    });

    document.body.appendChild(modal);
    var emailInput = modal.querySelector('input[type="email"]');
    if (emailInput) emailInput.focus();
  }

  function initNotify(root) {
    if (root.__encoreInit) return;
    root.__encoreInit = true;

    var productId = root.getAttribute("data-product-id");
    var locale = root.getAttribute("data-locale") || "en";
    var btn = root.querySelector("[data-encore-notify-btn]");
    var blockCollectPhone = root.getAttribute("data-collect-phone") === "true";
    var variants = readJSON('[data-encore-variants="' + productId + '"]') || [];

    fetchConfig(productId, locale, pageMarket()).then(function (cfg) {
      var bis = cfg && cfg.backInStock;
      if (!bis || !bis.enabled) return;
      var form = closestForm(root);

      function variantById(vid) {
        for (var i = 0; i < variants.length; i++) {
          if (String(variants[i].id) === String(vid)) return variants[i];
        }
        return null;
      }

      function refresh() {
        var vid = currentVariantId(form, root.getAttribute("data-variant-id"));
        var v = variantById(vid);
        var available = v ? v.available : root.getAttribute("data-available") === "true";
        // Per-variant: notify-me steps in when the variant is out of stock and
        // either not on preorder or its preorder allocation is sold out. A live
        // preorder owns the buy box — never stack "Notify me" next to it.
        var offer = variantOffer(cfg.preorder, vid);
        var preorderSoldOut = offer === "soldout";
        var preorderActive = offer === "offer";
        if ((available && !preorderSoldOut) || preorderActive) {
          btn.hidden = true;
        } else {
          btn.hidden = false;
          if (bis.buttonText) btn.textContent = bis.buttonText;
          if (bis.hideBuyNow) hideThemeBuyButtons(form, root);
        }
        btn.__vid = vid;
        btn.__title = v && v.title ? root.getAttribute("data-product-title") + " – " + v.title : root.getAttribute("data-product-title");
      }

      btn.addEventListener("click", function () {
        openNotifyModal({
          cfg: cfg,
          productId: productId,
          variantId: btn.__vid || currentVariantId(form, root.getAttribute("data-variant-id")),
          productTitle: btn.__title || root.getAttribute("data-product-title"),
          collectPhone: blockCollectPhone || bis.collectPhone,
          accent: getComputedStyle(root).getPropertyValue("--encore-accent"),
          onAccent: getComputedStyle(root).getPropertyValue("--encore-on-accent"),
        });
      });

      onVariantChange(form, refresh);
      refresh();
    });
  }

  // ---------- Mixed cart ----------
  function mixedCartCopy(cfg, p) {
    var c = cfg && cfg.cart;
    if (c && c.mixedCartWarning === false) return "";
    return (c && c.mixedCartMessage) || (p && p.mixedCartMessage) || "";
  }

  // { preorder: n, regular: n } from /cart.js — null on any failure.
  function cartState() {
    return fetch("/cart.js", { headers: { Accept: "application/json" }, credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (cart) {
        if (!cart || !cart.items) return null;
        var pre = 0;
        var reg = 0;
        for (var i = 0; i < cart.items.length; i++) {
          var props = cart.items[i].properties || {};
          if (String(props._preorder) === "true") pre++;
          else reg++;
        }
        return { preorder: pre, regular: reg };
      })
      .catch(function () {
        return null;
      });
  }

  // On the cart page: one notice above the cart form when the cart holds
  // both preorder and in-stock lines. Re-evaluated on cart:refresh so ajax
  // quantity changes / removals keep it honest.
  function initMixedCartNotice() {
    var cartForm =
      document.querySelector('form[action$="/cart"], form[action*="/cart?"], form[action="/cart"]') ||
      document.querySelector("[data-encore-cart-notice]");
    if (!cartForm && !/^\/cart\/?$/.test(window.location.pathname)) return;
    var host = cartForm || document.querySelector("main") || document.body;

    function render() {
      cartState().then(function (st) {
        var existing = document.querySelector("[data-encore-mixed-notice]");
        var mixed = st && st.preorder > 0 && st.regular > 0;
        if (!mixed) {
          if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
          return;
        }
        if (existing) return;
        fetchConfig("", (document.documentElement.lang || "en").slice(0, 2), pageMarket()).then(function (cfg) {
          var copy = mixedCartCopy(cfg, cfg && cfg.preorder);
          if (!copy || document.querySelector("[data-encore-mixed-notice]")) return;
          var el = document.createElement("div");
          el.className = "encore encore-mixed-notice";
          el.setAttribute("data-encore-mixed-notice", "1");
          el.setAttribute("role", "status");
          el.textContent = copy;
          if (cartForm && cartForm.parentNode) cartForm.parentNode.insertBefore(el, cartForm);
          else host.insertBefore(el, host.firstChild);
        });
      });
    }
    render();
    hidePrivateProps();
    document.addEventListener("cart:refresh", render);
    document.addEventListener("encore:added", render);
    // Ajax carts re-render lines; keep the private rows hidden.
    if (window.MutationObserver) {
      new MutationObserver(function () {
        hidePrivateProps();
      }).observe(host, { childList: true, subtree: true });
    }
  }

  // Shopify's convention is that themes hide line-item properties whose name
  // starts with "_". OS 2.0 themes do; vintage themes (Debut, Brooklyn…)
  // print them ("_preorder: true"). Hide just those rows, never merchant-
  // facing ones like "Preorder: Ships …".
  function hidePrivateProps() {
    var labels = document.querySelectorAll(
      "[data-cart-item-property-name], .product-details__item-label, .cart__property-label, dt, strong, span, b",
    );
    for (var i = 0; i < labels.length; i++) {
      var el = labels[i];
      if (el.children.length || el.__encoreHidden) continue;
      var txt = (el.textContent || "").trim();
      if (!/^_preorder(_ship_date|_market)?\s*:?$/.test(txt)) continue;
      el.__encoreHidden = true;
      var row =
        (el.closest &&
          el.closest("li, tr, dl > div, .product-details__item, .cart__property, [data-cart-item-property]")) ||
        el.parentNode;
      if (row && row !== document.body) row.style.display = "none";
    }
  }

  // ---------- bootstrap ----------
  function initAll(scope) {
    var s = scope || document;
    var pre = s.querySelectorAll("[data-encore-preorder]");
    for (var i = 0; i < pre.length; i++) initPreorder(pre[i]);
    var low = s.querySelectorAll("[data-encore-lowstock]");
    for (var j = 0; j < low.length; j++) initLowstock(low[j]);
    var not = s.querySelectorAll("[data-encore-notify]");
    for (var k = 0; k < not.length; k++) initNotify(not[k]);
    var cnt = s.querySelectorAll("[data-encore-countdown]");
    for (var l = 0; l < cnt.length; l++) initCountdown(cnt[l]);
  }

  function boot() {
    autoMount(); // must run before initAll so relocated shells init in place
    initAll();
    initCollectionBadges();
    initMixedCartNotice();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Theme editor: re-init when a section is re-rendered.
  document.addEventListener("shopify:section:load", function (e) {
    autoMount();
    initAll(e.target);
  });
})();
