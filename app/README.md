# Gazete İlk Sayfalar

BİK (gazete.bik.gov.tr) üzerindeki **Edirne** ve **Ulusal** (yaygın) gazetelerin ilk sayfalarını listeler.
**Keşanspor** sekmesinde haberler, fikstür, önceki/sonraki skorlar ve puan durumu uygulama içinde gösterilir.
Bir gazeteye dokununca ilk sayfası tam ekran açılır; **+ / − / ⤢** tuşları, iki parmak, fare tekerleği
ve çift dokunma ile büyütülüp küçültülebilir.

## Web olarak denemek
```bash
npm run serve   # http://localhost:8080
```
Tarayıcıda BİK sitesi CORS yüzünden okunamaz; "Örnek veriyle dene" ile arayüzü test edebilirsin.
APK içinde `CapacitorHttp` açık olduğu için gerçek veri gelir.

## APK oluşturma
Gerekenler: Node 18+, Android Studio (Android SDK + JDK 17).
```bash
npm install
npm run android:add      # ilk seferde bir kez
npm run apk              # android/app/build/outputs/apk/debug/app-debug.apk
```
Ya da `npm run android:open` ile Android Studio'da açıp **Build > Build APK(s)**.

## Kaynakları değiştirmek
`www/index.html` içindeki `KAYNAKLAR` dizisini düzenle (sekme adı + BİK adresi).

## Keşanspor sekmesi
- **Fikstür / skorlar / puan durumu:** TFF Profesyonelliğe Geçiş Ligi sayfasından (`kesan.js` → `KESAN_AYAR`) canlı çekilir,
  15 dk önbelleklenir. Keşan Spor'un TFF kulüp no'su `11183`. Grup değişirse (yeni sezon) uygulama tüm grupları tarayıp kendini bulur.
  Yeni sezonda TFF lig sayfasının `pageID`'si değişirse yalnızca `tffLig` adresini güncelle.
- **Haberler:** Bing Haberler RSS'ten "Keşanspor" araması; habere dokununca metin uygulama içi okuyucuda açılır.
