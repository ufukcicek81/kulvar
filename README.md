<p align="center"><img src="icons/logo.svg" alt="Kulvar" width="360"></p>

# Kulvar v1.2.0 — Yüzücü Takip

Yüzme yarış sonuçları, sporcu gelişim analizi, karşılaştırma, sıralamalar ve rekorlar. Telefonda, tablette ve bilgisayarda çalışır; internet gerekmez. PWA olarak kurulabilir, Android için APK'sı vardır. Tüm özellikler ücretsizdir.

## Kurulum
**Android (APK):** `apk/Kulvar-1.2.0.apk` dosyasını telefona indirip açın; “bilinmeyen kaynaklar” izni isterse verin. Android 7.0+ gerekir.

**PWA:** Repo ayarlarında Settings → Pages → Source: **GitHub Actions** seçildiğinde site `https://ufukcicek81.github.io/kulvar/` adresinde yayınlanır, sayfayı telefonda açıp “Ana ekrana ekle” deyin. Yerelde denemek için: `python3 -m http.server` → `http://localhost:8000`.

## Ekranlar
| Ekran | Açıklama |
|---|---|
| Ana sayfa | Haber slaytı, bildirim uyarısı, “Popüler Menüler” (ızgara / liste görünümü), takip edilen sporcular |
| Güncel Sonuçlar | Son yarışın her branşta ilk üçü |
| Tüm Yarışlar | Sezon ve metin filtresi; yarış → branş → erkek/kadın, yaş grubu filtresiyle sonuç listesi |
| Sporcu | Kişisel rekorlar (50/25 m), puanlar, kürsü sayıları, yarış geçmişi, takip et, paylaş |
| Sporcu Analiz | Derece gelişim grafiği, gelişim yüzdesi, doğum yılı içindeki sıralama |
| Karşılaştırma | İki sporcunun branş branş rekorları ve aynı yarıştaki karşılaşmaları |
| En İyi 100 | Branş, havuz, cinsiyet, doğum yılı ve sezona göre |
| Zirvedekiler | Her branşta ilk üç |
| Türkiye / Dünya Rekorları | Düzenlenebilir rekor listeleri |
| Ara | Sporcu, kulüp, yarış (Türkçe karakter duyarsız) |
| Haberler, Bildirimler, Profil | Bildirim izni, takip edilenler, veri yönetimi |

## Otomatik veri
```
veri/*.lxf, *.csv  ──(GitHub Actions: tools/veri-derle.mjs)──►  data/sonuclar.json  ──►  uygulama açılışta çeker
```
1. Federasyondan / kulüpten gelen Lenex (`.lxf`) veya CSV dosyasını `veri/` klasörüne koyup `main` dalına gönderin (GitHub web arayüzünden “Add file → Upload files” yeterli).
2. `.github/workflows/veri.yml` dosyaları derler, `data/sonuclar.json`'u günceller ve siteyi GitHub Pages'e yayınlar.
3. Uygulama her açılışta (ve 10 dakikadan uzun arka planda kaldıktan sonra) dosyayı `raw.githubusercontent.com` üzerinden çeker. İnternet yoksa son indirilen veri kullanılır.
4. Takip edilen sporcuya yeni derece gelirse bildirim gösterilir.

Sunucuda henüz sonuç yokken **kurgusal demo verisi** gösterilir; ilk gerçek veri geldiğinde demo veri kendiliğinden kalkar. Elle eklenen kayıtlar korunur. Ayrıntılar: [veri/README.md](veri/README.md). Veri paylaşım talebi için e-posta taslağı: [docs/veri-paylasim-maili.md](docs/veri-paylasim-maili.md).

## Veri ayrıntıları
- Sporcu kimliği ad + soyad + doğum yılı + cinsiyetten üretilir; T.C. kimlik, lisans no ve tam doğum tarihi saklanmaz.
- **Dünya rekorları örnek olarak** eklenmiştir; resmi World Aquatics listesinden doğrulanmalıdır. **Türkiye rekorları boş** gelir; federasyon listesinden eklenmelidir.
- **Puan:** `1000 × (taban / derece)³`; taban = 50 m dünya rekoru (25 m havuzda %2,5 daha hızlı).
- **CSV içe aktarma** (`,` veya `;` ayraçlı, başlık satırı zorunlu):
  ```
  yaris;tarih;sehir;havuz;ad;soyad;dogum_yili;cinsiyet;kulup;brans;derece
  Kış Kupası;24.01.2026;İstanbul;25;Elif;Kaya;2012;K;Mavi Dalga SK;100 Serbest;1:02,45
  ```
  Branş “100SER”, “100 Serbest”, “100m Sırtüstü” biçimlerinde yazılabilir. Aynı sporcu + yarış + branş tekrar eklenmez.
- **Yedek:** Profil → Yedek al / Yedekten geri yükle (JSON).

## Bildirimler
Takip edilen sporcuya yeni derece geldiğinde (otomatik veri, elle giriş ya da CSV) uygulama içi bildirim oluşur; izin verildiyse telefon bildirimi de gösterilir (PWA'da service worker, APK'da yerel Android bildirimi). Kişisel rekor ayrıca belirtilir.
Not: Bildirim, uygulama açıldığında yapılan veri kontrolünde oluşur; uygulama hiç açılmazken gelen anlık (push) bildirim için ayrı bir sunucu gerekir.

## Dosyalar
```
index.html, styles.css, app.js   arayüz ve tüm ekranlar
data.js                          sabitler, örnek dünya rekorları, demo veri üreteci
sw.js, manifest.webmanifest      PWA (çevrimdışı önbellek, bildirim tıklaması)
veri/                            ham sonuç dosyaları (Lenex / CSV)
data/sonuclar.json               derlenmiş veri (otomatik üretilir, elle düzenlemeyin)
tools/veri-derle.mjs             Lenex/CSV → JSON derleyici (bağımlılıksız Node)
.github/workflows/veri.yml       derle + GitHub Pages yayını
docs/                            veri paylaşım e-postası
icons/                           logo ve uygulama simgeleri
android/                         WebView kabuğu (MainActivity), kaynaklar, derleme betiği
apk/Kulvar-1.2.0.apk             imzalı APK
```

## APK derleme
Gradle / Android Studio gerekmez; ayrıntılar `android/build-apk.sh` başında:
```
TOOLS=/araçlar/klasörü ./android/build-apk.sh
```
APK `android/kulvar.p12` anahtarıyla imzalanır. Güncellemelerin eski sürümün üzerine kurulabilmesi için bu dosya korunmalıdır.
