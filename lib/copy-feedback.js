/* Clipboard outcome shown by the panel and the popup. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PwCopy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COPIED = "Panoya kopyalandı.";
  const FAILED = "Kopyalanamadı. Metin seçili; Ctrl+C kullanın.";

  function copyFeedback(ok) {
    if (ok) return { status: COPIED, tone: "ok", button: "Kopyalandı" };
    return { status: FAILED, tone: "err", button: "Kopyala" };
  }

  return { COPIED, FAILED, copyFeedback };
});
