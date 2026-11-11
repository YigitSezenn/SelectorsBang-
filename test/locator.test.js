const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const picker = require("../lib/picker-core.js");
const popup = require("../lib/popup-view.js");
const copyFeedback = require("../lib/copy-feedback.js");

const root = path.join(__dirname, "..");
const injectedSource = fs.readFileSync(path.join(root, "lib/injected-script.js"), "utf8");
const quiet = new VirtualConsole();
quiet.on("jsdomError", () => {});

const DOM_GLOBALS = [
  "MutationObserver", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLTextAreaElement", "HTMLImageElement", "HTMLLabelElement", "Document",
  "ShadowRoot", "SVGElement", "NodeFilter", "Text", "Comment", "Range", "DOMParser",
];

function prepare(win) {
  const proto = win.Element && win.Element.prototype;
  if (proto && !proto.checkVisibility) proto.checkVisibility = () => true;
  const original = win.getComputedStyle && win.getComputedStyle.bind(win);
  if (original) win.getComputedStyle = (element) => original(element);
  for (const key of DOM_GLOBALS) {
    if (win[key]) globalThis[key] = win[key];
  }
}

let injectedFactory;
function createInjected(win) {
  prepare(win);
  if (!injectedFactory)
    injectedFactory = new Function(`${injectedSource}\nreturn createPlaywrightInjectedScript;`);
  return injectedFactory()(win, {
    isUnderTest: false,
    sdkLanguage: "csharp",
    testIdAttributeName: "data-testid",
    stableRafCount: 1,
    browserName: "chromium",
    customEngines: [],
  });
}

function only(matches, element) {
  assert.equal(matches && matches.length, 1, `expected one match, got ${matches && matches.length}`);
  assert.equal(matches[0], element);
}

function dom(html) {
  const window = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
    url: "https://example.test/",
    virtualConsole: quiet,
  }).window;
  return { window, document: window.document, injected: createInjected(window) };
}

test("converter emits idiomatic C# in Playwright's locator shape", () => {
  const { injected } = dom("");
  const cases = [
    ['internal:role=button[name="Kaydet"i]', 'page.GetByRole(AriaRole.Button, new() { Name = "Kaydet" })'],
    ['internal:role=button[name="He\\"llo"s]', 'page.GetByRole(AriaRole.Button, new() { Name = "He\\"llo", Exact = true })'],
    ['internal:label="E-posta"i', 'page.GetByLabel("E-posta")'],
    ['internal:label="E-posta"s', 'page.GetByLabel("E-posta", new() { Exact = true })'],
    ['internal:attr=[placeholder="Ara"i]', 'page.GetByPlaceholder("Ara")'],
    ['internal:attr=[placeholder="Ara"s]', 'page.GetByPlaceholder("Ara", new() { Exact = true })'],
    ['internal:attr=[alt="Logo"i]', 'page.GetByAltText("Logo")'],
    ['internal:attr=[alt="Logo"s]', 'page.GetByAltText("Logo", new() { Exact = true })'],
    ['internal:attr=[title="Kapat"i]', 'page.GetByTitle("Kapat")'],
    ['internal:testid=[data-testid="submit"s]', 'page.GetByTestId("submit")'],
    ['internal:text="Merhaba"i', 'page.GetByText("Merhaba")'],
    ['internal:text="hello\\nwo\\"rld"i', 'page.GetByText("hello\\nwo\\"rld")'],
    ['div.card > span', 'page.Locator("div.card > span")'],
    ['internal:role=button[name="Kaydet"i] >> nth=1', 'page.GetByRole(AriaRole.Button, new() { Name = "Kaydet" }).Nth(1)'],
    ['internal:role=button >> internal:has-text="Kaydet"i', 'page.GetByRole(AriaRole.Button).Filter(new() { HasText = "Kaydet" })'],
    [
      'internal:role=region[name="İkinci"i] >> internal:role=button[name="Kaydet"i]',
      'page.GetByRole(AriaRole.Region, new() { Name = "İkinci" }).GetByRole(AriaRole.Button, new() { Name = "Kaydet" })',
    ],
    [
      'iframe >> internal:control=enter-frame >> internal:role=button[name="Kaydet"i]',
      'page.FrameLocator("iframe").GetByRole(AriaRole.Button, new() { Name = "Kaydet" })',
    ],
    [
      'iframe[name="odeme"] >> internal:control=enter-frame >> internal:role=button[name="Kaydet"i]',
      'page.FrameLocator("iframe[name=\\"odeme\\"]").GetByRole(AriaRole.Button, new() { Name = "Kaydet" })',
    ],
    [
      'iframe >> nth=1 >> internal:control=enter-frame >> internal:text="Kaydet"i',
      'page.FrameLocator("iframe").Nth(1).GetByText("Kaydet")',
    ],
  ];
  for (const [selector, expected] of cases) {
    assert.equal(picker.selectorToCSharp(injected, selector), expected, selector);
  }
});

test("rewrite turns ContentFrame into FrameLocator", () => {
  assert.equal(
    picker.rewriteContentFrame('Locator("iframe").ContentFrame.GetByRole(AriaRole.Button)'),
    'FrameLocator("iframe").GetByRole(AriaRole.Button)'
  );
  assert.equal(
    picker.rewriteContentFrame('Locator("iframe").Nth(1).ContentFrame.GetByText("Kaydet")'),
    'FrameLocator("iframe").Nth(1).GetByText("Kaydet")'
  );
  assert.equal(
    picker.rewriteContentFrame('Locator("iframe[name=\\"odeme\\"]").First.ContentFrame.Locator("span")'),
    'FrameLocator("iframe[name=\\"odeme\\"]").First.Locator("span")'
  );
});

test("a lone button becomes GetByRole and resolves only that node", () => {
  const { document, injected } = dom("<button>Kaydet</button>");
  const button = document.querySelector("button");
  const result = picker.describe(injected, button, "");
  assert.equal(result.csharp, 'page.GetByRole(AriaRole.Button, new() { Name = "Kaydet" })');
  only(picker.queryAll(injected, result.selector, document), button);
  console.log("EXAMPLE 1", result.csharp);
});

test("labeled field, placeholder, title, test id, alt, and text follow the preference order", () => {
  const { document, injected } = dom(`
    <label for="eposta">E-posta</label><input id="eposta">
    <input id="ara" placeholder="Ara">
    <span id="kapat" title="Kapat">x</span>
    <div id="submit" data-testid="submit"></div>
    <div id="not-role" aria-label="Etiket"></div>
    <p id="merhaba">Merhaba</p>
  `);
  const email = document.querySelector("#eposta");
  const emailResult = picker.describe(injected, email, "");
  assert.equal(emailResult.csharp, 'page.GetByRole(AriaRole.Textbox, new() { Name = "E-posta" })');
  only(picker.queryAll(injected, emailResult.inner, document), email);

  const search = document.querySelector("#ara");
  const searchResult = picker.describe(injected, search, "");
  assert.equal(searchResult.csharp, 'page.GetByRole(AriaRole.Textbox, new() { Name = "Ara" })');
  only(picker.queryAll(injected, searchResult.inner, document), search);

  const title = document.querySelector("#kapat");
  const titleResult = picker.describe(injected, title, "");
  assert.equal(titleResult.csharp, 'page.GetByTitle("Kapat")');
  only(picker.queryAll(injected, titleResult.inner, document), title);

  const submit = document.querySelector("#submit");
  const submitResult = picker.describe(injected, submit, "");
  assert.equal(submitResult.csharp, 'page.GetByTestId("submit")');
  only(picker.queryAll(injected, submitResult.inner, document), submit);

  const labelled = document.querySelector("#not-role");
  const labelledResult = picker.describe(injected, labelled, "");
  assert.equal(labelledResult.csharp, 'page.GetByLabel("Etiket")');
  only(picker.queryAll(injected, labelledResult.inner, document), labelled);

  const text = document.querySelector("#merhaba");
  const textResult = picker.describe(injected, text, "");
  assert.equal(textResult.csharp, 'page.GetByText("Merhaba")');
  only(picker.queryAll(injected, textResult.inner, document), text);
});

test("role is preferred over test id when both identify the button", () => {
  const { document, injected } = dom('<button data-testid="submit">Gönder</button>');
  const button = document.querySelector("button");
  const result = picker.describe(injected, button, "");
  assert.equal(result.csharp, 'page.GetByRole(AriaRole.Button, new() { Name = "Gönder" })');
  only(picker.queryAll(injected, result.inner, document), button);
});

test("duplicate names are tightened until only the clicked node matches", () => {
  const { document, injected } = dom(`
    <section aria-label="Birinci"><button>Kaydet</button></section>
    <section aria-label="İkinci"><button>Kaydet</button></section>
  `);
  const buttons = [...document.querySelectorAll("button")];
  const loose = 'internal:role=button[name="Kaydet"i]';
  assert.equal(picker.queryAll(injected, loose, document).length, 2);

  const second = picker.ensureUnique(injected, buttons[1], loose);
  assert.ok(second);
  only(picker.queryAll(injected, second, document), buttons[1]);
  assert.notEqual(picker.queryAll(injected, second, document)[0], buttons[0]);

  const described = picker.describe(injected, buttons[1], "");
  assert.equal(
    described.csharp,
    'page.GetByRole(AriaRole.Region, new() { Name = "İkinci" }).GetByRole(AriaRole.Button, new() { Name = "Kaydet" })'
  );
  only(picker.queryAll(injected, described.inner, document), buttons[1]);
});

test("identical buttons are not indexed with Nth", () => {
  const { document, injected } = dom(`
    <main>
      <button>Kaydet</button>
      <button>Kaydet</button>
    </main>
  `);
  const buttons = [...document.querySelectorAll("button")];
  const result = picker.describe(injected, buttons[1], "");
  assert.doesNotMatch(result.csharp, /\.Nth\(/);
  assert.doesNotMatch(result.inner, />>\s*nth=/);
  assert.doesNotMatch(result.csharp, /\.(?:First|Last)\b/);
});

test("filter narrows a shared role to the clicked node", () => {
  const { document, injected } = dom(`
    <div role="group"><span>Elma</span></div>
    <div role="group"><span>Armut</span></div>
  `);
  const groups = [...document.querySelectorAll('[role="group"]')];
  const result = picker.describe(injected, groups[0], "");
  only(picker.queryAll(injected, result.inner, document), groups[0]);
  assert.notEqual(picker.queryAll(injected, result.inner, document)[0], groups[1]);
});

test("quotes and backslashes stay valid C# and still find the node", () => {
  const { document, injected } = dom("<div></div>");
  const button = document.createElement("button");
  button.textContent = 'He"llo\\world';
  document.body.appendChild(button);
  const result = picker.describe(injected, button, "");
  assert.match(result.csharp, /^page\.GetByRole\(AriaRole\.Button,/);
  assert.match(result.csharp, /He\\"llo\\\\world|He\\"llo\\world/);
  assert.equal(result.csharp.includes("\n"), false);
  only(picker.queryAll(injected, result.inner, document), button);
  const literal = result.csharp.match(/Name = ("(?:\\.|[^"\\])*")/)[1];
  assert.equal(decodeCSharpString(literal), button.textContent === 'He"llo\\world'
    ? accessibleOrText(injected, button)
    : accessibleOrText(injected, button));
  assert.equal(decodeCSharpString(literal), accessibleOrText(injected, button));
});

test("an iframe button is FrameLocator plus the inner locator", () => {
  const { window, document, injected } = dom('<button>Kaydet</button><iframe name="odeme"></iframe>');
  const iframe = document.querySelector("iframe");
  const childDoc = iframe.contentDocument;
  childDoc.body.innerHTML = "<button>Kaydet</button>";
  const child = createInjected(iframe.contentWindow);
  const innerButton = childDoc.querySelector("button");
  const frameSelector = picker.frameElementSelector(injected, iframe);
  only(picker.queryAll(injected, frameSelector, document), iframe);
  const inner = picker.pickSelector(child, innerButton);
  only(picker.queryAll(child, inner, childDoc), innerButton);
  const full = `${frameSelector} >> internal:control=enter-frame >> ${inner}`;
  const csharp = picker.selectorToCSharp(injected, full);
  assert.equal(
    csharp,
    'page.FrameLocator("iframe[name=\\"odeme\\"]").GetByRole(AriaRole.Button, new() { Name = "Kaydet" })'
  );
  const parentButton = document.querySelector("body > button");
  assert.notEqual(parentButton, innerButton);
  assert.equal(picker.queryAll(injected, inner, document).includes(parentButton) || picker.queryAll(injected, inner, document).length > 1, true);
  console.log("EXAMPLE 2", csharp);
  void window;
});

test("a picked locator is what the popup renders", () => {
  const closed = popup.popupView({ picking: false, lastLocator: "" });
  assert.equal(closed.mode, "Kapalı");
  assert.equal(closed.toggleLabel, "Seçim modunu aç");
  assert.equal(closed.pressHint, "Açmak için buraya basın");
  assert.equal(closed.locatorText, "Henüz bir öğe seçilmedi.");
  assert.equal(closed.copyEnabled, false);

  const { document, injected } = dom(`
    <div role="dialog" aria-label="Çalışma Alanını Düzenle">
      <label>Aktif <input type="checkbox"></label>
      <label>Adı <input value="test"></label>
      <button type="button">Vazgeç</button>
      <button type="button">Kaydet</button>
    </div>
  `);
  const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "Kaydet");
  const result = picker.describe(injected, save, "");
  only(picker.queryAll(injected, result.inner, document), save);
  const open = popup.popupView({ picking: true, lastLocator: result.csharp });
  assert.equal(open.mode, "Açık");
  assert.equal(open.toggleLabel, "Seçim modunu kapat");
  assert.equal(open.locatorText, result.csharp);
  assert.equal(open.empty, false);
  assert.equal(open.copyEnabled, true);
  assert.notEqual(open.locatorText, "Henüz bir öğe seçilmedi.");
  console.log("EXAMPLE DIALOG", result.csharp);
});

test("a failed clipboard write is not reported as copied", () => {
  const csharp = 'page.GetByRole(AriaRole.Option, new() { Name = "DID Teknoloji" })';
  let written = null;
  function write(text) {
    written = text;
    return false;
  }
  const feedback = copyFeedback.copyFeedback(write(csharp));
  assert.equal(written, csharp);
  assert.notEqual(feedback.status, copyFeedback.COPIED);
  assert.equal(feedback.status, "Kopyalanamadı. Metin seçili; Ctrl+C kullanın.");
  assert.equal(feedback.tone, "err");
  assert.equal(feedback.button, "Kopyala");
  const ok = copyFeedback.copyFeedback(true);
  assert.equal(ok.status, copyFeedback.COPIED);
  assert.equal(ok.button, "Kopyalandı");
  assert.equal(ok.tone, "ok");
});

test("a unique class becomes a css Locator", () => {
  const { document, injected } = dom('<div class="kayit-formu"></div><div class="kayit-formu"></div><div class="tek-kart"></div>');
  const card = document.querySelector(".tek-kart");
  const result = picker.describe(injected, card, "");
  only(picker.queryAll(injected, result.inner, document), card);
  assert.match(result.csharp, /Locator\("\.?tek-kart"\)|Locator\("div\.tek-kart"\)/);
});

test("two iframes do not share one frame selector", () => {
  const { document, injected } = dom('<iframe name="bir"></iframe><iframe name="iki"></iframe>');
  const frames = [...document.querySelectorAll("iframe")];
  const second = picker.frameElementSelector(injected, frames[1]);
  assert.doesNotMatch(second, /nth=/);
  only(picker.queryAll(injected, second, document), frames[1]);
});

test("a MUI color input is not an indexed role locator", () => {
  const { document, injected } = dom(`
    <div class="MuiInputBase-root MuiOutlinedInput-root MuiInputBase-colorPrimary MuiInputBase-formControl MuiInputBase-adornedStart css-1n12tw4">
      <div class="MuiInputAdornment-root MuiInputAdornment-positionStart">
        <button class="MuiButtonBase-root MuiColorInput-Button css-hash1" type="button"></button>
      </div>
      <input aria-invalid="false" autocomplete="off" id=":rs:" type="text" class="MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedStart css-sjdedl" value="rgba(33, 43, 54, 1)">
    </div>
    <div class="MuiInputBase-root MuiOutlinedInput-root MuiInputBase-colorPrimary MuiInputBase-formControl MuiInputBase-adornedStart css-1n12tw4">
      <div class="MuiInputAdornment-root MuiInputAdornment-positionStart">
        <button class="MuiButtonBase-root MuiColorInput-Button css-hash2" type="button"></button>
      </div>
      <input aria-invalid="false" autocomplete="off" id=":rq:" type="text" class="MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedStart css-sjdedl" value="rgba(255, 255, 255, 1)">
    </div>
    <input id=":r1:" type="text" class="MuiInputBase-input css-aaaa" value="diger">
  `);
  const input = document.querySelector('input[value="rgba(33, 43, 54, 1)"]');
  const result = picker.describe(injected, input, "");
  assert.doesNotMatch(result.csharp, /GetByRole\(AriaRole\.Textbox\)\.Nth\(/);
  assert.doesNotMatch(result.csharp, /\.Nth\(/);
  assert.doesNotMatch(result.inner, />>\s*nth=/);
  assert.doesNotMatch(result.csharp, /:rs:|css-sjdedl|css-1n12tw4/);
  assert.match(result.csharp, /rgba\(33, 43, 54, 1\)/);
  assert.equal(result.note, picker.VALUE_NOTE);
  only(picker.queryAll(injected, result.inner, document), input);
  console.log("EXAMPLE MUI", result.csharp);
});

test("a MUI Detaylar button is a named role locator", () => {
  const { document, injected } = dom(`
    <button class="MuiButtonBase-root MuiButton-root MuiButton-outlined MuiButton-outlinedPrimary MuiButton-sizeMedium MuiButton-outlinedSizeMedium MuiButton-disableElevation MuiButton-fullWidth MuiButton-root MuiButton-outlined MuiButton-outlinedPrimary MuiButton-sizeMedium MuiButton-outlinedSizeMedium MuiButton-disableElevation MuiButton-fullWidth css-b01ezj" tabindex="0" type="button">Detaylar<span class="MuiTouchRipple-root css-w0pj6f"></span></button>
  `);
  const button = document.querySelector("button");
  const result = picker.describe(injected, button, "");
  assert.equal(result.csharp, 'page.GetByRole(AriaRole.Button, new() { Name = "Detaylar" })');
  assert.equal(result.note, "");
  assert.doesNotMatch(result.note, /Kararlı bir seçici yok/);
  assert.doesNotMatch(result.csharp, /\.Nth\(|body >/);
  only(picker.queryAll(injected, result.inner, document), button);
});

test("duplicate Detaylar buttons chain from the nearby heading", () => {
  const button = `<button class="MuiButtonBase-root MuiButton-root MuiButton-outlined MuiButton-outlinedPrimary MuiButton-sizeMedium MuiButton-outlinedSizeMedium MuiButton-disableElevation MuiButton-fullWidth css-b01ezj" type="button">Detaylar<span class="MuiTouchRipple-root css-w0pj6f"></span></button>`;
  const { document, injected } = dom(`
    <div id="root">
      <div class="MuiBox-root">
        <main class="MuiBox-root">
          <div class="MuiGrid-root MuiGrid-container">
            <div class="MuiGrid-root MuiGrid-item">
              <div class="MuiBox-root"><h6 class="MuiTypography-root">Kart A</h6>${button}</div>
            </div>
            <div class="MuiGrid-root MuiGrid-item">
              <div class="MuiBox-root"><h6 class="MuiTypography-root">Kart B</h6>${button}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  `);
  const clicked = document.querySelector("button");
  const result = picker.describe(injected, clicked, "");
  assert.match(result.csharp, /GetByRole\(AriaRole\.Heading, new\(\) \{ Name = "Kart A" \}\)/);
  assert.match(result.csharp, /GetByRole\(AriaRole\.Button, new\(\) \{ Name = "Detaylar"/);
  assert.equal(result.note, "");
  assert.doesNotMatch(result.csharp, /\.Nth\(|body >|css-b01ezj/);
  only(picker.queryAll(injected, result.inner, document), clicked);
});

test("duplicate buttons follow the Playwright listitem filter example", () => {
  const { document, injected } = dom(`
    <ul>
      <li><h3>Product 1</h3><button>Add to cart</button></li>
      <li><h3>Product 2</h3><button>Add to cart</button></li>
    </ul>
  `);
  const button = document.querySelectorAll("button")[1];
  const result = picker.describe(injected, button, "");
  assert.equal(
    result.csharp,
    'page.GetByRole(AriaRole.Listitem).Filter(new() { Has = page.GetByRole(AriaRole.Heading, new() { Name = "Product 2" }) }).GetByRole(AriaRole.Button, new() { Name = "Add to cart" })'
  );
  assert.equal(result.note, "");
  assert.doesNotMatch(result.csharp, /\.Nth\(|Exact = true/);
  only(picker.queryAll(injected, result.inner, document), button);
});

function decodeCSharpString(literal) {
  assert.equal(literal[0], '"');
  assert.equal(literal[literal.length - 1], '"');
  const body = literal.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const next = body[++i];
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "\\") out += "\\";
    else if (next === '"') out += '"';
    else if (next === "u") {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
      i += 4;
    } else out += next;
  }
  return out;
}

function accessibleOrText(injected, element) {
  return injected.utils.normalizeWhiteSpace(injected.utils.getElementAccessibleNameText(element, false) || "");
}
