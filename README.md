# SelectorsBang

Chrome ve Edge (Manifest V3) eklentisi. Araç çubuğu düğmesi tarayıcının sağında kalan bir panel açar. Seçim modundayken sayfadaki bir öğeye tıklayınca, Playwright’ın kendi seçici üretecinden (`playwright codegen` ile aynı injected script) o öğeyi tek başına bulan bir Playwright .NET ifadesi kopyalanır.

## Chrome’a yükleme

1. `chrome://extensions` adresini açın.
2. **Geliştirici modu**nu (Developer mode) açın.
3. **Paketlenmemiş öğe yükle** (Load unpacked) ile bu klasörü seçin.
4. Eklentiyi araç çubuğuna sabitleyin.

## Edge’e yükleme

1. `edge://extensions` adresini açın.
2. **Geliştirici modu**nu (Developer mode) açın.
3. **Paketlenmemiş yükle** (Load unpacked) ile bu klasörü seçin.
4. Eklentiyi araç çubuğuna sabitleyin.

Yerel `file://` sayfalarında denemek için eklenti ayrıntılarından dosya adreslerine erişime izin verin.

## Kullanım

Eklentiyi yeni yüklediyseniz veya güncellediyseniz `chrome://extensions` ya da `edge://extensions` sayfasında **Yeniden yükle** (Reload) düğmesine basın, sonra araç çubuğu düğmesine tıklayın.

- Araç çubuğu düğmesi **SelectorsBang** panelini tarayıcının sağına açar. Panel sayfaya tıklanınca kapanmaz. Seçim modu **Açık** veya **Kapalı** yazar.
- Kapalıyken **Seçim modunu aç** düğmesine basın. Araç çubuğu rozeti **AÇIK** olur.
- Öğenin üzerine gelince vurgulanır. Tıklama öğeyi çalıştırmaz ve sayfayı değiştirmez.
- İfade sayfadaki kartta ve sağ panelde görünür. **Kopyala** panoya yazar; düğme ancak pano kabul ederse **Kopyalandı** olur. Olmazsa metin seçili kalır.
- **Seçim modunu kapat** veya **Esc** seçim modunu kapatır. Rozet silinir.

İfade, [Playwright .NET seçici dokümanındaki](https://playwright.dev/dotnet/docs/locators) sıraya uyar: adlı `GetByRole`, `GetByLabel`, `GetByPlaceholder`, `GetByAltText`, `GetByTitle`, `GetByTestId`, `GetByText`, kararlı id, sonra kararlı sınıf veya `value`. `.Nth`, `.First` ve `.Last` kullanılmaz. Aynı ad birden fazla düğmedeyse dokümandaki gibi önce adlı bir bölümden `GetByRole` zinciri, yoksa `Filter(new() { Has = page.GetByRole(...) })` kurulur. `:r1:` gibi üretilmiş id’ler ve `css-` ile başlayan sınıflar alınmaz. CSS ve XPath ancak rol, etiket veya metin yoksa, kısa tutulur. Seçiciyi `value` ayırıyorsa panelde belirtilir. Öğe bir iframe içindeyse `FrameLocator` kullanılır.

Örnek:

```csharp
page.GetByRole(AriaRole.Button, new() { Name = "Kaydet" })
```

Çerçeve içindeki bir düğme:

```csharp
page.FrameLocator("iframe[name=\"odeme\"]").GetByRole(AriaRole.Button, new() { Name = "Kaydet" })
```

## Test

Dönüştürücü ve “yalnızca bu öğe” kontrolü:

```bash
npm install jsdom@25
node --test test/locator.test.js
```
