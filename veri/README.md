# veri/ — yarış sonuçları buraya

Bu klasöre eklenen her dosya, GitHub'a gönderildiğinde otomatik olarak `data/sonuclar.json` dosyasına derlenir.
Uygulama açılışta bu dosyayı çeker; elle bir şey yapmak gerekmez.

| Dosya | İçerik |
|---|---|
| `*.lxf` | Lenex (Splash Meet Manager vb. zamanlama yazılımının “Lenex dışa aktar” çıktısı) |
| `*.lef`, `*.xml` | Sıkıştırılmamış Lenex |
| `*.csv` | `yaris;tarih;sehir;havuz;ad;soyad;dogum_yili;cinsiyet;kulup;brans;derece` |
| `rekorlar.csv` | `kapsam;havuz;cinsiyet;brans;derece;sahibi;kulup;tarih` (kapsam: TR veya WR) |

Kurallar:
- Aynı sporcu ad + soyad + doğum yılı + cinsiyet ile tanınır; farklı dosyalardaki dereceleri birleşir.
- Aynı yarışta aynı branşta birden fazla derece varsa (seri + final) en iyisi alınır.
- Diskalifiye, yüzmedi, bayrak yarışı ve uygulamada olmayan branşlar (ör. 25 m) alınmaz.
- Dosyayı silmek, o yarışın sonuçlarını uygulamadan kaldırır.

Yerelde denemek için: `node tools/veri-derle.mjs`
