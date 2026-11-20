# Gazete İlk Sayfalar + Keşanspor

Edirne ve ulusal gazetelerin ilk sayfaları (yakınlaştırmalı görüntüleyici) ve Keşanspor'un
fikstürü, skorları, puan durumu ve haberleri — tek sayfalık web uygulaması.

- `web/` — site (GitHub Pages'te yayınlanır). Veriyi `web/data/latest.json` dosyasından okur.
- `scripts/update.mjs` — BİK, TFF ve Bing Haberler'den veriyi toplar; sitedeki ayrıştırıcıların aynısını kullanır.
- `.github/workflows/guncelle.yml` — günde 4 kez (TR 07:30, 10:30, 16:30, 22:30) veriyi günceller ve siteyi yayınlar.
- `app/` — Android (Capacitor) sürümü, ileride APK için.

Gazete görselleri depoya indirilmez; yalnızca BİK'teki adresleri kaydedilir ve ziyaretçinin tarayıcısı
görseli doğrudan BİK'ten yükler.

## Kurulum (bir kez)
Settings → Pages → Source: **GitHub Actions**. Sonra Actions → "Verileri güncelle
ve yayınla" → Run workflow.
