/* Convert a Playwright selector into a C# locator and keep it on one node.
   Accessible name, role, and label matching come from the injected script. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PwCSharpPicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TEST_ID_ATTR = "data-testid";
  const SKIP_ROLES = new Set(["none", "presentation", "generic"]);
  const VALUE_NOTE = "Bu seçici value değerine göre tek. Değer değişirse seçici de değişir.";
  const UNSTABLE_NOTE = "Kararlı bir seçici yok. Bu ifade değişebilir.";

  function escapeForAttributeSelector(value, exact) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"${exact ? "s" : "i"}`;
  }

  function escapeForTextSelector(text, exact) {
    return `${JSON.stringify(String(text))}${exact ? "s" : "i"}`;
  }

  function roleSelector(role, name, exact) {
    if (name)
      return `internal:role=${role}[name=${escapeForAttributeSelector(name, exact)}]`;
    return `internal:role=${role}`;
  }

  function labelSelector(text, exact) {
    return `internal:label=${escapeForTextSelector(text, exact)}`;
  }

  function attrSelector(attr, text, exact) {
    return `internal:attr=[${attr}=${escapeForAttributeSelector(text, exact)}]`;
  }

  function testIdSelector(value) {
    return `internal:testid=[${TEST_ID_ATTR}=${escapeForAttributeSelector(value, true)}]`;
  }

  function textSelector(text, exact) {
    return `internal:text=${escapeForTextSelector(text, exact)}`;
  }

  function queryAll(injected, selector, root) {
    try {
      return injected.querySelectorAll(injected.parseSelector(selector), root);
    } catch (e) {
      return null;
    }
  }

  function isExact(injected, element, selector) {
    if (!selector || !element) return false;
    const matches = queryAll(injected, selector, element.ownerDocument);
    return !!matches && matches.length === 1 && matches[0] === element;
  }

  function indexOfNode(matches, element) {
    if (!matches) return -1;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i] === element) return i;
    }
    return -1;
  }

  function ancestorElement(element) {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode && element.getRootNode();
    if (root && root.host && root.host !== element) return root.host;
    return null;
  }

  function generateForExact(injected, element) {
    const original = element.matches;
    if (typeof original !== "function")
      return injected.generateSelector(element, { testIdAttributeName: TEST_ID_ATTR });
    element.matches = function (selector) {
      if (typeof selector === "string" && selector.replace(/\s/g, "") === "input,textarea,select")
        return true;
      return original.apply(this, arguments);
    };
    try {
      return injected.generateSelector(element, { testIdAttributeName: TEST_ID_ATTR });
    } finally {
      element.matches = original;
    }
  }

  function usesIndex(selector) {
    return /(?:>>\s*nth=|:nth-(?:child|of-type)\(|:first-child|:last-child|:first-of-type|:last-of-type)/i.test(String(selector || ""));
  }

  function csharpUsesIndex(code) {
    return /\.(?:Nth\(|First\b|Last\b)/.test(String(code || ""));
  }

  function isStableId(id) {
    if (!id || typeof id !== "string") return false;
    if (id.charAt(0) === ":" || /^:.*:$/.test(id)) return false;
    if (!/^[A-Za-z][\w.-]*$/.test(id)) return false;
    if (/[0-9a-f]{8,}/i.test(id)) return false;
    return true;
  }

  function isStableClass(name) {
    if (!name || name.length > 80) return false;
    if (/^css-/i.test(name)) return false;
    if (/^mui-style-/i.test(name)) return false;
    if (/^jss\d/i.test(name)) return false;
    if (/[0-9]{4,}/.test(name)) return false;
    return /^[A-Za-z_][\w-]*$/.test(name);
  }

  function parentChainSelector(injected, parent) {
    const role = ariaRole(injected, parent);
    const name = accessibleName(injected, parent);
    if (role && name) {
      const loose = roleSelector(role, name, false);
      if (isExact(injected, parent, loose)) return loose;
      const exact = roleSelector(role, name, true);
      if (isExact(injected, parent, exact)) return exact;
    }
    const labels = labelStrings(injected, parent);
    for (const label of labels) {
      const loose = labelSelector(label, false);
      if (isExact(injected, parent, loose)) return loose;
      const exact = labelSelector(label, true);
      if (isExact(injected, parent, exact)) return exact;
    }
    const id = parent.getAttribute && parent.getAttribute("id");
    if (isStableId(id)) {
      const ident = cssEscapeIdent(id);
      if (isExact(injected, parent, `#${ident}`)) return `#${ident}`;
    }
    const byClass = uniqueCssSelector(injected, parent);
    if (byClass) return byClass;
    return null;
  }

  function normalizedText(injected, element) {
    try {
      const text = injected.utils.elementText(new Map(), element);
      const value = text && (text.normalized || text.full) || "";
      return injected.utils.normalizeWhiteSpace(String(value || "")).trim();
    } catch (e) {
      return "";
    }
  }

  function tighten(injected, element, selector, matches) {
    const found = matches || queryAll(injected, selector, element.ownerDocument);
    if (!found || indexOfNode(found, element) === -1) return null;
    if (found.length === 1) return selector;

    let parent = ancestorElement(element);
    for (let depth = 0; parent && depth < 15; depth++, parent = ancestorElement(parent)) {
      const parentSelector = parentChainSelector(injected, parent);
      if (!parentSelector || parentSelector === selector) continue;
      const chained = `${parentSelector} >> ${selector}`;
      if (isExact(injected, element, chained)) return chained;
    }

    const text = normalizedText(injected, element);
    if (text && text.length <= 80) {
      const filtered = `${selector} >> internal:has-text=${escapeForTextSelector(text, false)}`;
      if (!usesIndex(filtered) && isExact(injected, element, filtered)) return filtered;
    }
    return null;
  }

  function ensureUnique(injected, element, selector) {
    const matches = queryAll(injected, selector, element.ownerDocument);
    if (!matches || indexOfNode(matches, element) === -1) return null;
    if (matches.length === 1) return selector;
    return tighten(injected, element, selector, matches);
  }

  function resolve(injected, element, selectors) {
    let loose = null;
    let looseMatches = null;
    for (const selector of selectors) {
      if (!selector) continue;
      const matches = queryAll(injected, selector, element.ownerDocument);
      const index = indexOfNode(matches, element);
      if (index === -1) continue;
      if (matches.length === 1 && !usesIndex(selector)) return selector;
      if (!loose) {
        loose = selector;
        looseMatches = matches;
      }
    }
    if (!loose) return null;
    const tightened = tighten(injected, element, loose, looseMatches);
    if (tightened && !usesIndex(tightened)) return tightened;
    return null;
  }

  function pushTextPair(list, build, text) {
    if (!text) return;
    list.push(build(text, false), build(text, true));
  }

  function labelStrings(injected, element) {
    const out = [];
    const push = (value) => {
      if (value == null) return;
      let text = "";
      if (typeof value === "string") text = value;
      else text = value.normalized || value.full || "";
      try {
        text = injected.utils.normalizeWhiteSpace(String(text)).trim();
      } catch (e) {
        text = String(text).trim();
      }
      if (text && out.indexOf(text) === -1) out.push(text);
    };
    const labelledBy = element.getAttribute && element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const doc = element.ownerDocument;
      for (const id of labelledBy.split(/\s+/)) {
        if (!id) continue;
        const node = doc.getElementById(id);
        if (!node) continue;
        try {
          push(injected.utils.elementText(new Map(), node));
        } catch (e) {
          push(node.textContent);
        }
      }
    }
    const aria = element.getAttribute && element.getAttribute("aria-label");
    if (aria) push(aria);
    try {
      const labels = element.labels;
      if (labels) {
        for (const label of labels) {
          try {
            push(injected.utils.elementText(new Map(), label));
          } catch (e) {
            push(label.textContent);
          }
        }
      }
    } catch (e) {
      /* element.labels is only on labelable elements */
    }
    return out;
  }

  function accessibleName(injected, element) {
    try {
      const name = injected.utils.getElementAccessibleNameText(element, false) || "";
      return injected.utils.normalizeWhiteSpace(String(name)).trim();
    } catch (e) {
      return "";
    }
  }

  function visibleText(element) {
    let text = "";
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        text += node.textContent || "";
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return;
      const classes = node.classList ? Array.prototype.slice.call(node.classList) : [];
      if (classes.indexOf("MuiTouchRipple-root") !== -1) return;
      for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
    };
    walk(element);
    return text.replace(/\s+/g, " ").trim();
  }

  function controlName(injected, element, role) {
    const fromAria = accessibleName(injected, element);
    if (fromAria) return fromAria;
    if (role && ["button", "link", "menuitem", "tab", "option", "treeitem", "heading"].indexOf(role) !== -1)
      return visibleText(element);
    return "";
  }

  function isHeading(element) {
    const tag = (element.localName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) return true;
    return element.getAttribute && element.getAttribute("role") === "heading";
  }

  function firstExactRole(injected, element, role, name) {
    const loose = roleSelector(role, name, false);
    if (isExact(injected, element, loose)) return loose;
    const exact = roleSelector(role, name, true);
    if (isExact(injected, element, exact)) return exact;
    return "";
  }

  function firstExactChain(injected, element, prefixes, suffixes) {
    for (const prefix of prefixes) {
      if (!prefix) continue;
      for (const suffix of suffixes) {
        const chained = `${prefix} >> ${suffix}`;
        if (!usesIndex(chained) && isExact(injected, element, chained)) return chained;
      }
    }
    return "";
  }

  function chainFromNearby(injected, element, role, name) {
    const targetSelectors = [roleSelector(role, name, false), roleSelector(role, name, true)];
    let parent = ancestorElement(element);
    for (let depth = 0; parent && depth < 8; depth++, parent = ancestorElement(parent)) {
      const sectionRole = ariaRole(injected, parent);
      const sectionName = accessibleName(injected, parent);
      if (sectionRole && sectionName) {
        const sectionSel = firstExactRole(injected, parent, sectionRole, sectionName);
        const chained = firstExactChain(injected, element, [sectionSel], targetSelectors);
        if (chained) return chained;
      }

      const headings = [];
      if (isHeading(parent)) headings.push(parent);
      if (parent.querySelectorAll) {
        for (const heading of parent.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")) {
          if (heading === element || element.contains(heading) || heading.contains(element)) continue;
          headings.push(heading);
        }
      }
      for (const heading of headings) {
        const headingName = accessibleName(injected, heading) || visibleText(heading);
        const headingRole = ariaRole(injected, heading) || "heading";
        if (!headingName) continue;
        const headingSel = firstExactRole(injected, heading, headingRole, headingName);
        if (!headingSel) continue;
        if (heading.contains(element)) {
          const chained = firstExactChain(injected, element, [headingSel], targetSelectors);
          if (chained) return chained;
        }

        const rolePrefixes = [];
        const cssPrefixes = [];
        let container = heading.parentElement;
        for (let up = 0; container && up < 5; up++, container = container.parentElement) {
          if (!container.contains(element)) continue;
          const containerRole = ariaRole(injected, container);
          if (containerRole) rolePrefixes.push(roleSelector(containerRole));
          for (const token of containerTokens(container)) cssPrefixes.push(token);
        }
        const has = `internal:has=${JSON.stringify(headingSel)}`;
        const chained = firstExactChain(
          injected,
          element,
          rolePrefixes.map((prefix) => `${prefix} >> ${has}`).concat(cssPrefixes.map((prefix) => `${prefix} >> ${has}`)),
          targetSelectors
        );
        if (chained) return chained;
      }
    }
    return null;
  }

  function ariaRole(injected, element) {
    try {
      const role = injected.utils.getAriaRole(element);
      if (!role || SKIP_ROLES.has(role)) return "";
      return role;
    } catch (e) {
      return "";
    }
  }

  function cssPath(element) {
    const doc = element.ownerDocument;
    if (!element || element.nodeType !== 1) return "html";
    if (element === doc.documentElement) return "html";
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== doc.documentElement) {
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(current.localName || current.tagName.toLowerCase());
        break;
      }
      const index = Array.prototype.indexOf.call(parent.children, current) + 1;
      const tag = current.localName || current.tagName.toLowerCase();
      parts.unshift(`${tag}:nth-child(${index})`);
      current = parent;
    }
    parts.unshift("html");
    return parts.join(" > ");
  }

  function quoteCssAttr(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  function cssEscapeIdent(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
  }

  function stableClasses(element) {
    if (!element.classList) return [];
    return Array.prototype.filter.call(element.classList, isStableClass);
  }

  function uniqueCssSelector(injected, element) {
    const tag = element.localName || element.tagName.toLowerCase();
    const id = element.getAttribute && element.getAttribute("id");
    if (isStableId(id)) {
      const ident = cssEscapeIdent(id);
      if (isExact(injected, element, `#${ident}`)) return `#${ident}`;
      if (isExact(injected, element, `${tag}#${ident}`)) return `${tag}#${ident}`;
    }
    const classes = stableClasses(element);
    const candidates = [];
    for (const name of classes) {
      const ident = cssEscapeIdent(name);
      candidates.push(`${tag}.${ident}`);
      candidates.push(`.${ident}`);
    }
    for (const candidate of candidates) {
      if (isExact(injected, element, candidate)) return candidate;
    }
    return null;
  }

  function pickSelector(injected, element) {
    const role = ariaRole(injected, element);
    const name = controlName(injected, element, role);
    if (role && name) {
      const chosen = resolve(injected, element, [
        roleSelector(role, name, false),
        roleSelector(role, name, true),
      ]);
      if (chosen) return chosen;
      const chained = chainFromNearby(injected, element, role, name);
      if (chained) return chained;
    }

    const labels = labelStrings(injected, element);
    if (labels.length) {
      const selectors = [];
      for (const label of labels) pushTextPair(selectors, labelSelector, label);
      const chosen = resolve(injected, element, selectors);
      if (chosen) return chosen;
    }

    const tag = (element.localName || element.tagName || "").toLowerCase();
    if ((tag === "input" || tag === "textarea") && element.getAttribute("placeholder")) {
      const placeholder = element.getAttribute("placeholder");
      const chosen = resolve(injected, element, [
        attrSelector("placeholder", placeholder, false),
        attrSelector("placeholder", placeholder, true),
      ]);
      if (chosen) return chosen;
    }

    if (element.getAttribute && element.hasAttribute("alt") && ["img", "input", "area", "applet"].indexOf(tag) !== -1) {
      const alt = element.getAttribute("alt");
      if (alt) {
        const chosen = resolve(injected, element, [
          attrSelector("alt", alt, false),
          attrSelector("alt", alt, true),
        ]);
        if (chosen) return chosen;
      }
    }

    if (element.getAttribute && element.hasAttribute("title")) {
      const title = element.getAttribute("title");
      if (title) {
        const chosen = resolve(injected, element, [
          attrSelector("title", title, false),
          attrSelector("title", title, true),
        ]);
        if (chosen) return chosen;
      }
    }

    if (element.getAttribute && element.hasAttribute(TEST_ID_ATTR)) {
      const testId = element.getAttribute(TEST_ID_ATTR);
      if (testId) {
        const chosen = resolve(injected, element, [testIdSelector(testId)]);
        if (chosen) return chosen;
      }
    }

    const text = normalizedText(injected, element);
    if (text && text.length <= 80) {
      const chosen = resolve(injected, element, [
        textSelector(text, false),
        textSelector(text, true),
      ]);
      if (chosen) return chosen;
    }

    if (role && !name) {
      const base = roleSelector(role, "", false);
      const matches = queryAll(injected, base, element.ownerDocument);
      if (matches && matches.length > 1 && indexOfNode(matches, element) !== -1) {
        const tightened = tighten(injected, element, base, matches);
        if (tightened && tightened !== base && !usesIndex(tightened) && isExact(injected, element, tightened))
          return tightened;
      }
    }

    const byId = stableIdSelector(injected, element);
    if (byId) return byId;

    const byClass = uniqueCssSelector(injected, element);
    if (byClass && isExact(injected, element, byClass)) return byClass;

    const byValue = valueSelector(element);
    if (byValue && isExact(injected, element, byValue)) return byValue;

    const closest = closestCss(injected, element);
    if (closest) return closest.selector;
    return tag || "html";
  }

  function stableIdSelector(injected, element) {
    const id = element.getAttribute && element.getAttribute("id");
    if (!isStableId(id)) return null;
    const tag = element.localName || element.tagName.toLowerCase();
    const ident = cssEscapeIdent(id);
    if (isExact(injected, element, `#${ident}`)) return `#${ident}`;
    if (isExact(injected, element, `${tag}#${ident}`)) return `${tag}#${ident}`;
    return null;
  }

  function valueSelector(element) {
    const tag = (element.localName || element.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return null;
    const value = element.getAttribute && element.getAttribute("value");
    if (!value) return null;
    return `${tag}[value=${quoteCssAttr(value)}]`;
  }

  function containerTokens(element) {
    const tag = element.localName || element.tagName.toLowerCase();
    const tokens = [];
    const id = element.getAttribute && element.getAttribute("id");
    if (isStableId(id)) tokens.push(`${tag}#${cssEscapeIdent(id)}`);
    const classes = stableClasses(element);
    const specific = classes.filter((name) => !/-root$/.test(name));
    const ordered = (specific.length ? specific : classes).concat(specific.length ? classes : []);
    const seen = new Set();
    for (const name of ordered) {
      if (seen.has(name)) continue;
      seen.add(name);
      tokens.push(`${tag}.${cssEscapeIdent(name)}`);
    }
    const valued = valueSelector(element);
    if (valued) tokens.push(valued);
    const attrName = element.getAttribute && element.getAttribute("name");
    if (attrName) tokens.push(`${tag}[name=${quoteCssAttr(attrName)}]`);
    const explicitRole = element.getAttribute && element.getAttribute("role");
    if (explicitRole) tokens.push(`${tag}[role=${quoteCssAttr(explicitRole)}]`);
    tokens.push(tag);
    return tokens;
  }

  function shortToken(element) {
    return containerTokens(element)[0];
  }

  function closestCss(injected, element) {
    const doc = element.ownerDocument;
    const tokens = [];
    let current = element;
    let best = null;
    while (current && current.nodeType === 1 && current !== doc.documentElement && current !== doc.body && tokens.length < 3) {
      tokens.unshift(shortToken(current));
      const selector = tokens.join(" > ");
      if (usesIndex(selector)) break;
      best = selector;
      if (isExact(injected, element, selector)) {
        const bare = tokens.some((token) => /^[a-z][a-z0-9]*$/i.test(token));
        return { selector, note: bare ? UNSTABLE_NOTE : "" };
      }
      current = current.parentElement;
    }
    if (!best) return null;
    return { selector: best, note: UNSTABLE_NOTE };
  }

  function frameElementSelector(injected, frameEl) {
    const tag = frameEl.localName || frameEl.tagName.toLowerCase();
    const candidates = [];
    const name = frameEl.getAttribute("name");
    const title = frameEl.getAttribute("title");
    const id = frameEl.getAttribute("id");
    if (name) candidates.push(`${tag}[name=${quoteCssAttr(name)}]`);
    if (title) candidates.push(`${tag}[title=${quoteCssAttr(title)}]`);
    if (id && /^[A-Za-z][A-Za-z0-9\-_]+$/.test(id)) candidates.push(`${tag}#${id}`);
    const testId = frameEl.getAttribute(TEST_ID_ATTR);
    if (testId) candidates.push(`${tag}[${TEST_ID_ATTR}=${quoteCssAttr(testId)}]`);
    candidates.push(tag);
    for (const candidate of candidates) {
      if (isExact(injected, frameEl, candidate)) return candidate;
    }
    const unique = ensureUnique(injected, frameEl, tag);
    if (unique && !usesIndex(unique)) return unique;
    try {
      const generated = generateForExact(injected, frameEl);
      if (generated && !usesIndex(generated.selector) && isExact(injected, frameEl, generated.selector))
        return generated.selector;
    } catch (e) {
      /* ignore */
    }
    const byClass = uniqueCssSelector(injected, frameEl);
    if (byClass) return byClass;
    return tag;
  }

  function rewriteContentFrame(code) {
    return String(code).replace(
      /Locator\(("(?:\\.|[^"\\])*")\)(\.(?:First|Last|Nth\(-?\d+\)))?\.ContentFrame/g,
      function (_match, arg, mid) {
        return `FrameLocator(${arg})${mid || ""}`;
      }
    );
  }

  function csharpQuote(text) {
    const stringified = JSON.stringify(String(text));
    const escaped = stringified.slice(1, -1).replace(/\\"/g, '"').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  function selectorToCSharp(injected, selector) {
    let code = "";
    try {
      code = injected.utils.asLocator("csharp", selector);
    } catch (e) {
      code = "";
    }
    if (!code || code === selector)
      code = `Locator(${csharpQuote(selector)})`;
    code = code.replace(/Has = (?!page\.)/g, "Has = page.");
    code = rewriteContentFrame(code);
    if (!/^page\./.test(code)) code = `page.${code}`;
    return code;
  }

  function locatorNote(injected, element, selector) {
    const valued = valueSelector(element);
    if (valued && selector === valued) return VALUE_NOTE;
    if (/internal:(?:role|label|attr|testid|text|has)=/.test(selector || "") && isExact(injected, element, selector))
      return "";
    if (!selector || usesIndex(selector) || !isExact(injected, element, selector)) return UNSTABLE_NOTE;
    if (/^(?:[a-z][a-z0-9]*)(?:\s*>\s*[a-z][a-z0-9]*)*$/i.test(selector)) return UNSTABLE_NOTE;
    return "";
  }

  function describe(injected, element, frameChain) {
    let inner = pickSelector(injected, element);
    let note = locatorNote(injected, element, inner);
    let selector = frameChain
      ? `${frameChain} >> internal:control=enter-frame >> ${inner}`
      : inner;
    let csharp = selectorToCSharp(injected, selector);
    if (usesIndex(inner) || csharpUsesIndex(csharp)) {
      const closest = closestCss(injected, element);
      inner = closest ? closest.selector : (element.localName || "html");
      note = (closest && closest.note) || UNSTABLE_NOTE;
      selector = frameChain
        ? `${frameChain} >> internal:control=enter-frame >> ${inner}`
        : inner;
      csharp = selectorToCSharp(injected, selector);
    }
    return { inner, selector, csharp, note };
  }

  return {
    TEST_ID_ATTR,
    queryAll,
    isExact,
    tighten,
    ensureUnique,
    pickSelector,
    frameElementSelector,
    rewriteContentFrame,
    selectorToCSharp,
    describe,
    csharpQuote,
    VALUE_NOTE,
    UNSTABLE_NOTE,
  };
});
