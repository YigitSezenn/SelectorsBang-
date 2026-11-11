/* Pick mode: highlight, swallow the click, copy a C# locator. */
(function () {
  if (globalThis.__pwCSharpPickerInstalled) return;
  globalThis.__pwCSharpPickerInstalled = true;

  const HOST_ID = "pw-csharp-picker-root";
  let picking = false;
  let injected = null;
  let host = null;
  let shadow = null;
  let highlight = null;
  let panel = null;
  let hintEl = null;
  let statusEl = null;
  let codeEl = null;
  let copyBtn = null;
  let copyTimer = 0;
  let frameChain = "";
  let frameChainReady = window.top === window;
  let chainToken = 0;
  let hovered = null;
  let moveQueued = false;

  function getInjected() {
    if (!injected) {
      injected = createPlaywrightInjectedScript(window, {
        isUnderTest: false,
        sdkLanguage: "csharp",
        testIdAttributeName: "data-testid",
        stableRafCount: 1,
        browserName: "chromium",
        customEngines: [],
      });
    }
    return injected;
  }

  function ensureUi() {
    if (host && host.isConnected) return;
    const parent = document.documentElement || document.body;
    if (!parent) return;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;z-index:2147483647;inset:0;width:auto;height:auto;pointer-events:none;background:transparent;overflow:visible;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .box {
          position: fixed;
          pointer-events: none;
          border: 2px solid #6d28d9;
          background: rgba(109, 40, 217, 0.16);
          border-radius: 4px;
          box-sizing: border-box;
          z-index: 2147483646;
        }
        .panel {
          position: fixed;
          top: 16px;
          right: 16px;
          width: min(440px, calc(100vw - 32px));
          pointer-events: auto;
          z-index: 2147483647;
          background: #16141f;
          color: #f4f1fb;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
          font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
          padding: 14px 14px 12px;
        }
        header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 10px; }
        .title { font-weight: 700; font-size: 14px; letter-spacing: -0.02em; margin: 0; }
        .sub { margin: 1px 0 0; color: #b7adc9; font-size: 11px; }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 0;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(34, 197, 94, 0.16);
          color: #86efac;
          font-size: 12px;
          font-weight: 700;
        }
        .pill::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
        .hint { color: #b7adc9; margin: 0 0 10px; }
        pre {
          margin: 0 0 8px;
          padding: 10px 12px;
          background: #0e0c14;
          border-radius: 10px;
          white-space: pre;
          word-break: normal;
          overflow-wrap: normal;
          font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          max-height: 160px;
          overflow: auto;
          user-select: text;
        }
        .status { margin: 0 0 10px; min-height: 1.2em; color: #b7adc9; }
        .status.ok { color: #86efac; }
        .status.err { color: #fcd34d; }
        .status.idle { color: #b7adc9; }
        .row { display: flex; align-items: center; gap: 8px; }
        button {
          appearance: none;
          border: 0;
          border-radius: 8px;
          padding: 8px 12px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          background: #7c3aed;
          color: white;
        }
        button.text { background: transparent; color: #c4b5fd; font-weight: 600; padding-inline: 8px; }
        button:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 2px; }
      </style>
      <div class="box" hidden></div>
      <div class="panel" hidden>
        <header>
          <div>
            <p class="title">SelectorsBang</p>
            <p class="sub">Playwright C#</p>
          </div>
          <p class="pill">Açık</p>
        </header>
        <p class="hint"></p>
        <pre hidden></pre>
        <p class="status" hidden></p>
        <div class="row">
          <button type="button" class="copy" hidden>Kopyala</button>
          <button type="button" class="stop text">Seçim modunu kapat</button>
        </div>
      </div>
    `;
    highlight = shadow.querySelector(".box");
    panel = shadow.querySelector(".panel");
    hintEl = shadow.querySelector(".hint");
    codeEl = shadow.querySelector("pre");
    copyBtn = shadow.querySelector(".copy");
    statusEl = shadow.querySelector(".status");
    shadow.querySelector(".stop").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ type: "cancel" });
    });
    copyBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (codeEl.textContent) copyText(codeEl.textContent);
    });
    parent.appendChild(host);
  }

  function isOurUi(node) {
    if (!node || !host) return false;
    if (node === host) return true;
    const path = node.getRootNode && node.getRootNode();
    return path === shadow;
  }

  function eventElement(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node && node.nodeType === 1 && !isOurUi(node)) return node;
    }
    if (event.target && event.target.nodeType === 1 && !isOurUi(event.target)) return event.target;
    return null;
  }

  function showIdle() {
    ensureUi();
    if (!panel) return;
    panel.hidden = false;
    hintEl.hidden = false;
    hintEl.textContent = "Sayfada bir öğeye tıklayın. Esc vazgeçirir.";
    codeEl.hidden = true;
    statusEl.hidden = true;
    statusEl.textContent = "";
    copyBtn.hidden = true;
    copyBtn.textContent = "Kopyala";
  }

  function showResult(csharp, note) {
    ensureUi();
    if (!panel) return;
    panel.hidden = false;
    hintEl.hidden = !note;
    hintEl.textContent = note || "";
    codeEl.hidden = false;
    codeEl.textContent = csharp;
    statusEl.hidden = false;
    statusEl.className = "status idle";
    statusEl.textContent = "Panoya yazılıyor…";
    copyBtn.hidden = false;
    copyBtn.textContent = "Kopyala";
  }

  function showError(message) {
    ensureUi();
    if (!panel) return;
    panel.hidden = false;
    hintEl.hidden = true;
    statusEl.hidden = false;
    statusEl.className = "status err";
    statusEl.textContent = message || "Seçici üretilemedi.";
  }

  function selectCode() {
    if (!codeEl) return;
    const selection = typeof shadow.getSelection === "function" ? shadow.getSelection() : window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(codeEl);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function paintCopy(ok, text) {
    if (!statusEl || !codeEl || codeEl.textContent !== text || !globalThis.PwCopy) return;
    const feedback = PwCopy.copyFeedback(ok);
    statusEl.hidden = false;
    statusEl.className = "status " + feedback.tone;
    statusEl.textContent = feedback.status;
    copyBtn.hidden = false;
    copyBtn.textContent = feedback.button;
    clearTimeout(copyTimer);
    if (ok) {
      copyTimer = setTimeout(() => {
        if (copyBtn) copyBtn.textContent = "Kopyala";
      }, 1600);
    } else {
      selectCode();
    }
  }

  function hideUi() {
    if (highlight) highlight.hidden = true;
    if (panel) panel.hidden = true;
    hovered = null;
  }

  function moveHighlight(element) {
    ensureUi();
    if (!highlight) return;
    if (!element || isOurUi(element)) {
      highlight.hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      highlight.hidden = true;
      return;
    }
    highlight.hidden = false;
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  function copyText(text) {
    const send = chrome.runtime.sendMessage({ type: "copy", text });
    const done = (ok) => paintCopy(!!ok, text);
    if (send && typeof send.then === "function") {
      send.then((response) => done(response && response.ok), () => done(false));
    } else {
      done(false);
    }
  }

  function refreshFrameChain() {
    if (window.top === window) {
      frameChain = "";
      frameChainReady = true;
      return Promise.resolve("");
    }
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    chainToken = token;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        if (chainToken === token) frameChainReady = true;
        resolve(frameChain);
      }, 700);
      function onMessage(event) {
        const data = event.data;
        if (!data || data.source !== "pw-csharp-picker" || data.type !== "frame-chain" || data.token !== token)
          return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        frameChain = data.chain || "";
        frameChainReady = true;
        resolve(frameChain);
      }
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ source: "pw-csharp-picker", type: "identify", token }, "*");
    });
  }

  function setPicking(on) {
    picking = !!on;
    if (picking) {
      frameChainReady = window.top === window;
      refreshFrameChain();
      showIdle();
      document.documentElement && document.documentElement.setAttribute("data-pw-csharp-picking", "1");
    } else {
      hideUi();
      if (document.documentElement) document.documentElement.removeAttribute("data-pw-csharp-picking");
    }
  }

  globalThis.__pwCSharpSetPicking = setPicking;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "pw-csharp-picker" || data.type !== "identify") return;
    const frames = document.querySelectorAll("iframe,frame");
    let frameEl = null;
    for (const candidate of frames) {
      if (candidate.contentWindow === event.source) {
        frameEl = candidate;
        break;
      }
    }
    if (!frameEl) return;
    Promise.resolve(window.top === window ? "" : refreshFrameChain()).then((prefix) => {
      let local = "iframe";
      try {
        local = PwCSharpPicker.frameElementSelector(getInjected(), frameEl);
      } catch (e) {
        local = frameEl.localName || "iframe";
      }
      const chain = prefix ? `${prefix} >> internal:control=enter-frame >> ${local}` : local;
      event.source.postMessage({
        source: "pw-csharp-picker",
        type: "frame-chain",
        token: data.token,
        chain,
      }, "*");
    }).catch(() => {});
  });

  function fromOurUi(event) {
    if (isOurUi(event.target)) return true;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path.some(isOurUi);
  }

  function blockPageEvent(event) {
    if (!picking || fromOurUi(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return true;
  }

  let lastPickAt = 0;
  window.addEventListener("pointerdown", (event) => {
    if (!blockPageEvent(event) || event.button !== 0) return;
    lastPickAt = Date.now();
    selectElement(event);
  }, true);
  window.addEventListener("mousedown", (event) => {
    if (!blockPageEvent(event) || event.button !== 0) return;
    if (Date.now() - lastPickAt > 500) selectElement(event);
  }, true);
  for (const type of ["click", "auxclick", "dblclick", "mouseup", "pointerup", "contextmenu", "dragstart"]) {
    window.addEventListener(type, (event) => {
      blockPageEvent(event);
    }, true);
  }

  window.addEventListener("keydown", (event) => {
    if (!picking || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage({ type: "cancel" });
  }, true);

  window.addEventListener("mousemove", (event) => {
    if (!picking) return;
    if (moveQueued) return;
    moveQueued = true;
    const x = event.clientX;
    const y = event.clientY;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (!picking) return;
      const element = document.elementFromPoint(x, y);
      if (!element || isOurUi(element) || element.localName === "iframe" || element.localName === "frame") {
        if (highlight) highlight.hidden = true;
        hovered = null;
        return;
      }
      hovered = element;
      moveHighlight(element);
      if (window.top !== window && !frameChain) refreshFrameChain();
    });
  }, true);

  window.addEventListener("scroll", () => {
    if (picking && hovered) moveHighlight(hovered);
  }, true);

  window.addEventListener("mouseout", (event) => {
    if (!picking) return;
    if (!event.relatedTarget) {
      hovered = null;
      if (highlight) highlight.hidden = true;
    }
  }, true);

  function selectElement(event) {
    const element = eventElement(event);
    if (!element || isOurUi(element)) return;
    const finish = () => {
      let result = null;
      try {
        result = PwCSharpPicker.describe(getInjected(), element, frameChain);
      } catch (e) {
        showError("Seçici üretilemedi.");
        return;
      }
      if (!result || !result.csharp) {
        showError("Seçici üretilemedi.");
        return;
      }
      showResult(result.csharp, result.note);
      copyText(result.csharp);
      const send = chrome.runtime.sendMessage({
        type: "picked",
        csharp: result.csharp,
        selector: result.selector,
        note: result.note || "",
      });
      if (send && typeof send.catch === "function") send.catch(() => {});
    };
    if (window.top !== window && !frameChainReady) refreshFrameChain().then(finish, finish);
    else finish();
  }

  function syncFromBackground() {
    chrome.runtime.sendMessage({ type: "get-state" }, (response) => {
      const err = chrome.runtime.lastError;
      if (err || !response) return;
      setPicking(!!response.picking);
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;
    if (message.type === "picking") {
      setPicking(!!message.picking);
      sendResponse({ ok: true });
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncFromBackground, { once: true });
  } else {
    syncFromBackground();
  }
})();
