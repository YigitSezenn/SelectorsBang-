/* What the toolbar popup shows. Shared with the node test. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PwPopup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EMPTY = "Henüz bir öğe seçilmedi.";

  function popupView(state) {
    const on = !!(state && state.picking);
    const locator = state && typeof state.lastLocator === "string" ? state.lastLocator.trim() : "";
    return {
      mode: on ? "Açık" : "Kapalı",
      toggleLabel: on ? "Seçim modunu kapat" : "Seçim modunu aç",
      pressHint: on ? "Kapatmak için buraya basın" : "Açmak için buraya basın",
      hint: on
        ? "Seçim modu açık. Sayfada bir öğeye tıklayın. Esc vazgeçirir."
        : "Seçim modu kapalı.",
      locatorText: locator || EMPTY,
      note: state && typeof state.note === "string" ? state.note : "",
      copyEnabled: locator.length > 0,
      empty: locator.length === 0,
    };
  }

  return { EMPTY, popupView };
});
