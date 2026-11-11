async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return !!ok;
    } catch (err) {
      return false;
    }
  }
}

function connectClipboard() {
  const port = chrome.runtime.connect({ name: "clipboard" });
  port.onMessage.addListener((message) => {
    if (!message || message.type !== "copy-text") return;
    const text = typeof message.text === "string" ? message.text : "";
    writeClipboard(text).then(
      (ok) => port.postMessage({ id: message.id, ok, text }),
      () => port.postMessage({ id: message.id, ok: false, text })
    );
  });
  port.onDisconnect.addListener(() => {
    setTimeout(connectClipboard, 50);
  });
}

connectClipboard();
