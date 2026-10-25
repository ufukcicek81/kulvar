/* Kulvar — sabitler, örnek rekorlar ve demo veri üreteci. */
(function () {
  'use strict';

  const STYLES = {
    SER: 'Serbest', SRT: 'Sırtüstü', KUR: 'Kurbağalama', KEL: 'Kelebek', KAR: 'Karışık'
  };

  // Branşlar: kod = mesafe + stil
  const EVENTS = [
    '50SER', '100SER', '200SER', '400SER', '800SER', '1500SER',
    '50SRT', '100SRT', '200SRT',
    '50KUR', '100KUR', '200KUR',
    '50KEL', '100KEL', '200KEL',
    '100KAR', '200KAR', '400KAR'
  ];

  function eventName(code) {
    const m = /^(\d+)([A-Z]+)$/.exec(code);
    return m ? m[1] + 'm ' + STYLES[m[2]] : code;
  }

  // Zaman: salise (1/100 sn) cinsinden tam sayı
  function t(str) {
    const p = str.split(':');
    const sec = p.length === 2 ? Number(p[0]) * 60 + Number(p[1]) : Number(p[0]);
    return Math.round(sec * 100);
  }

  // Örnek dünya rekorları (50 m havuz). Resmi World Aquatics listesinden doğrulanmalıdır;
  // uygulama içinden düzenlenebilir.
  const WORLD_RECORDS_LC = [
    ['E', '50SER', '20.91', 'César Cielo', 'BRA', '2009-12-18'],
    ['E', '100SER', '46.40', 'Pan Zhanle', 'CHN', '2024-07-31'],
    ['E', '200SER', '1:42.00', 'Paul Biedermann', 'GER', '2009-07-28'],
    ['E', '400SER', '3:39.96', 'Lukas Märtens', 'GER', '2025-04-12'],
    ['E', '800SER', '7:32.12', 'Zhang Lin', 'CHN', '2009-07-29'],
    ['E', '1500SER', '14:30.67', 'Ahmed Hafnaoui', 'TUN', '2023-07-30'],
    ['E', '50SRT', '23.55', 'Kliment Kolesnikov', 'RUS', '2023-07-27'],
    ['E', '100SRT', '51.60', 'Thomas Ceccon', 'ITA', '2022-06-20'],
    ['E', '200SRT', '1:51.92', 'Aaron Peirsol', 'USA', '2009-07-31'],
    ['E', '50KUR', '25.95', 'Adam Peaty', 'GBR', '2017-07-25'],
    ['E', '100KUR', '56.88', 'Adam Peaty', 'GBR', '2019-07-21'],
    ['E', '200KUR', '2:05.48', 'Qin Haiyang', 'CHN', '2023-07-28'],
    ['E', '50KEL', '22.27', 'Andriy Govorov', 'UKR', '2018-07-01'],
    ['E', '100KEL', '49.45', 'Caeleb Dressel', 'USA', '2021-07-31'],
    ['E', '200KEL', '1:50.34', 'Kristóf Milák', 'HUN', '2022-06-21'],
    ['E', '200KAR', '1:52.69', 'Léon Marchand', 'FRA', '2025-07-31'],
    ['E', '400KAR', '4:02.50', 'Léon Marchand', 'FRA', '2023-07-23'],
    ['K', '50SER', '23.61', 'Sarah Sjöström', 'SWE', '2023-07-29'],
    ['K', '100SER', '51.71', 'Sarah Sjöström', 'SWE', '2017-07-23'],
    ['K', '200SER', '1:52.23', 'Ariarne Titmus', 'AUS', '2024-06-12'],
    ['K', '400SER', '3:54.18', 'Summer McIntosh', 'CAN', '2025-06-07'],
    ['K', '800SER', '8:04.12', 'Katie Ledecky', 'USA', '2025-05-03'],
    ['K', '1500SER', '15:20.48', 'Katie Ledecky', 'USA', '2018-05-16'],
    ['K', '50SRT', '26.86', 'Kaylee McKeown', 'AUS', '2023-10-20'],
    ['K', '100SRT', '57.13', 'Regan Smith', 'USA', '2024-06-18'],
    ['K', '200SRT', '2:03.14', 'Kaylee McKeown', 'AUS', '2023-03-10'],
    ['K', '50KUR', '29.16', 'Rūta Meilutytė', 'LTU', '2023-07-31'],
    ['K', '100KUR', '1:04.13', 'Lilly King', 'USA', '2017-07-25'],
    ['K', '200KUR', '2:17.55', 'Evgeniia Chikunova', 'RUS', '2023-04-21'],
    ['K', '50KEL', '24.43', 'Sarah Sjöström', 'SWE', '2014-07-05'],
    ['K', '100KEL', '54.60', 'Gretchen Walsh', 'USA', '2025-06-03'],
    ['K', '200KEL', '2:01.81', 'Liu Zige', 'CHN', '2009-10-21'],
    ['K', '200KAR', '2:05.70', 'Summer McIntosh', 'CAN', '2025-06-12'],
    ['K', '400KAR', '4:23.65', 'Summer McIntosh', 'CAN', '2025-06-10']
  ].map(function (r, i) {
    return { id: 'wr' + i, scope: 'WR', gender: r[0], event: r[1], pool: 50, time: t(r[2]), holder: r[3], team: r[4], date: r[5], src: 'demo' };
  });

  // Puan hesabı için taban süreler (dünya rekoru temelli). 25 m havuzda yaklaşık %2,5 daha hızlı.
  function baseTime(gender, event, pool) {
    const wr = WORLD_RECORDS_LC.find(function (r) { return r.gender === gender && r.event === event; });
    let base = wr ? wr.time : null;
    if (!base && event === '100KAR') {
      const b = baseTime(gender, '200KAR', 50);
      base = b ? Math.round(b * 0.46) : null;
    }
    if (!base) return null;
    return pool === 25 ? Math.round(base * 0.975) : base;
  }

  // ---- Demo veri üreteci (deterministik) ----
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
      x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }

  const FIRST_E = ['Arda', 'Kerem', 'Emir', 'Yusuf', 'Ege', 'Deniz', 'Mert', 'Kaan', 'Alp', 'Efe', 'Can', 'Berk', 'Batu', 'Onur', 'Doruk', 'Atlas', 'Umut', 'Burak', 'Eren', 'Tuna'];
  const FIRST_K = ['Elif', 'Zeynep', 'Defne', 'Ecrin', 'Ada', 'Nehir', 'Duru', 'Ela', 'Lina', 'Asya', 'Derin', 'Mira', 'Selin', 'İpek', 'Ceren', 'Naz', 'Yağmur', 'Melis', 'Su', 'Beren'];
  const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özdemir', 'Erdem', 'Polat', 'Aksoy', 'Tekin', 'Uçar', 'Güneş', 'Bulut', 'Akın'];

  const CLUBS = [
    ['Mavi Dalga SK', 'İstanbul'], ['Ege Kulvar SK', 'İzmir'], ['Başkent Yüzme', 'Ankara'],
    ['Akdeniz Su Sporları', 'Antalya'], ['Uludağ Yüzme', 'Bursa'], ['Karadeniz Kulaç', 'Trabzon'],
    ['Çukurova Yüzme', 'Adana'], ['Anadolu Dalış ve Yüzme', 'Eskişehir']
  ];

  const MEETS = [
    ['Kış Kupası', 'İstanbul', '2025-01-18', 25],
    ['İl Yaş Grupları Şampiyonası', 'Ankara', '2025-03-08', 50],
    ['Bahar Kupası', 'İzmir', '2025-04-26', 50],
    ['Yaz Ulusal Yaş Grupları', 'Antalya', '2025-07-12', 50],
    ['Sonbahar Kısa Kulvar Yarışları', 'Bursa', '2025-10-18', 25],
    ['Yılbaşı Sprint Kupası', 'Eskişehir', '2025-12-20', 25],
    ['Kış Kupası', 'İstanbul', '2026-01-24', 25],
    ['Bahar Kupası', 'İzmir', '2026-04-18', 50],
    ['Yaz Ulusal Yaş Grupları', 'Antalya', '2026-07-11', 50],
    ['Sonbahar Kısa Kulvar Yarışları', 'Bursa', '2026-10-10', 25]
  ];

  // Uzmanlık grupları
  const GROUPS = [
    ['50SER', '100SER', '50KEL', '100KEL'],
    ['100SER', '200SER', '400SER', '200KAR'],
    ['400SER', '800SER', '1500SER', '200SER'],
    ['50SRT', '100SRT', '200SRT', '100SER'],
    ['50KUR', '100KUR', '200KUR', '200KAR'],
    ['100KEL', '200KEL', '200SER', '400KAR'],
    ['100KAR', '200KAR', '400KAR', '200KUR'],
    ['50SER', '100SER', '200SER', '50SRT']
  ];

  function ageFactor(age) {
    if (age <= 9) return 1.55;
    if (age >= 19) return 1.0;
    const table = { 10: 1.46, 11: 1.37, 12: 1.29, 13: 1.21, 14: 1.15, 15: 1.10, 16: 1.07, 17: 1.04, 18: 1.02 };
    return table[age];
  }

  function generateDemo() {
    const r = rng(20251025);
    const pick = function (a) { return a[Math.floor(r() * a.length)]; };
    const clubs = CLUBS.map(function (c, i) { return { id: 'c' + (i + 1), name: c[0], city: c[1], src: 'demo' }; });
    const swimmers = [];
    const used = {};
    for (let i = 0; i < 72; i++) {
      const gender = i % 2 ? 'K' : 'E';
      let first, last, key;
      do {
        first = pick(gender === 'E' ? FIRST_E : FIRST_K);
        last = pick(LAST);
        key = first + last;
      } while (used[key]);
      used[key] = 1;
      swimmers.push({
        id: 's' + (i + 1), first: first, last: last, gender: gender,
        birthYear: 2006 + Math.floor(r() * 10),
        clubId: clubs[Math.floor(r() * clubs.length)].id,
        src: 'demo',
        _talent: 1.06 + r() * 0.16,
        _group: GROUPS[Math.floor(r() * GROUPS.length)]
      });
    }
    const meets = MEETS.map(function (m, i) {
      return { id: 'm' + (i + 1), name: m[2].slice(0, 4) + ' ' + m[0], city: m[1], date: m[2], pool: m[3], src: 'demo' };
    });
    const results = [];
    let n = 0;
    meets.forEach(function (meet, mi) {
      const year = Number(meet.date.slice(0, 4));
      swimmers.forEach(function (s) {
        if (r() < 0.25) return; // her yarışa katılmaz
        const age = year - s.birthYear;
        s._group.forEach(function (ev, gi) {
          if (gi === 3 && r() < 0.5) return;
          const base = baseTime(s.gender, ev, meet.pool);
          if (!base) return;
          const slow = gi === 0 ? 1 : 1 + gi * 0.012;
          const noise = 1 + (r() - 0.45) * 0.025;
          const progress = 1 - mi * 0.003;
          const time = Math.round(base * s._talent * ageFactor(age) * slow * noise * progress);
          results.push({ id: 'r' + (++n), meetId: meet.id, swimmerId: s.id, event: ev, time: time, src: 'demo' });
        });
      });
    });
    swimmers.forEach(function (s) { delete s._talent; delete s._group; });

    const news = [
      { id: 'n1', date: '2026-10-20', theme: 'sea', title: 'Kulvar\'a hoş geldiniz: Sonuçlar, analiz ve sıralamalar tek uygulamada',
        body: 'Kulvar ile yarış sonuçlarını takip edebilir, sporcu gelişimini grafikle izleyebilir, iki sporcuyu karşılaştırabilir ve en iyi 100 listelerine bakabilirsiniz. Tüm özellikler ücretsizdir.\n\nSonuçlar uygulama açıldığında sunucudan otomatik olarak güncellenir. Sunucuda henüz resmi veri yokken örnek (demo) sporcular ve yarışlar gösterilir; gerçek veri geldiğinde demo veri kendiliğinden kalkar.' },
      { id: 'n2', date: '2026-10-18', theme: 'pool', title: 'Sporcu takip edin, yeni derecesi girildiğinde bildirim alın',
        body: 'Sporcu sayfasındaki yıldız düğmesiyle sporcuyu takibe alın. Takip ettiğiniz bir sporcunun yeni sonucu eklendiğinde uygulama içi bildirim ve (izin verdiyseniz) telefon bildirimi alırsınız.\n\nKişisel rekor kırılırsa bildirimde ayrıca belirtilir.' },
      { id: 'n3', date: '2026-10-15', theme: 'sunset', title: 'Puan sistemi nasıl hesaplanıyor?',
        body: 'Her derece için dünya rekoruna göre bir performans puanı hesaplanır: puan = 1000 × (taban süre / derece)³. Taban süre olarak 50 m havuzda dünya rekoru, 25 m havuzda bunun yaklaşık %2,5 daha hızlısı kullanılır.\n\nBöylece farklı branşlardaki dereceler birbiriyle kıyaslanabilir.' },
      { id: 'n4', date: '2026-10-10', theme: 'lane', title: 'CSV ile toplu sonuç aktarma',
        body: 'Profil → Veri Yönetimi → CSV içe aktar ile bir yarışın tüm sonuçlarını tek seferde ekleyebilirsiniz. Sütunlar: yaris, tarih, sehir, havuz, ad, soyad, dogum_yili, cinsiyet, kulup, brans, derece.\n\nÖrnek satır: Kış Kupası,2026-01-24,İstanbul,25,Elif,Kaya,2012,K,Mavi Dalga SK,100SER,1:02.45' },
      { id: 'n5', date: '2026-10-05', theme: 'night', title: 'Rekor listeleri düzenlenebilir',
        body: 'Dünya ve Türkiye rekorları ekranlarında rekor ekleyebilir, düzenleyebilir veya silebilirsiniz. Dünya rekorları örnek olarak eklenmiştir; resmi listeden kontrol edip güncellemeniz önerilir.' }
    ];

    return { version: 2, clubs: clubs, swimmers: swimmers, meets: meets, results: results, records: WORLD_RECORDS_LC.slice(), news: news };
  }

  // Otomatik veri kaynağı: GitHub'daki veri/ klasöründen derlenen dosya. İlk adres erişilemezse
  // uygulamayla birlikte gelen kopya kullanılır.
  const REMOTE_URLS = [
    'https://raw.githubusercontent.com/ufukcicek81/kulvar/main/data/sonuclar.json',
    'data/sonuclar.json'
  ];

  window.KulvarData = {
    REMOTE_URLS: REMOTE_URLS, STYLES: STYLES, EVENTS: EVENTS, eventName: eventName, parseTime: t, baseTime: baseTime, generateDemo: generateDemo
  };
})();
