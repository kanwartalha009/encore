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

  // Fire cb whenever the shopper changes variant. Generic across themes:
  // listens for changes to the hidden id input, option selectors and history.
  function onVariantChange(form, cb) {
    var handler = function (e) {
      var t = e && e.target;
      if (!t) return;
      var name = t.name || "";
      if (name === "id" || name === "options[]" || /option/i.test(name)) {
        window.setTimeout(cb, 60);
      }
    };
    document.addEventListener("change", handler, true);
    window.addEventListener("popstate", function () {
      window.setTimeout(cb, 60);
    });
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

  function hideThemeBuyButtons(form, root) {
    if (!form) return;
    var sels = [
      '[name="add"]',
      ".product-form__submit",
      ".shopify-payment-button",
      'button[type="submit"]',
    ];
    sels.forEach(function (s) {
      var nodes = form.querySelectorAll(s);
      for (var i = 0; i < nodes.length; i++) {
        if (root.contains(nodes[i])) continue;
        nodes[i].style.display = "none";
      }
    });
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

      // Per-market: never show preorder where this market has sellable stock —
      // unless the merchant flagged this market as having no local stock.
      if (
        root.getAttribute("data-in-stock") === "true" &&
        !(cfg && cfg.preorder && cfg.preorder.forcePreorder)
      )
        return;

      if (!cfg || !cfg.preorder || !cfg.preorder.active) return;
      var p = cfg.preorder;
      var form = closestForm(root);

      if (p.label) btn.textContent = p.label;

      if (showBadge && p.showBadge !== false) {
        var badge = document.createElement("span");
        badge.className = "encore-badge encore-badge--" + (p.badgeStyle || "pill");
        badge.textContent = p.badge || "Preorder";
        ui.insertBefore(badge, ui.firstChild);
      }

      note.textContent = p.shipText
        ? interpolate(p.message, { date: p.shipText })
        : p.fallback || "";

      // Line-item properties → follow the item into cart + checkout.
      if (form && p.lineItem && p.lineItem.enabled) {
        setProp(form, "_preorder", "true");
        if (p.shipDate) setProp(form, "_preorder_ship_date", p.shipDate);
        var label = p.lineItem.preorderLabel || "Preorder";
        var value = p.shipText
          ? (p.lineItem.shipLabel || "Ships") + " " + p.shipText
          : p.fallback || "Preorder";
        setProp(form, label, value);
      }

      // Selling plan → makes Shopify apply the deposit / pay-later billing at
      // checkout. Without it the item is added as a plain (pay-now) line.
      if (form && p.sellingPlanId) {
        setSellingPlan(form, p.sellingPlanId);
      }

      // Capture the buyer's market on the line → demand signal market dimension.
      if (form && market) setProp(form, "_preorder_market", market);

      if (placement === "replace" || p.hideBuyNow) {
        hideThemeBuyButtons(form, root);
      }

      btn.addEventListener("click", function () {
        if (!form) return;
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      });

      ui.hidden = false;
    });
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
        // Also offer notify-me when the preorder has hit its cap (sold out).
        var preorderSoldOut = !!(cfg.preorder && cfg.preorder.soldOut);
        if (available && !preorderSoldOut) {
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

  // ---------- bootstrap ----------
  function initAll(scope) {
    var s = scope || document;
    var pre = s.querySelectorAll("[data-encore-preorder]");
    for (var i = 0; i < pre.length; i++) initPreorder(pre[i]);
    var low = s.querySelectorAll("[data-encore-lowstock]");
    for (var j = 0; j < low.length; j++) initLowstock(low[j]);
    var not = s.querySelectorAll("[data-encore-notify]");
    for (var k = 0; k < not.length; k++) initNotify(not[k]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initAll();
    });
  } else {
    initAll();
  }

  // Theme editor: re-init when a section is re-rendered.
  document.addEventListener("shopify:section:load", function (e) {
    initAll(e.target);
  });
})();
