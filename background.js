const pickingTabs = new Map();
const SCRIPT_FILES = ["lib/injected-script.js", "lib/picker-core.js", "lib/copy-feedback.js", "content/picker.js"];
let offscreenReady = null;
let clipboardPort = null;
const copyWaiters = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "clipboard") return;
  clipboardPort = port;
  port.onDisconnect.addListener(() => {
    if (clipboardPort === port) clipboardPort = null;
  });
  port.onMessage.addListener((message) => {
    if (!message || !copyWaiters.has(message.id)) return;
    const resolve = copyWaiters.get(message.id);
    copyWaiters.delete(message.id);
    resolve(!!message.ok);
  });
});

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Seçilen Playwright C# ifadesini panoya yazmak için.",
      });
    } catch (e) {
      if (!(await chrome.offscreen.hasDocument())) throw e;
    }
  })().catch((error) => {
    offscreenReady = null;
    throw error;
  });
  return offscreenReady;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyToClipboard(text) {
  await ensureOffscreen();
  for (let attempt = 0; attempt < 20 && !clipboardPort; attempt++) await wait(25);
  if (!clipboardPort) return false;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = new Promise((resolve) => {
    copyWaiters.set(id, resolve);
    setTimeout(() => {
      if (!copyWaiters.has(id)) return;
      copyWaiters.delete(id);
      resolve(false);
    }, 1500);
  });
  try {
    clipboardPort.postMessage({
      type: "copy-text",
      id,
      text: typeof text === "string" ? text : "",
    });
  } catch (e) {
    copyWaiters.delete(id);
    return false;
  }
  return result;
}
const ready = chrome.storage.session.get("pickingTabs").then((data) => {
  for (const [id, on] of Object.entries(data.pickingTabs || {})) {
    if (on) pickingTabs.set(Number(id), true);
  }
}).catch(() => {});

function titleFor(on) {
  return on ? "SelectorsBang · seçim açık" : "SelectorsBang";
}

function dockPanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

dockPanel();

async function openSidePanel(tabId) {
  await chrome.sidePanel.open({ tabId });
}

async function setBadge(tabId, on) {
  await chrome.action.setBadgeText({ tabId, text: on ? "AÇIK" : "" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: on ? "#15803d" : "#4c1d95" });
  await chrome.action.setTitle({ tabId, title: titleFor(on) });
}

async function ensureInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: SCRIPT_FILES,
  });
}

async function broadcast(tabId, on) {
  if (on) {
    try {
      await ensureInjected(tabId);
    } catch (e) {
      throw new Error("Bu sayfada seçim modu açılamaz. Sayfayı yenileyip tekrar deneyin.");
    }
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (picking) => {
        if (typeof globalThis.__pwCSharpSetPicking === "function")
          globalThis.__pwCSharpSetPicking(picking);
      },
      args: [on],
    });
  } catch (e) {
    if (on) throw new Error("Bu sayfada seçim modu açılamaz. Sayfayı yenileyip tekrar deneyin.");
  }
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    for (const frame of frames || []) {
      chrome.tabs.sendMessage(tabId, { type: "picking", picking: on }, { frameId: frame.frameId }).catch(() => {});
    }
  } catch (e) {
    chrome.tabs.sendMessage(tabId, { type: "picking", picking: on }).catch(() => {});
  }
}

async function setPicking(tabId, on) {
  await ready;
  if (on) pickingTabs.set(tabId, true);
  else pickingTabs.delete(tabId);
  await chrome.storage.session.set({ pickingTabs: Object.fromEntries(pickingTabs) });
  await setBadge(tabId, on);
  await broadcast(tabId, on);
  chrome.runtime.sendMessage({ type: "picking-updated", tabId, picking: !!on }).catch(() => {});
  return { ok: true, picking: !!on };
}

chrome.runtime.onInstalled.addListener(() => {
  dockPanel();
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "show-locator",
      title: "SelectorsBang panelini aç",
      contexts: ["action"],
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  dockPanel();
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pickingTabs.delete(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) openSidePanel(tab.id).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "show-locator" && tab && tab.id != null) openSidePanel(tab.id).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderTabId = sender.tab && sender.tab.id;
  if (!message) return;
  if (message.type === "get-state") {
    const id = message.tabId || senderTabId;
    ready.then(() => {
      sendResponse({ picking: !!(id != null && pickingTabs.get(Number(id))), tabId: id });
    });
    return true;
  }
  if (message.type === "set-picking") {
    const id = Number(message.tabId || senderTabId);
    if (!id) {
      sendResponse({ ok: false, error: "Açık bir sayfa sekmesi yok." });
      return;
    }
    setPicking(id, !!message.on).then((result) => sendResponse(result)).catch((error) => {
      pickingTabs.delete(id);
      chrome.storage.session.set({ pickingTabs: Object.fromEntries(pickingTabs) }).catch(() => {});
      setBadge(id, false).catch(() => {});
      sendResponse({ ok: false, picking: false, error: error.message || "Seçim modu açılamadı." });
    });
    return true;
  }
  if (message.type === "cancel" && senderTabId != null) {
    setPicking(senderTabId, false).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "picked") {
    const tabId = senderTabId;
    const csharp = message.csharp || "";
    chrome.storage.local.set({
      lastLocator: csharp,
      lastNote: message.note || "",
      lastSelector: message.selector || "",
      lastUrl: (sender.tab && sender.tab.url) || "",
      lastTabId: tabId || null,
      lastAt: Date.now(),
    }).then(() => {
      chrome.runtime.sendMessage({ type: "locator-updated", csharp, note: message.note || "", tabId }).catch(() => {});
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "copy") {
    copyToClipboard(message.text).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "open-popup") {
    const id = message.tabId || senderTabId;
    if (id != null) openSidePanel(id).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    else sendResponse({ ok: false });
    return true;
  }
});
