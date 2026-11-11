const pillEl = document.getElementById("pill");
const toggleBtn = document.getElementById("toggle");
const hintEl = document.getElementById("hint");
const noteEl = document.getElementById("locator-note");
const locatorEl = document.getElementById("locator");
const copyBtn = document.getElementById("copy");
const statusEl = document.getElementById("status");

let tabId = null;
let picking = false;
let lastLocator = "";
let lastNote = "";
let copyTimer = 0;
let copyLabel = "Kopyala";

function render() {
  const view = PwPopup.popupView({ picking, lastLocator, note: lastNote });
  pillEl.textContent = view.mode;
  pillEl.classList.toggle("on", picking);
  pillEl.classList.toggle("off", !picking);
  toggleBtn.textContent = view.toggleLabel;
  hintEl.textContent = picking ? view.hint : view.pressHint;
  noteEl.hidden = !view.note;
  noteEl.textContent = view.note;
  locatorEl.textContent = view.locatorText;
  copyBtn.disabled = !view.copyEnabled;
  copyBtn.textContent = copyLabel;
}

function selectLocator() {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(locatorEl);
  selection.removeAllRanges();
  selection.addRange(range);
}

function paintCopy(ok) {
  const feedback = PwCopy.copyFeedback(ok);
  statusEl.className = "status " + feedback.tone;
  statusEl.textContent = feedback.status;
  copyLabel = feedback.button;
  copyBtn.textContent = feedback.button;
  clearTimeout(copyTimer);
  if (ok) {
    copyTimer = setTimeout(() => {
      copyLabel = "Kopyala";
      copyBtn.textContent = "Kopyala";
    }, 1600);
  } else {
    selectLocator();
  }
}

async function showTab(id, focus) {
  tabId = id || null;
  const state = await chrome.runtime.sendMessage({ type: "get-state", tabId });
  const data = await chrome.storage.local.get(["lastLocator", "lastNote"]);
  picking = !!(state && state.picking);
  lastLocator = data.lastLocator || "";
  lastNote = data.lastNote || "";
  render();
  if (focus && !picking) toggleBtn.focus();
}

async function refresh(focus) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await showTab(tab && tab.id != null ? tab.id : null, focus);
}

async function toggle() {
  statusEl.textContent = "";
  statusEl.className = "status";
  const response = await chrome.runtime.sendMessage({
    type: "set-picking",
    tabId,
    on: !picking,
  });
  if (response && response.error) {
    statusEl.className = "status err";
    statusEl.textContent = response.error;
    return;
  }
  picking = !!(response && response.picking);
  render();
}

async function copyLocator() {
  const view = PwPopup.popupView({ picking, lastLocator });
  if (view.empty) return;
  let ok = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: "copy", text: view.locatorText });
    ok = !!(response && response.ok);
  } catch (e) {
    ok = false;
  }
  paintCopy(ok);
}

toggleBtn.addEventListener("click", () => {
  toggle().catch((error) => {
    statusEl.className = "status err";
    statusEl.textContent = error && error.message ? error.message : "Seçim modu değiştirilemedi.";
  });
});
copyBtn.addEventListener("click", () => {
  copyLocator().catch(() => paintCopy(false));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastLocator) {
    lastLocator = changes.lastLocator.newValue || "";
    if (changes.lastNote) lastNote = changes.lastNote.newValue || "";
    copyLabel = "Kopyala";
    statusEl.textContent = "";
    statusEl.className = "status";
    render();
  }
  if (area === "session" && changes.pickingTabs && tabId != null) {
    const tabs = changes.pickingTabs.newValue || {};
    picking = !!tabs[tabId];
    render();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target === "offscreen") return;
  if (message.type === "bind-tab") {
    showTab(message.tabId, false).catch(() => {});
  }
  if (message.type === "locator-updated") {
    if (message.tabId && tabId && message.tabId !== tabId) return;
    lastLocator = message.csharp || "";
    lastNote = message.note || "";
    picking = true;
    copyLabel = "Kopyala";
    statusEl.textContent = "";
    statusEl.className = "status";
    render();
  }
  if (message.type === "picking-updated" && (message.tabId == null || message.tabId === tabId)) {
    picking = !!message.picking;
    render();
  }
});

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab || tab.id !== info.tabId) return;
    showTab(tab.id, false).catch(() => {});
  }).catch(() => {});
});

refresh(true).catch(() => render());
