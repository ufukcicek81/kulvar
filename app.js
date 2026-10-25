/* Kulvar — yüzücü takip uygulaması (PWA + Android kabuğu). */
(function () {
  'use strict';

  const D = window.KulvarData;
  const DB_KEY = 'kulvar.db.v1';
  const USER_KEY = 'kulvar.user.v1';
  const android = window.KulvarAndroid || null;

  // ---------- Depolama ----------
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('Kayıt başarısız: depolama dolu olabilir'); }
  }

  let db = load(DB_KEY);
  if (!db || !db.swimmers) { db = D.generateDemo(); save(DB_KEY, db); }
  if (db.version === 1) migrateV1(db);
  const user = Object.assign({ follows: [], notifications: [], bannerDismissed: false, seq: 0, sync: {} }, load(USER_KEY) || {});

  // v1 kayıtlarında kaynak alanı yoktu: demo kayıtlarını kimlik biçiminden tanı
  function migrateV1(d) {
    const mark = function (list, re) { list.forEach(function (x) { if (x.demo || re.test(x.id)) x.src = 'demo'; delete x.demo; }); };
    mark(d.clubs, /^c\d$/); mark(d.swimmers, /^s\d+$/); mark(d.meets, /^m\d+$/); mark(d.results, /^r\d+$/); mark(d.records || [], /^wr\d+$/);
    d.version = 2;
    save(DB_KEY, d);
  }

  function saveDb() { save(DB_KEY, db); reindex(); }
  function saveUser() { save(USER_KEY, user); updateBell(); }
  function uid(prefix) { user.seq = (user.seq || 0) + 1; return prefix + Date.now().toString(36) + user.seq; }

  // ---------- İndeksler ----------
  let idx = {};
  function reindex() {
    idx = { swimmer: {}, club: {}, meet: {}, bySwimmer: {}, byMeet: {} };
    db.swimmers.forEach(function (s) { idx.swimmer[s.id] = s; idx.bySwimmer[s.id] = []; });
    db.clubs.forEach(function (c) { idx.club[c.id] = c; });
    db.meets.forEach(function (m) { idx.meet[m.id] = m; idx.byMeet[m.id] = []; });
    const groups = {};
    db.results.forEach(function (r) {
      const s = idx.swimmer[r.swimmerId], m = idx.meet[r.meetId];
      if (!s || !m) return;
      idx.bySwimmer[s.id].push(r);
      idx.byMeet[m.id].push(r);
      const k = r.meetId + '|' + r.event + '|' + s.gender;
      (groups[k] = groups[k] || []).push(r);
    });
    Object.keys(groups).forEach(function (k) {
      groups[k].sort(function (a, b) { return a.time - b.time; });
      groups[k].forEach(function (r, i) { r._place = i + 1; });
    });
  }
  reindex();

  // ---------- Yardımcılar ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(cs) {
    if (cs == null) return '—';
    const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
    const cc = String(c).padStart(2, '0');
    return m ? m + ':' + String(s).padStart(2, '0') + '.' + cc : s + '.' + cc;
  }
  function parseTimeInput(str) {
    const v = String(str || '').trim().replace(',', '.');
    if (!/^(\d{1,2}:)?\d{1,2}(\.\d{1,2})?$/.test(v)) return null;
    const p = v.split(':');
    const secPart = p[p.length - 1];
    const sp = secPart.split('.');
    const cents = sp[1] ? Number(sp[1].padEnd(2, '0')) : 0;
    const sec = Number(sp[0]) + (p.length === 2 ? Number(p[0]) * 60 : 0);
    if (p.length === 2 && Number(sp[0]) >= 60) return null;
    const total = sec * 100 + cents;
    return total > 0 ? total : null;
  }
  const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  function fdate(iso) {
    if (!iso) return '';
    const p = iso.split('-');
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }
  function norm(s) {
    return String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  }
  function name(s) { return s ? s.first + ' ' + s.last : '?'; }
  function clubName(id) { return idx.club[id] ? idx.club[id].name : 'Ferdi'; }
  function genderLabel(g) { return g === 'K' ? 'Kadın' : 'Erkek'; }
  function points(r) {
    const s = idx.swimmer[r.swimmerId], m = idx.meet[r.meetId];
    const base = s && m ? D.baseTime(s.gender, r.event, m.pool) : null;
    return base ? Math.round(1000 * Math.pow(base / r.time, 3)) : null;
  }
  function byDate(a, b) { return idx.meet[a.meetId].date < idx.meet[b.meetId].date ? -1 : 1; }
  function sortedMeets() { return db.meets.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
  function sortedSwimmers() {
    return db.swimmers.slice().sort(function (a, b) { return name(a).localeCompare(name(b), 'tr'); });
  }
  function personalBests(swimmerId) {
    const best = {};
    (idx.bySwimmer[swimmerId] || []).forEach(function (r) {
      const k = r.event + '|' + idx.meet[r.meetId].pool;
      if (!best[k] || r.time < best[k].time) best[k] = r;
    });
    return best;
  }
  function eventOrder(a, b) { return D.EVENTS.indexOf(a) - D.EVENTS.indexOf(b); }
  function medal(place) {
    return place <= 3 ? '<span class="medal m' + place + '">' + place + '</span>' : '<span class="place">' + place + '</span>';
  }
  function options(list, selected) {
    return list.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(selected) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function eventOptions(selected, list) {
    return options((list || D.EVENTS).map(function (e) { return [e, D.eventName(e)]; }), selected);
  }
  function swimmerOptions(selected, blank) {
    const list = sortedSwimmers().map(function (s) { return [s.id, name(s) + ' (' + s.birthYear + ')']; });
    if (blank) list.unshift(['', blank]);
    return options(list, selected);
  }
  function qs() {
    const q = {};
    const i = location.hash.indexOf('?');
    if (i >= 0) new URLSearchParams(location.hash.slice(i + 1)).forEach(function (v, k) { q[k] = v; });
    return q;
  }
  function setQs(params) {
    const base = location.hash.split('?')[0] || '#/';
    const cur = qs();
    Object.keys(params).forEach(function (k) { cur[k] = params[k]; });
    history.replaceState(null, '', base + '?' + new URLSearchParams(cur).toString());
    render();
  }
  function seasons() {
    const ys = {};
    db.meets.forEach(function (m) { ys[m.date.slice(0, 4)] = 1; });
    return Object.keys(ys).sort().reverse();
  }

  // ---------- Simgeler ----------
  const ICON = {
    trophy: '<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M9 17h6"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h13l-2 4 2 4H5"/><path d="M9 4v8M13 4v8M5 8h13"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="M7 16l4-6 3 3 5-7"/></svg>',
    scale: '<svg viewBox="0 0 24 24"><path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/></svg>',
    bars: '<svg viewBox="0 0 24 24"><path d="M5 20v-3M9.5 20v-6M14 20v-9M18.5 20V5"/></svg>',
    flagTr: '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 5c4-2 7 2 14 0v9c-7 2-10-2-14 0"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/></svg>'
  };

  const MENUS = [
    { key: 'latest', label: 'Güncel Sonuçlar', icon: 'trophy', color: 'blue', href: '#/latest' },
    { key: 'meets', label: 'Tüm Yarışlar', icon: 'flag', color: 'orange', href: '#/meets' },
    { key: 'analysis', label: 'Sporcu Analiz', icon: 'chart', color: 'blue2', href: '#/analysis' },
    { key: 'compare', label: 'Karşılaştırma', icon: 'scale', color: 'orange2', href: '#/compare' },
    { key: 'top100', label: 'En İyi 100', icon: 'star', color: 'blue2', href: '#/top100' },
    { key: 'leaders', label: 'Zirvedekiler', icon: 'bars', color: 'orange2', href: '#/leaders' },
    { key: 'tr', label: 'Türkiye Rekorları', icon: 'flagTr', color: 'blue', href: '#/records/TR' },
    { key: 'wr', label: 'Dünya Rekorları', icon: 'globe', color: 'orange', href: '#/records/WR' }
  ];

  // ---------- Görünümler ----------
  const V = {};

  V.home = function () {
    const news = db.news.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 10);
    const showBanner = !user.bannerDismissed && notifPermission() !== 'granted' && notifPermission() !== 'unsupported';
    const listMode = user.menuList;
    let html = '';
    if (showBanner) {
      html += '<div class="notif-banner"><button class="nb-main" data-action="enable-notif">' + ICON.bell +
        '<span>Bildirim ayarlarınızı kontrol edin</span>' + ICON.chev + '</button>' +
        '<button class="nb-close" data-action="dismiss-banner" aria-label="Kapat">' + ICON.close + '</button></div>';
    }
    html += '<div class="carousel" id="carousel">' + news.map(function (n) {
      return '<a class="slide theme-' + esc(n.theme) + '" href="#/news/' + esc(n.id) + '"><div class="slide-art"></div>' +
        '<div class="slide-cap"><i></i><h2>' + esc(n.title) + '</h2></div></a>';
    }).join('') + '</div><div class="dots" id="dots">' + news.map(function (n, i) {
      return '<button aria-label="Haber ' + (i + 1) + '"' + (i === 0 ? ' class="on"' : '') + ' data-dot="' + i + '"></button>';
    }).join('') + '</div>';

    if (!hasRemoteData()) html += '<p class="note">Sunucuda henüz resmi sonuç yok; örnek (demo) veriler gösteriliyor. Gerçek sonuçlar eklendiğinde otomatik gelir.</p>';
    html += '<div class="section-head"><span class="crown-badge">' + ICON.crown + '</span><h3>Popüler Menüler</h3>' +
      '<button class="icon-btn soft" data-action="toggle-menu-mode" aria-label="Görünümü değiştir">' + (listMode ? ICON.grid : ICON.list) + '</button></div>';
    html += '<div class="' + (listMode ? 'menu-list' : 'menu-grid') + '">' + MENUS.map(function (m) {
      return '<a class="menu-tile c-' + m.color + '" href="' + m.href + '">' +
        ICON[m.icon] + '<span>' + esc(m.label) + '</span></a>';
    }).join('') + '</div>';

    const followed = user.follows.map(function (id) { return idx.swimmer[id]; }).filter(Boolean);
    if (followed.length) {
      html += '<div class="section-head"><h3>Takip Ettiklerim</h3></div><div class="chips">' + followed.map(function (s) {
        return '<a class="chip" href="#/swimmer/' + s.id + '">' + esc(name(s)) + '</a>';
      }).join('') + '</div>';
    }
    return html;
  };

  V.latest = function () {
    const meets = sortedMeets().filter(function (m) { return idx.byMeet[m.id].length; });
    if (!meets.length) return empty('Henüz sonuç yok', 'Profil → Veri Yönetimi bölümünden yarış ve sonuç ekleyin.');
    const m = meets[0];
    const evs = meetEvents(m.id);
    let html = pageTitle('Güncel Sonuçlar', m.name + ' · ' + m.city + ' · ' + fdate(m.date) + ' · ' + m.pool + 'm');
    html += '<div class="cards">' + evs.map(function (ev) {
      return ['E', 'K'].map(function (g) {
        const top = eventResults(m.id, ev, g).slice(0, 3);
        if (!top.length) return '';
        return '<a class="card podium" href="#/meet/' + m.id + '/' + ev + '?g=' + g + '"><div class="card-head"><b>' + esc(D.eventName(ev)) +
          '</b><span class="tag">' + genderLabel(g) + '</span></div>' + top.map(function (r) {
            const s = idx.swimmer[r.swimmerId];
            return '<div class="row">' + medal(r._place) + '<span class="grow">' + esc(name(s)) + '<small>' + esc(clubName(s.clubId)) + '</small></span><b class="time">' + fmt(r.time) + '</b></div>';
          }).join('') + '</a>';
      }).join('');
    }).join('') + '</div>';
    if (meets.length > 1) {
      html += '<div class="section-head"><h3>Önceki Yarışlar</h3></div>' + meetList(meets.slice(1, 6));
    }
    return html;
  };

  function meetEvents(meetId) {
    const evs = {};
    idx.byMeet[meetId].forEach(function (r) { evs[r.event] = 1; });
    return Object.keys(evs).sort(eventOrder);
  }
  function eventResults(meetId, ev, g, year) {
    return idx.byMeet[meetId].filter(function (r) {
      const s = idx.swimmer[r.swimmerId];
      return r.event === ev && s.gender === g && (!year || String(s.birthYear) === String(year));
    }).sort(function (a, b) { return a.time - b.time; });
  }
  function meetList(meets) {
    return '<div class="list">' + meets.map(function (m) {
      const cnt = idx.byMeet[m.id].length;
      return '<a class="list-item" href="#/meet/' + m.id + '"><div class="date-box"><b>' + Number(m.date.slice(8)) + '</b><span>' + MONTHS[Number(m.date.slice(5, 7)) - 1] + '</span><small>' + m.date.slice(0, 4) + '</small></div>' +
        '<div class="grow"><b>' + esc(m.name) + '</b><small>' + esc(m.city) + ' · ' + m.pool + 'm havuz · ' + cnt + ' derece</small></div>' + ICON.chev + '</a>';
    }).join('') + '</div>';
  }

  V.meets = function () {
    const q = qs();
    const term = norm(q.q || '');
    const season = q.y || '';
    const list = sortedMeets().filter(function (m) {
      return (!term || norm(m.name + ' ' + m.city).indexOf(term) >= 0) && (!season || m.date.slice(0, 4) === season);
    });
    return pageTitle('Tüm Yarışlar', db.meets.length + ' yarış', '<button class="btn small" data-action="add-meet">' + ICON.plus + 'Yarış</button>') +
      '<div class="filters"><input type="search" placeholder="Yarış veya şehir ara" value="' + esc(q.q || '') + '" data-filter="q">' +
      '<select data-filter="y">' + options([['', 'Tüm sezonlar']].concat(seasons().map(function (y) { return [y, y]; })), season) + '</select></div>' +
      (list.length ? meetList(list) : empty('Yarış bulunamadı'));
  };

  V.meet = function (id, ev) {
    const m = idx.meet[id];
    if (!m) return empty('Yarış bulunamadı');
    if (ev) return meetEvent(m, ev);
    const evs = meetEvents(m.id);
    const swimmers = {};
    idx.byMeet[m.id].forEach(function (r) { swimmers[r.swimmerId] = 1; });
    return pageTitle(m.name, m.city + ' · ' + fdate(m.date) + ' · ' + m.pool + 'm havuz',
      '<button class="btn small" data-action="add-result" data-meet="' + m.id + '">' + ICON.plus + 'Sonuç</button>') +
      '<div class="stats"><div><b>' + evs.length + '</b><span>Branş</span></div><div><b>' + Object.keys(swimmers).length + '</b><span>Sporcu</span></div><div><b>' + idx.byMeet[m.id].length + '</b><span>Derece</span></div></div>' +
      '<div class="list">' + evs.map(function (e) {
        const counts = { E: 0, K: 0 };
        idx.byMeet[m.id].forEach(function (r) { if (r.event === e) counts[idx.swimmer[r.swimmerId].gender]++; });
        return '<a class="list-item" href="#/meet/' + m.id + '/' + e + '"><div class="grow"><b>' + esc(D.eventName(e)) + '</b><small>' +
          counts.E + ' erkek · ' + counts.K + ' kadın</small></div>' + ICON.chev + '</a>';
      }).join('') + '</div>' +
      '<div class="danger-zone"><button class="btn ghost" data-action="delete-meet" data-id="' + m.id + '">Yarışı sil</button></div>';
  };

  function meetEvent(m, ev) {
    const q = qs();
    const g = q.g === 'K' ? 'K' : 'E';
    const year = q.by || '';
    const all = eventResults(m.id, ev, g);
    const years = {};
    all.forEach(function (r) { years[idx.swimmer[r.swimmerId].birthYear] = 1; });
    const list = year ? all.filter(function (r) { return String(idx.swimmer[r.swimmerId].birthYear) === year; }) : all;
    return pageTitle(D.eventName(ev), m.name + ' · ' + m.pool + 'm') +
      '<div class="seg">' + ['E', 'K'].map(function (x) {
        return '<button data-set="g" data-val="' + x + '" class="' + (x === g ? 'on' : '') + '">' + genderLabel(x) + '</button>';
      }).join('') + '</div>' +
      '<div class="filters"><select data-filter="by">' + options([['', 'Tüm yaşlar']].concat(Object.keys(years).sort().reverse().map(function (y) { return [y, y + ' doğumlular']; })), year) + '</select></div>' +
      resultTable(list, { place: year ? 'local' : 'overall' });
  }

  function resultTable(list, opt) {
    if (!list.length) return empty('Bu filtrede sonuç yok');
    return '<div class="table">' + list.map(function (r, i) {
      const s = idx.swimmer[r.swimmerId];
      const place = opt.place === 'local' ? i + 1 : (opt.place === 'rank' ? i + 1 : r._place);
      const pts = points(r);
      const sub = opt.showMeet ? esc(idx.meet[r.meetId].name) + ' · ' + fdate(idx.meet[r.meetId].date) : esc(clubName(s.clubId)) + ' · ' + s.birthYear;
      return '<a class="trow" href="#/swimmer/' + s.id + '">' + medal(place) + '<span class="grow"><b>' + esc(name(s)) + '</b><small>' + sub + '</small></span>' +
        '<span class="tright"><b class="time">' + fmt(r.time) + '</b>' + (pts ? '<small>' + pts + ' p</small>' : '') + '</span></a>';
    }).join('') + '</div>';
  }

  V.swimmer = function (id) {
    const s = idx.swimmer[id];
    if (!s) return empty('Sporcu bulunamadı');
    const pool = qs().p === '25' ? 25 : 50;
    const pbs = personalBests(id);
    const rows = Object.keys(pbs).filter(function (k) { return k.split('|')[1] === String(pool); })
      .map(function (k) { return pbs[k]; }).sort(function (a, b) { return eventOrder(a.event, b.event); });
    const following = user.follows.indexOf(id) >= 0;
    const results = (idx.bySwimmer[id] || []).slice().sort(byDate).reverse();
    const golds = results.filter(function (r) { return r._place === 1; }).length;
    const podiums = results.filter(function (r) { return r._place <= 3; }).length;
    let best = null;
    Object.keys(pbs).forEach(function (k) { const p = points(pbs[k]); if (p && (!best || p > best.p)) best = { p: p, r: pbs[k] }; });

    let html = '<div class="profile-card"><div class="avatar g-' + s.gender + '">' + esc(s.first[0] + s.last[0]) + '</div>' +
      '<div class="grow"><h1>' + esc(name(s)) + '</h1><p>' + esc(clubName(s.clubId)) + ' · ' + s.birthYear + ' · ' + genderLabel(s.gender) + '</p></div>' +
      '<button class="icon-btn follow' + (following ? ' on' : '') + '" data-action="follow" data-id="' + id + '" aria-label="Takip et">' + ICON.star + '</button></div>';
    html += '<div class="stats"><div><b>' + results.length + '</b><span>Derece</span></div><div><b>' + golds + '</b><span>Birincilik</span></div><div><b>' + podiums + '</b><span>Kürsü</span></div><div><b>' + (best ? best.p : '—') + '</b><span>En iyi puan</span></div></div>';
    html += '<div class="actions"><a class="btn" href="#/analysis?s=' + id + '"">' + ICON.chart + 'Analiz</a>' +
      '<a class="btn alt" href="#/compare?a=' + id + '"">' + ICON.scale + 'Karşılaştır</a>' +
      '<button class="btn ghost" data-action="share-swimmer" data-id="' + id + '">' + ICON.share + '</button></div>';
    html += '<div class="section-head"><h3>Kişisel Rekorlar</h3><div class="seg small">' + [50, 25].map(function (p) {
      return '<button data-set="p" data-val="' + p + '" class="' + (p === pool ? 'on' : '') + '">' + p + 'm</button>';
    }).join('') + '</div></div>';
    html += rows.length ? '<div class="table">' + rows.map(function (r) {
      const m = idx.meet[r.meetId];
      return '<a class="trow" href="#/analysis?s=' + id + '&e=' + r.event + '"><span class="grow"><b>' + esc(D.eventName(r.event)) + '</b><small>' + esc(m.name) + ' · ' + fdate(m.date) + '</small></span>' +
        '<span class="tright"><b class="time">' + fmt(r.time) + '</b><small>' + (points(r) || '') + ' p</small></span></a>';
    }).join('') + '</div>' : empty(pool + 'm havuzda derece yok');
    html += '<div class="section-head"><h3>Yarış Geçmişi</h3><button class="btn small" data-action="add-result" data-swimmer="' + id + '">' + ICON.plus + 'Sonuç</button></div>';
    let lastMeet = null;
    html += '<div class="table">' + results.map(function (r) {
      const m = idx.meet[r.meetId];
      let head = '';
      if (lastMeet !== m.id) { lastMeet = m.id; head = '<a class="tgroup" href="#/meet/' + m.id + '">' + esc(m.name) + ' · ' + fdate(m.date) + ' · ' + m.pool + 'm</a>'; }
      const isPb = pbs[r.event + '|' + m.pool] === r;
      return head + '<a class="trow" href="#/meet/' + m.id + '/' + r.event + '?g=' + s.gender + '">' + medal(r._place) + '<span class="grow"><b>' + esc(D.eventName(r.event)) + '</b></span>' +
        '<span class="tright"><b class="time">' + fmt(r.time) + '</b>' + (isPb ? '<small class="pb">KR</small>' : '') + '</span></a>';
    }).join('') + '</div>';
    html += '<div class="danger-zone"><button class="btn ghost" data-action="edit-swimmer" data-id="' + id + '">' + ICON.edit + 'Sporcuyu düzenle</button></div>';
    return html;
  };

  V.club = function (id) {
    const c = idx.club[id];
    if (!c) return empty('Kulüp bulunamadı');
    const list = sortedSwimmers().filter(function (s) { return s.clubId === id; });
    let g = 0, sv = 0, bz = 0;
    list.forEach(function (s) {
      idx.bySwimmer[s.id].forEach(function (r) { if (r._place === 1) g++; else if (r._place === 2) sv++; else if (r._place === 3) bz++; });
    });
    return pageTitle(c.name, c.city + ' · ' + list.length + ' sporcu') +
      '<div class="stats"><div><b>' + g + '</b><span>Altın</span></div><div><b>' + sv + '</b><span>Gümüş</span></div><div><b>' + bz + '</b><span>Bronz</span></div></div>' +
      swimmerList(list);
  };

  function swimmerList(list) {
    if (!list.length) return empty('Sporcu yok');
    return '<div class="list">' + list.map(function (s) {
      return '<a class="list-item" href="#/swimmer/' + s.id + '"><div class="avatar sm g-' + s.gender + '">' + esc(s.first[0] + s.last[0]) + '</div><div class="grow"><b>' + esc(name(s)) + '</b><small>' +
        esc(clubName(s.clubId)) + ' · ' + s.birthYear + '</small></div>' + ICON.chev + '</a>';
    }).join('') + '</div>';
  }

  V.search = function () {
    const q = qs().q || '';
    const term = norm(q);
    let html = '<div class="search-box"><input type="search" id="searchInput" placeholder="Sporcu, kulüp veya yarış ara" value="' + esc(q) + '" autocomplete="off"></div>';
    if (!term) {
      return html + '<div class="section-head"><h3>Kulüpler</h3></div><div class="list">' + db.clubs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'tr'); }).map(function (c) {
        return '<a class="list-item" href="#/club/' + c.id + '"><div class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.city) + '</small></div>' + ICON.chev + '</a>';
      }).join('') + '</div>';
    }
    const sw = sortedSwimmers().filter(function (s) { return norm(name(s) + ' ' + clubName(s.clubId)).indexOf(term) >= 0; }).slice(0, 50);
    const cl = db.clubs.filter(function (c) { return norm(c.name + ' ' + c.city).indexOf(term) >= 0; });
    const mt = sortedMeets().filter(function (m) { return norm(m.name + ' ' + m.city).indexOf(term) >= 0; });
    if (!sw.length && !cl.length && !mt.length) return html + empty('Sonuç bulunamadı', '"' + q + '" için eşleşme yok.');
    if (sw.length) html += '<div class="section-head"><h3>Sporcular</h3></div>' + swimmerList(sw);
    if (cl.length) html += '<div class="section-head"><h3>Kulüpler</h3></div><div class="list">' + cl.map(function (c) {
      return '<a class="list-item" href="#/club/' + c.id + '"><div class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.city) + '</small></div>' + ICON.chev + '</a>';
    }).join('') + '</div>';
    if (mt.length) html += '<div class="section-head"><h3>Yarışlar</h3></div>' + meetList(mt);
    return html;
  };

  // ---- Analiz ve sıralama ekranları ----
  V.analysis = function () {
    const q = qs();
    const s = idx.swimmer[q.s];
    let html = pageTitle('Sporcu Analiz', 'Derece gelişimi, puan ve sıralama');
    html += '<div class="filters"><select data-filter="s">' + swimmerOptions(q.s || '', 'Sporcu seçin') + '</select>';
    if (!s) return html + '</div>' + empty('Analiz için bir sporcu seçin');
    const evs = {};
    idx.bySwimmer[s.id].forEach(function (r) { evs[r.event] = 1; });
    const evList = Object.keys(evs).sort(eventOrder);
    const ev = evs[q.e] ? q.e : evList[0];
    html += '<select data-filter="e">' + eventOptions(ev, evList) + '</select></div>';
    if (!ev) return html + empty('Bu sporcunun derecesi yok');
    const res = idx.bySwimmer[s.id].filter(function (r) { return r.event === ev; }).sort(byDate);
    html += chart(res);
    [50, 25].forEach(function (pool) {
      const pr = res.filter(function (r) { return idx.meet[r.meetId].pool === pool; });
      if (!pr.length) return;
      const pb = pr.reduce(function (a, b) { return b.time < a.time ? b : a; });
      const first = pr[0], last = pr[pr.length - 1];
      const imp = ((first.time - pb.time) / first.time * 100);
      const rank = yearRank(s, ev, pool);
      html += '<div class="card"><div class="card-head"><b>' + pool + 'm havuz</b><span class="tag">' + pr.length + ' yarış</span></div>' +
        '<div class="kv"><span>Kişisel rekor</span><b>' + fmt(pb.time) + '</b></div>' +
        '<div class="kv"><span>Puan</span><b>' + (points(pb) || '—') + '</b></div>' +
        '<div class="kv"><span>İlk derece</span><b>' + fmt(first.time) + ' <small>' + fdate(idx.meet[first.meetId].date) + '</small></b></div>' +
        '<div class="kv"><span>Son derece</span><b>' + fmt(last.time) + ' <small>' + fdate(idx.meet[last.meetId].date) + '</small></b></div>' +
        '<div class="kv"><span>Toplam gelişim</span><b class="' + (imp > 0 ? 'up' : '') + '">' + (imp > 0 ? '−' : '') + Math.abs(imp).toFixed(1) + '%</b></div>' +
        '<div class="kv"><span>' + s.birthYear + ' doğumlular arasında</span><b>' + rank.rank + '. / ' + rank.total + '</b></div></div>';
    });
    return html;
  };

  function yearRank(s, ev, pool) {
    const best = {};
    db.results.forEach(function (r) {
      const o = idx.swimmer[r.swimmerId], m = idx.meet[r.meetId];
      if (!o || !m || r.event !== ev || m.pool !== pool || o.gender !== s.gender || o.birthYear !== s.birthYear) return;
      if (!best[o.id] || r.time < best[o.id]) best[o.id] = r.time;
    });
    const sorted = Object.keys(best).sort(function (a, b) { return best[a] - best[b]; });
    return { rank: sorted.indexOf(s.id) + 1, total: sorted.length };
  }

  function chart(res) {
    if (res.length < 2) return '<div class="card muted">Grafik için en az iki derece gerekir.</div>';
    const W = 340, H = 200, P = { l: 52, r: 12, t: 14, b: 30 };
    const dates = res.map(function (r) { return new Date(idx.meet[r.meetId].date).getTime(); });
    const times = res.map(function (r) { return r.time; });
    let tmin = Math.min.apply(null, times), tmax = Math.max.apply(null, times);
    const pad = Math.max((tmax - tmin) * 0.12, 20);
    tmin -= pad; tmax += pad;
    const dmin = Math.min.apply(null, dates), dmax = Math.max.apply(null, dates) || dmin + 1;
    const x = function (d) { return P.l + (dmax === dmin ? 0.5 : (d - dmin) / (dmax - dmin)) * (W - P.l - P.r); };
    const y = function (tv) { return P.t + (tv - tmin) / (tmax - tmin) * (H - P.t - P.b); }; // hızlı = yukarı
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Derece gelişim grafiği">';
    for (let i = 0; i <= 3; i++) {
      const tv = tmin + (tmax - tmin) * i / 3;
      svg += '<line class="grid" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(tv) + '" y2="' + y(tv) + '"/><text class="axis" x="' + (P.l - 6) + '" y="' + (y(tv) + 4) + '" text-anchor="end">' + fmt(Math.round(tv)) + '</text>';
    }
    const first = new Date(dmin), last = new Date(dmax);
    svg += '<text class="axis" x="' + P.l + '" y="' + (H - 8) + '">' + MONTHS[first.getMonth()] + ' ' + first.getFullYear() + '</text>';
    svg += '<text class="axis" x="' + (W - P.r) + '" y="' + (H - 8) + '" text-anchor="end">' + MONTHS[last.getMonth()] + ' ' + last.getFullYear() + '</text>';
    [50, 25].forEach(function (pool) {
      const pts = res.map(function (r, i) { return { r: r, d: dates[i] }; }).filter(function (o) { return idx.meet[o.r.meetId].pool === pool; });
      if (!pts.length) return;
      const cls = pool === 50 ? 's50' : 's25';
      svg += '<polyline class="line ' + cls + '" points="' + pts.map(function (o) { return x(o.d).toFixed(1) + ',' + y(o.r.time).toFixed(1); }).join(' ') + '"/>';
      pts.forEach(function (o) {
        svg += '<circle class="pt ' + cls + '" cx="' + x(o.d).toFixed(1) + '" cy="' + y(o.r.time).toFixed(1) + '" r="4"><title>' + fmt(o.r.time) + ' · ' + esc(idx.meet[o.r.meetId].name) + '</title></circle>';
      });
    });
    svg += '</svg>';
    return '<div class="card chart-card">' + svg + '<div class="legend"><span><i class="s50"></i>50m havuz</span><span><i class="s25"></i>25m havuz</span><span class="muted">Yukarı = daha hızlı</span></div></div>';
  }

  V.compare = function () {
    const q = qs();
    const a = idx.swimmer[q.a], b = idx.swimmer[q.b];
    const pool = q.p === '25' ? 25 : 50;
    let html = pageTitle('Karşılaştırma', 'İki sporcunun kişisel rekorları ve ortak yarışları');
    html += '<div class="filters two"><select data-filter="a">' + swimmerOptions(q.a || '', '1. sporcu') + '</select><select data-filter="b">' + swimmerOptions(q.b || '', '2. sporcu') + '</select></div>';
    html += '<div class="seg">' + [50, 25].map(function (p) { return '<button data-set="p" data-val="' + p + '" class="' + (p === pool ? 'on' : '') + '">' + p + 'm havuz</button>'; }).join('') + '</div>';
    if (!a || !b) return html + empty('Karşılaştırmak için iki sporcu seçin');
    const pa = personalBests(a.id), pb = personalBests(b.id);
    const evs = {};
    Object.keys(pa).concat(Object.keys(pb)).forEach(function (k) { if (k.split('|')[1] === String(pool)) evs[k.split('|')[0]] = 1; });
    let winA = 0, winB = 0;
    const rows = Object.keys(evs).sort(eventOrder).map(function (ev) {
      const ra = pa[ev + '|' + pool], rb = pb[ev + '|' + pool];
      let ca = '', cb = '', diff = '';
      if (ra && rb) {
        if (ra.time < rb.time) { ca = 'win'; winA++; } else if (rb.time < ra.time) { cb = 'win'; winB++; }
        diff = (ra.time === rb.time ? '=' : fmt(Math.abs(ra.time - rb.time)));
      }
      return '<div class="cmp-row"><span class="' + ca + '">' + (ra ? fmt(ra.time) : '—') + '</span><span class="ev">' + esc(D.eventName(ev)) + (diff ? '<small>fark ' + diff + '</small>' : '') + '</span><span class="' + cb + '">' + (rb ? fmt(rb.time) : '—') + '</span></div>';
    });
    html += '<div class="card"><div class="cmp-head"><a href="#/swimmer/' + a.id + '"><b>' + esc(name(a)) + '</b><small>' + a.birthYear + ' · ' + esc(clubName(a.clubId)) + '</small><em>' + winA + '</em></a><span>vs</span><a href="#/swimmer/' + b.id + '"><b>' + esc(name(b)) + '</b><small>' + b.birthYear + ' · ' + esc(clubName(b.clubId)) + '</small><em>' + winB + '</em></a></div>' +
      (rows.length ? rows.join('') : '<p class="muted">Bu havuzda derece yok.</p>') + '</div>';
    // aynı yarıştaki karşılaşmalar
    const h2h = [];
    idx.bySwimmer[a.id].forEach(function (r1) {
      idx.bySwimmer[b.id].forEach(function (r2) { if (r1.meetId === r2.meetId && r1.event === r2.event) h2h.push([r1, r2]); });
    });
    if (h2h.length) {
      h2h.sort(function (x, y) { return byDate(y[0], x[0]); });
      html += '<div class="section-head"><h3>Aynı Yarışta (' + h2h.length + ')</h3></div><div class="table">' + h2h.map(function (p) {
        const m = idx.meet[p[0].meetId];
        return '<div class="cmp-row"><span class="' + (p[0].time < p[1].time ? 'win' : '') + '">' + fmt(p[0].time) + '</span><span class="ev">' + esc(D.eventName(p[0].event)) + '<small>' + esc(m.name) + '</small></span><span class="' + (p[1].time < p[0].time ? 'win' : '') + '">' + fmt(p[1].time) + '</span></div>';
      }).join('') + '</div>';
    }
    return html;
  };

  function bestList(ev, pool, g, by, season) {
    const best = {};
    db.results.forEach(function (r) {
      const s = idx.swimmer[r.swimmerId], m = idx.meet[r.meetId];
      if (!s || !m || r.event !== ev || m.pool !== pool || s.gender !== g) return;
      if (by && String(s.birthYear) !== by) return;
      if (season && m.date.slice(0, 4) !== season) return;
      if (!best[s.id] || r.time < best[s.id].time) best[s.id] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return a.time - b.time; });
  }

  V.top100 = function () {
    const q = qs();
    const ev = D.EVENTS.indexOf(q.e) >= 0 ? q.e : '100SER';
    const pool = q.p === '25' ? 25 : 50;
    const g = q.g === 'K' ? 'K' : 'E';
    const years = {};
    db.swimmers.forEach(function (s) { years[s.birthYear] = 1; });
    const list = bestList(ev, pool, g, q.by || '', q.y || '').slice(0, 100);
    return pageTitle('En İyi 100', D.eventName(ev) + ' · ' + pool + 'm · ' + genderLabel(g)) +
      '<div class="filters"><select data-filter="e">' + eventOptions(ev) + '</select>' +
      '<select data-filter="p">' + options([['50', '50m havuz'], ['25', '25m havuz']], pool) + '</select>' +
      '<select data-filter="g">' + options([['E', 'Erkek'], ['K', 'Kadın']], g) + '</select>' +
      '<select data-filter="by">' + options([['', 'Tüm yaşlar']].concat(Object.keys(years).sort().reverse().map(function (y) { return [y, y + ' doğumlular']; })), q.by || '') + '</select>' +
      '<select data-filter="y">' + options([['', 'Tüm zamanlar']].concat(seasons().map(function (y) { return [y, y + ' sezonu']; })), q.y || '') + '</select></div>' +
      resultTable(list, { place: 'rank', showMeet: true });
  };

  V.leaders = function () {
    const q = qs();
    const pool = q.p === '25' ? 25 : 50;
    const g = q.g === 'K' ? 'K' : 'E';
    const season = q.y === undefined ? (seasons()[0] || '') : q.y;
    let html = pageTitle('Zirvedekiler', 'Her branşta ilk üç') +
      '<div class="filters"><select data-filter="p">' + options([['50', '50m havuz'], ['25', '25m havuz']], pool) + '</select>' +
      '<select data-filter="g">' + options([['E', 'Erkek'], ['K', 'Kadın']], g) + '</select>' +
      '<select data-filter="y">' + options([['', 'Tüm zamanlar']].concat(seasons().map(function (y) { return [y, y + ' sezonu']; })), season) + '</select></div>';
    const cards = D.EVENTS.map(function (ev) {
      const top = bestList(ev, pool, g, '', season).slice(0, 3);
      if (!top.length) return '';
      return '<a class="card podium" href="#/top100?e=' + ev + '&p=' + pool + '&g=' + g + '&y=' + season + '"><div class="card-head"><b>' + esc(D.eventName(ev)) + '</b></div>' + top.map(function (r, i) {
        const s = idx.swimmer[r.swimmerId];
        return '<div class="row">' + medal(i + 1) + '<span class="grow">' + esc(name(s)) + '<small>' + esc(clubName(s.clubId)) + '</small></span><b class="time">' + fmt(r.time) + '</b></div>';
      }).join('') + '</a>';
    }).join('');
    return html + (cards ? '<div class="cards">' + cards + '</div>' : empty('Bu filtrede derece yok'));
  };

  V.records = function (scope) {
    scope = scope === 'TR' ? 'TR' : 'WR';
    const q = qs();
    const pool = q.p === '25' ? 25 : 50;
    const g = q.g === 'K' ? 'K' : 'E';
    const list = db.records.filter(function (r) { return r.scope === scope && r.pool === pool && r.gender === g; })
      .sort(function (a, b) { return eventOrder(a.event, b.event); });
    let html = pageTitle(scope === 'TR' ? 'Türkiye Rekorları' : 'Dünya Rekorları', pool + 'm havuz · ' + genderLabel(g),
      '<button class="btn small" data-action="add-record" data-scope="' + scope + '">' + ICON.plus + 'Rekor</button>');
    html += '<div class="seg">' + ['E', 'K'].map(function (x) { return '<button data-set="g" data-val="' + x + '" class="' + (x === g ? 'on' : '') + '">' + genderLabel(x) + '</button>'; }).join('') + '</div>';
    html += '<div class="seg small">' + [50, 25].map(function (p) { return '<button data-set="p" data-val="' + p + '" class="' + (p === pool ? 'on' : '') + '">' + p + 'm</button>'; }).join('') + '</div>';
    if (scope === 'WR') html += '<p class="note">Dünya rekorları örnek olarak eklenmiştir. Resmi World Aquatics listesinden kontrol edip güncelleyebilirsiniz.</p>';
    if (!list.length) {
      return html + empty('Kayıtlı rekor yok', scope === 'TR'
        ? 'Türkiye Yüzme Federasyonu\'nun resmi listesinden rekorları “Rekor” düğmesiyle ekleyebilirsiniz.'
        : 'Bu havuz ve cinsiyet için rekor eklenmemiş.');
    }
    return html + '<div class="table">' + list.map(function (r) {
      return '<button class="trow" data-action="edit-record" data-id="' + r.id + '"><span class="grow"><b>' + esc(D.eventName(r.event)) + '</b><small>' + esc(r.holder) + (r.team ? ' · ' + esc(r.team) : '') + (r.date ? ' · ' + fdate(r.date) : '') + '</small></span><span class="tright"><b class="time">' + fmt(r.time) + '</b></span></button>';
    }).join('') + '</div>';
  };

  V.news = function (id) {
    if (id) {
      const n = db.news.find(function (x) { return x.id === id; });
      if (!n) return empty('Haber bulunamadı');
      return '<article class="article"><div class="slide theme-' + esc(n.theme) + ' hero"><div class="slide-art"></div></div><small class="muted">' + fdate(n.date) + '</small><h1>' + esc(n.title) + '</h1>' +
        n.body.split('\n\n').map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</article>';
    }
    return pageTitle('Haberler', '') + '<div class="list">' + db.news.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (n) {
      return '<a class="list-item news-item" href="#/news/' + n.id + '"><div class="thumb theme-' + esc(n.theme) + '"><div class="slide-art"></div></div><div class="grow"><b>' + esc(n.title) + '</b><small>' + fdate(n.date) + '</small></div></a>';
    }).join('') + '</div>';
  };

  V.notifications = function () {
    const list = user.notifications.slice().reverse();
    let html = pageTitle('Bildirimler', list.length + ' bildirim', list.length ? '<button class="btn small ghost" data-action="clear-notifs">Temizle</button>' : '');
    const perm = notifPermission();
    if (perm !== 'granted') {
      html += '<div class="card"><p>' + (perm === 'unsupported' ? 'Bu cihaz telefon bildirimlerini desteklemiyor; bildirimler burada görünür.' :
        'Telefon bildirimleri kapalı. Takip ettiğiniz sporcuların yeni dereceleri için açabilirsiniz.') + '</p>' +
        (perm === 'unsupported' ? '' : '<button class="btn" data-action="enable-notif">' + ICON.bell + 'Bildirimleri aç</button>') + '</div>';
    }
    if (!list.length) return html + empty('Bildirim yok', 'Bir sporcuyu takip edin; yeni derecesi eklendiğinde burada görünür.');
    html += '<div class="list">' + list.map(function (n) {
      return '<a class="list-item' + (n.read ? '' : ' unread') + '" href="' + esc(n.link || '#/') + '"><div class="grow"><b>' + esc(n.title) + '</b><small>' + esc(n.text) + '</small></div></a>';
    }).join('') + '</div>';
    user.notifications.forEach(function (n) { n.read = true; });
    saveUser();
    return html;
  };

  V.profile = function () {
    const followed = user.follows.map(function (id) { return idx.swimmer[id]; }).filter(Boolean);
    const perm = notifPermission();
    return pageTitle('Profil', '') +
      '<div class="card"><div class="card-head"><b>' + ICON.bell + ' Bildirimler</b><span class="tag">' + ({ granted: 'Açık', denied: 'Engelli', 'default': 'Kapalı', unsupported: 'Desteklenmiyor' })[perm] + '</span></div>' +
      (perm === 'granted' || perm === 'unsupported' ? '<p class="muted">Takip ettiğiniz sporcuların yeni dereceleri bildirilir.</p>' :
        perm === 'denied' ? '<p class="muted">Bildirim izni cihaz ayarlarından engellenmiş. Ayarlar → Uygulamalar → Kulvar → Bildirimler bölümünden açabilirsiniz.</p>' :
          '<button class="btn" data-action="enable-notif">Bildirimleri aç</button>') + '</div>' +
      '<div class="section-head"><h3>Takip Ettiklerim (' + followed.length + ')</h3></div>' + (followed.length ? swimmerList(followed) : '<p class="muted pad">Sporcu sayfasındaki yıldız ile takip edin.</p>') +
      syncCard() +
      '<div class="section-head"><h3>Veri Yönetimi</h3></div><div class="list">' +
      '<button class="list-item" data-action="add-meet"><div class="grow"><b>Yarış ekle</b><small>Ad, şehir, tarih, havuz</small></div>' + ICON.chev + '</button>' +
      '<button class="list-item" data-action="add-result"><div class="grow"><b>Sonuç ekle</b><small>Tek tek derece girişi</small></div>' + ICON.chev + '</button>' +
      '<button class="list-item" data-action="add-swimmer"><div class="grow"><b>Sporcu ekle</b></div>' + ICON.chev + '</button>' +
      '<button class="list-item" data-action="add-club"><div class="grow"><b>Kulüp ekle</b></div>' + ICON.chev + '</button>' +
      '<label class="list-item"><div class="grow"><b>CSV içe aktar</b><small>yaris, tarih, sehir, havuz, ad, soyad, dogum_yili, cinsiyet, kulup, brans, derece</small></div>' + ICON.chev + '<input type="file" accept=".csv,text/csv,text/plain" data-action="import-csv" hidden></label>' +
      '<button class="list-item" data-action="export-json"><div class="grow"><b>Yedek al</b><small>Tüm veriyi JSON olarak indir</small></div>' + ICON.chev + '</button>' +
      '<label class="list-item"><div class="grow"><b>Yedekten geri yükle</b></div>' + ICON.chev + '<input type="file" accept=".json,application/json" data-action="import-json" hidden></label>' +
      '<button class="list-item" data-action="clear-demo"><div class="grow"><b>Demo verisini sil</b><small>Örnek sporcuları ve yarışları kaldırır; kendi verileriniz kalır</small></div>' + ICON.chev + '</button>' +
      '<button class="list-item danger" data-action="reset"><div class="grow"><b>Sıfırla</b><small>Elle eklenen veriler silinir, sunucudan yeniden yüklenir</small></div>' + ICON.chev + '</button></div>' +
      '<p class="muted pad center">Kulvar v1.2.0 · ' + db.swimmers.length + ' sporcu · ' + db.meets.length + ' yarış · ' + db.results.length + ' derece</p>';
  };

  function pageTitle(t, sub, action) {
    return '<div class="page-title"><div class="grow"><h1>' + esc(t) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' + (action || '') + '</div>';
  }
  function empty(t, sub) {
    return '<div class="empty"><b>' + esc(t) + '</b>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
  }

  // ---------- Yönlendirme ----------
  const TAB_ROUTES = { '': 'home', search: 'search', meets: 'meets', news: 'news', profile: 'profile' };
  const view = document.getElementById('view');
  let lastRoute = null;

  function render() {
    const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
    const parts = hash.split('/').map(decodeURIComponent);
    const r = parts[0] || '';
    let html;
    switch (r) {
      case '': html = V.home(); break;
      case 'latest': html = V.latest(); break;
      case 'meets': html = V.meets(); break;
      case 'meet': html = V.meet(parts[1], parts[2]); break;
      case 'swimmer': html = V.swimmer(parts[1]); break;
      case 'club': html = V.club(parts[1]); break;
      case 'search': html = V.search(); break;
      case 'analysis': html = V.analysis(); break;
      case 'compare': html = V.compare(); break;
      case 'top100': html = V.top100(); break;
      case 'leaders': html = V.leaders(); break;
      case 'records': html = V.records(parts[1]); break;
      case 'news': html = V.news(parts[1]); break;
      case 'notifications': html = V.notifications(); break;
      case 'profile': html = V.profile(); break;
      default: html = empty('Sayfa bulunamadı');
    }
    view.innerHTML = html;
    const tab = TAB_ROUTES[r] || (r === 'news' ? 'news' : null);
    document.querySelectorAll('.tabbar a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === tab && !(r === 'news' && parts[1])); });
    document.getElementById('backBtn').hidden = !!TAB_ROUTES[r] && !(r === 'news' && parts[1]);
    const routeKey = hash;
    if (routeKey !== lastRoute) { window.scrollTo(0, 0); lastRoute = routeKey; }
    if (r === '') initCarousel();
    if (r === 'search') {
      const inp = document.getElementById('searchInput');
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
    updateBell();
  }

  let carouselTimer = null;
  function initCarousel() {
    clearInterval(carouselTimer);
    const c = document.getElementById('carousel');
    if (!c) return;
    const dots = document.querySelectorAll('#dots button');
    const current = function () { return Math.round(c.scrollLeft / c.clientWidth); };
    c.addEventListener('scroll', function () {
      const i = current();
      dots.forEach(function (d, j) { d.classList.toggle('on', i === j); });
    }, { passive: true });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { c.scrollTo({ left: c.clientWidth * Number(d.dataset.dot), behavior: 'smooth' }); });
    });
    carouselTimer = setInterval(function () {
      if (!document.body.contains(c)) { clearInterval(carouselTimer); return; }
      const next = (current() + 1) % dots.length;
      c.scrollTo({ left: c.clientWidth * next, behavior: 'smooth' });
    }, 5000);
  }

  window.addEventListener('hashchange', function () {
    if (!document.getElementById('sheet').hidden) closeSheet();
    render();
  });

  // ---------- Etkileşimler ----------
  document.addEventListener('click', function (e) {
    const set = e.target.closest('[data-set]');
    if (set) { const p = {}; p[set.dataset.set] = set.dataset.val; setQs(p); return; }
    const a = e.target.closest('[data-action]');
    if (!a || a.tagName === 'INPUT') return;
    const act = a.dataset.action;
    const fn = ACTIONS[act];
    if (fn) { e.preventDefault(); fn(a); }
  });

  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t.dataset.filter) { const p = {}; p[t.dataset.filter] = t.value; setQs(p); return; }
    if (t.dataset.action && ACTIONS[t.dataset.action]) ACTIONS[t.dataset.action](t);
  });

  let searchTimer = null;
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (t.id === 'searchInput' || (t.dataset.filter === 'q')) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { setQs({ q: t.value }); }, 250);
    }
  });

  document.getElementById('backBtn').addEventListener('click', function () { goBack(); });
  function goBack() {
    if (!document.getElementById('sheet').hidden) { closeSheet(); return true; }
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return false;
    if (history.length > 1) history.back(); else location.hash = '#/';
    return true;
  }
  window.kulvarBack = goBack;

  const ACTIONS = {
    'dismiss-banner': function () { user.bannerDismissed = true; saveUser(); render(); },
    'enable-notif': function () { requestNotif(); },
    'toggle-menu-mode': function () { user.menuList = !user.menuList; saveUser(); render(); },
    'follow': function (el) {
      const id = el.dataset.id;
      const i = user.follows.indexOf(id);
      if (i >= 0) { user.follows.splice(i, 1); toast('Takipten çıkarıldı'); }
      else {
        user.follows.push(id); toast('Takip ediliyor');
        if (notifPermission() === 'default') requestNotif();
      }
      saveUser(); render();
    },
    'share-swimmer': function (el) {
      const s = idx.swimmer[el.dataset.id];
      const pbs = personalBests(s.id);
      const lines = Object.keys(pbs).sort(function (a, b) { return eventOrder(a.split('|')[0], b.split('|')[0]); }).map(function (k) {
        const r = pbs[k];
        return D.eventName(r.event) + ' (' + k.split('|')[1] + 'm): ' + fmt(r.time);
      });
      shareText(name(s) + ' — ' + clubName(s.clubId) + ' (' + s.birthYear + ')\nKişisel rekorlar:\n' + lines.join('\n'));
    },
    'add-meet': function () { meetForm(); },
    'delete-meet': function (el) {
      const m = idx.meet[el.dataset.id];
      if (!confirm('"' + m.name + '" ve tüm sonuçları silinsin mi?')) return;
      db.meets = db.meets.filter(function (x) { return x.id !== m.id; });
      db.results = db.results.filter(function (r) { return r.meetId !== m.id; });
      saveDb(); toast('Yarış silindi'); location.hash = '#/meets';
    },
    'add-result': function (el) { resultForm(el.dataset.meet, el.dataset.swimmer); },
    'add-swimmer': function () { swimmerForm(); },
    'edit-swimmer': function (el) { swimmerForm(idx.swimmer[el.dataset.id]); },
    'add-club': function () { clubForm(); },
    'add-record': function (el) { recordForm({ scope: el.dataset.scope, pool: qs().p === '25' ? 25 : 50, gender: qs().g === 'K' ? 'K' : 'E' }); },
    'edit-record': function (el) { recordForm(db.records.find(function (r) { return r.id === el.dataset.id; })); },
    'clear-notifs': function () { user.notifications = []; saveUser(); render(); },
    'export-json': function () {
      const data = JSON.stringify({ app: 'kulvar', exported: new Date().toISOString(), db: db, follows: user.follows }, null, 1);
      downloadFile('kulvar-yedek-' + new Date().toISOString().slice(0, 10) + '.json', data, 'application/json');
    },
    'import-json': function (el) {
      readFile(el, function (text) {
        try {
          const o = JSON.parse(text);
          const d = o.db || o;
          if (!d.swimmers || !d.meets || !d.results) throw new Error('format');
          if (!confirm('Mevcut verinin yerine yedek yüklensin mi?')) return;
          db = d; db.records = db.records || []; db.news = db.news || []; db.clubs = db.clubs || [];
          if (o.follows) user.follows = o.follows;
          saveDb(); saveUser(); toast('Yedek yüklendi'); render();
        } catch (err) { toast('Geçersiz yedek dosyası'); }
      });
    },
    'import-csv': function (el) { readFile(el, importCsv); },
    'clear-demo': function () {
      if (!confirm('Demo sporcular, yarışlar ve dereceleri silinsin mi? Diğer veriler korunur.')) return;
      removeDemo();
      saveDb(); dropMissingFollows(); toast('Demo verisi silindi'); render();
    },
    'sync-now': function () { syncRemote(true); },
    'reset': function () {
      if (!confirm('Tüm veriler silinip yeniden yüklensin mi?')) return;
      db = D.generateDemo(); user.follows = []; user.notifications = []; user.sync = {};
      saveDb(); saveUser(); toast('Sıfırlandı'); location.hash = '#/';
      syncRemote(false);
    }
  };

  // ---------- Formlar (alt sayfa) ----------
  const sheet = document.getElementById('sheet');
  const backdrop = document.getElementById('sheetBackdrop');
  function openSheet(html, onSubmit) {
    sheet.innerHTML = '<div class="sheet-grip"></div>' + html;
    sheet.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('open'); backdrop.classList.add('open'); });
    const form = sheet.querySelector('form');
    if (form && onSubmit) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const data = {};
        new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
        const err = onSubmit(data, e.submitter);
        if (err) { const box = sheet.querySelector('.form-error'); box.textContent = err; box.hidden = false; }
      });
    }
    sheet.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeSheet); });
  }
  function closeSheet() {
    sheet.classList.remove('open'); backdrop.classList.remove('open');
    setTimeout(function () { sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = ''; }, 200);
  }
  backdrop.addEventListener('click', closeSheet);

  function formShell(title, body, submit, extra) {
    return '<form><div class="sheet-head"><h2>' + esc(title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Kapat">' + ICON.close + '</button></div>' +
      body + '<p class="form-error" hidden></p><div class="sheet-actions">' + (extra || '') + '<button class="btn" type="submit">' + esc(submit) + '</button></div></form>';
  }
  function field(label, input) { return '<label class="field"><span>' + esc(label) + '</span>' + input + '</label>'; }

  function meetForm() {
    openSheet(formShell('Yarış Ekle',
      field('Yarış adı', '<input name="name" required placeholder="ör. Kış Kupası">') +
      field('Şehir', '<input name="city" required>') +
      '<div class="two">' + field('Tarih', '<input type="date" name="date" required value="' + new Date().toISOString().slice(0, 10) + '">') +
      field('Havuz', '<select name="pool">' + options([['50', '50 m'], ['25', '25 m']], '50') + '</select>') + '</div>', 'Kaydet'),
    function (d) {
      const m = { id: uid('m'), name: d.name, city: d.city, date: d.date, pool: Number(d.pool) };
      db.meets.push(m); saveDb(); closeSheet(); toast('Yarış eklendi'); location.hash = '#/meet/' + m.id;
    });
  }

  function clubOptions(selected) {
    return options([['', 'Ferdi / kulüpsüz']].concat(db.clubs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'tr'); }).map(function (c) { return [c.id, c.name]; })), selected);
  }

  function swimmerForm(s) {
    const edit = !!s;
    s = s || {};
    openSheet(formShell(edit ? 'Sporcuyu Düzenle' : 'Sporcu Ekle',
      '<div class="two">' + field('Ad', '<input name="first" required value="' + esc(s.first || '') + '">') + field('Soyad', '<input name="last" required value="' + esc(s.last || '') + '">') + '</div>' +
      '<div class="two">' + field('Doğum yılı', '<input name="birthYear" type="number" min="1940" max="2030" required value="' + esc(s.birthYear || '') + '">') +
      field('Cinsiyet', '<select name="gender">' + options([['E', 'Erkek'], ['K', 'Kadın']], s.gender || 'E') + '</select>') + '</div>' +
      field('Kulüp', '<select name="clubId">' + clubOptions(s.clubId || '') + '</select>'),
    'Kaydet', edit ? '<button type="submit" class="btn ghost" name="del" value="1">Sil</button>' : ''),
    function (d, btn) {
      if (edit && btn && btn.name === 'del') {
        if (!confirm(name(s) + ' ve tüm dereceleri silinsin mi?')) return;
        db.swimmers = db.swimmers.filter(function (x) { return x.id !== s.id; });
        db.results = db.results.filter(function (r) { return r.swimmerId !== s.id; });
        user.follows = user.follows.filter(function (id) { return id !== s.id; });
        saveDb(); saveUser(); closeSheet(); toast('Sporcu silindi'); location.hash = '#/search'; return;
      }
      const target = edit ? s : { id: uid('s') };
      target.first = d.first; target.last = d.last; target.birthYear = Number(d.birthYear); target.gender = d.gender; target.clubId = d.clubId;
      if (!edit) db.swimmers.push(target);
      saveDb(); closeSheet(); toast('Kaydedildi'); location.hash = '#/swimmer/' + target.id; render();
    });
  }

  function clubForm() {
    openSheet(formShell('Kulüp Ekle', field('Kulüp adı', '<input name="name" required>') + field('Şehir', '<input name="city" required>'), 'Kaydet'),
      function (d) {
        const c = { id: uid('c'), name: d.name, city: d.city };
        db.clubs.push(c); saveDb(); closeSheet(); toast('Kulüp eklendi'); location.hash = '#/club/' + c.id;
      });
  }

  function resultForm(meetId, swimmerId) {
    if (!db.meets.length) { toast('Önce bir yarış ekleyin'); meetForm(); return; }
    openSheet(formShell('Sonuç Ekle',
      field('Yarış', '<select name="meetId" required>' + options(sortedMeets().map(function (m) { return [m.id, m.name + ' · ' + fdate(m.date) + ' · ' + m.pool + 'm']; }), meetId || sortedMeets()[0].id) + '</select>') +
      field('Sporcu', '<select name="swimmerId" required>' + swimmerOptions(swimmerId || '', 'Sporcu seçin') + '</select>') +
      '<div class="two">' + field('Branş', '<select name="event">' + eventOptions('100SER') + '</select>') +
      field('Derece', '<input name="time" required inputmode="decimal" placeholder="1:02.45">') + '</div>' +
      '<p class="muted small">Listede olmayan sporcu için önce Profil → Sporcu ekle.</p>', 'Kaydet', '<button type="submit" class="btn ghost" name="more" value="1">Kaydet ve yeni</button>'),
    function (d, btn) {
      const time = parseTimeInput(d.time);
      if (!d.swimmerId) return 'Sporcu seçin';
      if (!time) return 'Derece biçimi geçersiz. Örnek: 28.45 veya 1:02.45';
      const r = { id: uid('r'), meetId: d.meetId, swimmerId: d.swimmerId, event: d.event, time: time };
      const isPb = checkPb(r);
      db.results.push(r); saveDb();
      notifyResult(r, isPb);
      toast('Sonuç eklendi' + (isPb ? ' · Kişisel rekor!' : ''));
      if (btn && btn.name === 'more') { sheet.querySelector('[name=time]').value = ''; sheet.querySelector('[name=time]').focus(); return; }
      closeSheet(); render();
    });
  }

  function recordForm(r) {
    const edit = !!r.id;
    openSheet(formShell(edit ? 'Rekoru Düzenle' : 'Rekor Ekle',
      '<div class="two">' + field('Kapsam', '<select name="scope">' + options([['TR', 'Türkiye'], ['WR', 'Dünya']], r.scope) + '</select>') +
      field('Havuz', '<select name="pool">' + options([['50', '50 m'], ['25', '25 m']], r.pool) + '</select>') + '</div>' +
      '<div class="two">' + field('Cinsiyet', '<select name="gender">' + options([['E', 'Erkek'], ['K', 'Kadın']], r.gender) + '</select>') +
      field('Branş', '<select name="event">' + eventOptions(r.event || '100SER') + '</select>') + '</div>' +
      '<div class="two">' + field('Derece', '<input name="time" required inputmode="decimal" value="' + (r.time ? fmt(r.time) : '') + '" placeholder="1:02.45">') +
      field('Tarih', '<input type="date" name="date" value="' + esc(r.date || '') + '">') + '</div>' +
      field('Sahibi', '<input name="holder" required value="' + esc(r.holder || '') + '">') +
      field('Kulüp / ülke', '<input name="team" value="' + esc(r.team || '') + '">'),
    'Kaydet', edit ? '<button type="submit" class="btn ghost" name="del" value="1">Sil</button>' : ''),
    function (d, btn) {
      if (edit && btn && btn.name === 'del') {
        db.records = db.records.filter(function (x) { return x.id !== r.id; });
        saveDb(); closeSheet(); render(); return;
      }
      const time = parseTimeInput(d.time);
      if (!time) return 'Derece biçimi geçersiz';
      const target = edit ? r : { id: uid('rec') };
      Object.assign(target, { scope: d.scope, pool: Number(d.pool), gender: d.gender, event: d.event, time: time, date: d.date, holder: d.holder, team: d.team });
      if (!edit) db.records.push(target);
      saveDb(); closeSheet(); toast('Rekor kaydedildi');
      location.hash = '#/records/' + target.scope + '?g=' + target.gender + '&p=' + target.pool; render();
    });
  }

  // ---------- Kişisel rekor ve bildirim ----------
  function checkPb(r) {
    const pool = idx.meet[r.meetId].pool;
    const prev = (idx.bySwimmer[r.swimmerId] || []).filter(function (x) { return x.event === r.event && idx.meet[x.meetId].pool === pool; });
    return prev.length > 0 && prev.every(function (x) { return r.time < x.time; });
  }

  function notifyResult(r, isPb) {
    if (user.follows.indexOf(r.swimmerId) < 0) return;
    const s = idx.swimmer[r.swimmerId], m = idx.meet[r.meetId];
    const title = name(s) + (isPb ? ' kişisel rekor kırdı!' : ' yeni derece');
    const text = D.eventName(r.event) + ': ' + fmt(r.time) + ' · ' + m.name;
    pushNotification(title, text, '#/swimmer/' + s.id);
  }

  function pushNotification(title, text, link) {
    user.notifications.push({ id: Date.now(), title: title, text: text, link: link, read: false });
    if (user.notifications.length > 100) user.notifications = user.notifications.slice(-100);
    saveUser();
    if (notifPermission() !== 'granted') return;
    if (android && android.showNotification) { android.showNotification(title, text, link || ''); return; }
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(title, { body: text, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', data: { link: link } });
      }).catch(function () { try { new Notification(title, { body: text }); } catch (e) { /* yok */ } });
    } else {
      try { new Notification(title, { body: text }); } catch (e) { /* yok */ }
    }
  }

  function notifPermission() {
    if (android && android.notifPermission) return android.notifPermission();
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  function requestNotif() {
    if (android && android.requestNotif) { android.requestNotif(); return; }
    if (!('Notification' in window)) { toast('Bu tarayıcı bildirimleri desteklemiyor'); return; }
    Notification.requestPermission().then(function (p) {
      toast(p === 'granted' ? 'Bildirimler açıldı' : 'Bildirim izni verilmedi');
      render();
    });
  }
  window.kulvarNotifChanged = function () { render(); };

  function updateBell() {
    const unread = user.notifications.some(function (n) { return !n.read; });
    document.getElementById('bellDot').hidden = !unread;
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }

  function parseEvent(str) {
    const v = norm(str).replace(/\s+/g, '');
    const m = /^(\d+)m?([a-z]+)/.exec(v);
    if (!m) return null;
    const st = m[2];
    const style = /^ser|^fre/.test(st) ? 'SER' : /^sir|^srt|^bac/.test(st) ? 'SRT' : /^kur|^bre/.test(st) ? 'KUR' : /^kel|^fly|^but/.test(st) ? 'KEL' : /^kar|^im|^med/.test(st) ? 'KAR' : null;
    const code = m[1] + style;
    return style && D.EVENTS.indexOf(code) >= 0 ? code : null;
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { toast('CSV boş görünüyor'); return; }
    const head = rows[0].map(function (h) { return norm(h).replace(/[^a-z_]/g, ''); });
    const col = function (names) { for (let i = 0; i < names.length; i++) { const j = head.indexOf(names[i]); if (j >= 0) return j; } return -1; };
    const C = {
      meet: col(['yaris', 'yarisma', 'meet']), date: col(['tarih', 'date']), city: col(['sehir', 'city']), pool: col(['havuz', 'pool']),
      first: col(['ad', 'adi', 'first']), last: col(['soyad', 'soyadi', 'last']), by: col(['dogum_yili', 'dogumyili', 'yil', 'birthyear']),
      gender: col(['cinsiyet', 'gender']), club: col(['kulup', 'club']), event: col(['brans', 'event']), time: col(['derece', 'sure', 'time'])
    };
    const required = ['meet', 'date', 'first', 'last', 'by', 'gender', 'event', 'time'];
    const missing = required.filter(function (k) { return C[k] < 0; });
    if (missing.length) { toast('Eksik sütun: ' + missing.join(', ')); return; }
    let added = 0, skipped = 0, newSw = 0, newMeets = 0;
    const errors = [];
    const notifs = [];
    rows.slice(1).forEach(function (row, i) {
      const get = function (k) { return C[k] >= 0 ? String(row[C[k]] || '').trim() : ''; };
      const time = parseTimeInput(get('time'));
      const ev = parseEvent(get('event'));
      const g = /^(k|f|w|kad)/i.test(get('gender')) ? 'K' : 'E';
      const by = Number(get('by'));
      const date = get('date').replace(/^(\d{2})[./](\d{2})[./](\d{4})$/, '$3-$2-$1');
      if (!time || !ev || !by || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !get('first')) { skipped++; if (errors.length < 3) errors.push('Satır ' + (i + 2)); return; }
      const pool = get('pool') === '25' ? 25 : 50;
      let meet = db.meets.find(function (m) { return norm(m.name) === norm(get('meet')) && m.date === date && m.pool === pool; });
      if (!meet) { meet = { id: uid('m'), name: get('meet'), city: get('city') || '-', date: date, pool: pool }; db.meets.push(meet); idx.meet[meet.id] = meet; idx.byMeet[meet.id] = []; newMeets++; }
      let club = null;
      if (get('club')) {
        club = db.clubs.find(function (c) { return norm(c.name) === norm(get('club')); });
        if (!club) { club = { id: uid('c'), name: get('club'), city: get('city') || '-' }; db.clubs.push(club); idx.club[club.id] = club; }
      }
      let s = db.swimmers.find(function (x) { return norm(x.first) === norm(get('first')) && norm(x.last) === norm(get('last')) && x.birthYear === by; });
      if (!s) { s = { id: uid('s'), first: get('first'), last: get('last'), birthYear: by, gender: g, clubId: club ? club.id : '' }; db.swimmers.push(s); idx.swimmer[s.id] = s; idx.bySwimmer[s.id] = []; newSw++; }
      const dup = idx.bySwimmer[s.id].some(function (r) { return r.meetId === meet.id && r.event === ev; });
      if (dup) { skipped++; return; }
      const r = { id: uid('r'), meetId: meet.id, swimmerId: s.id, event: ev, time: time };
      const isPb = checkPb(r);
      db.results.push(r); idx.bySwimmer[s.id].push(r); idx.byMeet[meet.id].push(r);
      if (user.follows.indexOf(s.id) >= 0) notifs.push([r, isPb]);
      added++;
    });
    saveDb();
    notifs.forEach(function (n) { notifyResult(n[0], n[1]); });
    toast(added + ' derece eklendi · ' + newMeets + ' yeni yarış · ' + newSw + ' yeni sporcu' + (skipped ? ' · ' + skipped + ' satır atlandı' + (errors.length ? ' (' + errors.join(', ') + ')' : '') : ''), 6000);
    render();
  }

  // ---------- Dosya ----------
  function readFile(input, cb) {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = function () { cb(String(rd.result)); input.value = ''; };
    rd.readAsText(f, 'utf-8');
  }

  function downloadFile(filename, text, mime) {
    if (android && android.saveFile) {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      const where = android.saveFile(filename, b64, mime);
      toast(where ? 'Kaydedildi: ' + where : 'Kaydedilemedi');
      return;
    }
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function shareText(text) {
    if (android && android.shareText) { android.shareText(text); return; }
    if (navigator.share) { navigator.share({ text: text }).catch(function () { /* iptal */ }); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Panoya kopyalandı'); });
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2500);
  }

  // ---------- Otomatik veri (sunucu) ----------
  const SYNC_EVERY = 10 * 60 * 1000;
  let syncing = false;

  function hasRemoteData() { return db.results.some(function (r) { return r.src === 'remote'; }); }
  function fdatetime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return fdate(iso.slice(0, 10)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function syncCard() {
    const s = user.sync || {};
    const remote = hasRemoteData();
    const counts = { m: 0, r: 0 };
    db.meets.forEach(function (m) { if (m.src === 'remote') counts.m++; });
    db.results.forEach(function (r) { if (r.src === 'remote') counts.r++; });
    return '<div class="card"><div class="card-head"><b>Otomatik Veri</b><span class="tag">' + (remote ? 'Resmi veri' : 'Demo veri') + '</span></div>' +
      '<p>' + (remote ? counts.m + ' yarış · ' + counts.r + ' derece. Uygulama açıldığında sunucudan kendiliğinden güncellenir.'
        : 'Sunucuda henüz resmi sonuç yok; örnek veriler gösteriliyor. Sonuçlar eklendiğinde demo veriler kendiliğinden kalkar.') + '</p>' +
      '<div class="kv"><span>Veri tarihi</span><b>' + fdatetime(s.updatedAt) + '</b></div>' +
      '<div class="kv"><span>Son kontrol</span><b>' + fdatetime(s.checkedAt) + '</b></div>' +
      (s.error ? '<p class="muted small">Son deneme başarısız: internet bağlantısı yok veya sunucuya ulaşılamadı.</p>' : '') +
      '<button class="btn wide" data-action="sync-now">' + (syncing ? 'Güncelleniyor…' : 'Şimdi güncelle') + '</button></div>';
  }

  function fetchJson(url) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    const u = /^https?:/.test(url) ? url + '?t=' + Date.now() : url;
    return fetch(u, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { clearTimeout(timer); return d; }, function (e) { clearTimeout(timer); throw e; });
  }

  function firstAvailable(urls, i) {
    if (i >= urls.length) return Promise.reject(new Error('erişilemedi'));
    return fetchJson(urls[i]).then(function (d) {
      if (!d || d.app !== 'kulvar' || !Array.isArray(d.results) || !d.updatedAt) throw new Error('biçim');
      return d;
    }).catch(function () { return firstAvailable(urls, i + 1); });
  }

  function syncRemote(manual) {
    if (syncing) return;
    syncing = true;
    if (manual) render();
    firstAvailable(D.REMOTE_URLS, 0).then(function (d) {
      const s = user.sync = user.sync || {};
      s.checkedAt = new Date().toISOString(); s.error = '';
      // Aynı ya da daha eski sürüm (ör. çevrimdışıyken uygulamayla gelen kopya) uygulanmaz
      if (d.version === s.version || (s.updatedAt && d.updatedAt < s.updatedAt)) {
        if (manual) toast('Veriler güncel');
        return;
      }
      const added = applyRemote(d);
      s.version = d.version; s.updatedAt = d.updatedAt;
      if (manual || added) toast(added ? added + ' yeni derece geldi' : 'Veriler güncellendi');
    }).catch(function () {
      user.sync = Object.assign(user.sync || {}, { checkedAt: new Date().toISOString(), error: 'offline' });
      if (manual) toast('Güncellenemedi: internet bağlantısını kontrol edin');
    }).then(function () {
      syncing = false;
      saveUser();
      render();
    });
  }

  // Sunucu verisini yerleştirir; elle eklenen kayıtlar korunur. Dönen değer: yeni derece sayısı.
  function applyRemote(d) {
    const prev = {};
    db.results.forEach(function (r) { if (r.src === 'remote') prev[r.id] = 1; });
    const hadRemote = Object.keys(prev).length > 0;
    const real = d.results.length > 0;
    const keep = function (x) { return x.src !== 'remote' && !(real && x.src === 'demo'); };
    const tag = function (x) { return Object.assign({}, x, { src: 'remote' }); };
    db.clubs = db.clubs.filter(keep).concat((d.clubs || []).map(tag));
    db.swimmers = db.swimmers.filter(keep).concat((d.swimmers || []).map(tag));
    db.meets = db.meets.filter(keep).concat((d.meets || []).map(tag));
    db.results = db.results.filter(keep).concat(d.results.map(tag));
    const recs = d.records || [];
    db.records = db.records.filter(function (r) {
      if (r.src === 'remote') return false;
      return !(r.src === 'demo' && recs.some(function (x) { return x.scope === r.scope; }));
    }).concat(recs.map(tag));
    saveDb();
    dropMissingFollows();
    const fresh = db.results.filter(function (r) { return r.src === 'remote' && !prev[r.id]; });
    if (hadRemote) {
      const mine = fresh.filter(function (r) { return user.follows.indexOf(r.swimmerId) >= 0; });
      mine.slice(0, 10).forEach(function (r) { notifyResult(r, isPbAmong(r)); });
      if (mine.length > 10) pushNotification('Takip ettiklerinize ' + mine.length + ' yeni derece', 'Ayrıntılar için sporcu sayfalarına bakın', '#/profile');
    }
    return hadRemote ? fresh.length : 0;
  }

  function isPbAmong(r) {
    const pool = idx.meet[r.meetId].pool;
    const others = idx.bySwimmer[r.swimmerId].filter(function (x) { return x !== r && x.event === r.event && idx.meet[x.meetId].pool === pool; });
    return others.length > 0 && others.every(function (x) { return r.time < x.time; });
  }

  function removeDemo() {
    const demo = function (x) { return x.src !== 'demo'; };
    db.clubs = db.clubs.filter(demo); db.swimmers = db.swimmers.filter(demo);
    db.meets = db.meets.filter(demo); db.results = db.results.filter(demo);
  }

  function dropMissingFollows() {
    user.follows = user.follows.filter(function (id) { return idx.swimmer[id]; });
    saveUser();
  }

  document.addEventListener('visibilitychange', function () {
    const last = user.sync && user.sync.checkedAt ? new Date(user.sync.checkedAt).getTime() : 0;
    if (document.visibilityState === 'visible' && Date.now() - last > SYNC_EVERY) syncRemote(false);
  });

  // ---------- Başlat ----------
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !android) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* çevrimdışı desteği yok */ });
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.link) location.hash = e.data.link;
    });
  }
  render();
  syncRemote(false);
})();
