/* Golf Outing Sweep - UI. Vanilla JS, no dependencies. All data lives in localStorage. */
(function () {
  'use strict';
  var C = window.Core;
  var KEY = 'golf-outing-sweep.v1';
  var DEFAULT_SETTINGS = {
    appName: 'Golf Outing Sweep', contribution: 10, currency: '\u00A3', requirePay: true,
    pinHash: '', pinSalt: '', reelSecs: 4, sound: true, vibrate: true, reduceMotion: false, autoHide: 15
  };

  /* ---------- State & storage ---------- */
  var storageOk = true;
  function fresh() { return { v: 1, settings: Object.assign({}, DEFAULT_SETTINGS), players: [], outing: null, history: [], draft: null, kiosk: false }; }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOk = false; return fresh(); }
    if (!raw) return fresh();
    try {
      var d = JSON.parse(raw), f = fresh();
      var s = Object.assign(f, d);
      s.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
      return s;
    } catch (e) {
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (_) { /* ignore */ }
      return fresh();
    }
  }

  var S = load();
  var PR = null; /* practice outing (memory only) */
  var ui = { view: 'home', org: false, practice: false, q: '', filter: 'all', dsort: 'name', hide: true, drawer: null, prizeIdx: 0, prizeAll: false, showArchived: false, modal: null, xnew: 'Nearest the pin', pasteOpen: false };

  function save() {
    if (ui.practice) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
      if (!storageOk) { storageOk = true; render(); }
    } catch (e) {
      if (storageOk) { storageOk = false; render(); }
    }
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

  function ctx() { return ui.practice ? PR : S.outing; }
  var now = function () { return Date.now(); };
  var cur = function () { return S.settings.currency || '\u00A3'; };
  var money = function (v) { return C.money(v, cur()); };
  var pinSet = function () { return !!S.settings.pinHash; };

  /* ---------- DOM helpers ---------- */
  var app = document.getElementById('app');
  var esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ic = function (n, c) { return '<svg class="i ' + (c || '') + '" aria-hidden="true" focusable="false"><use href="#i-' + n + '"/></svg>'; };
  var byName = function (a, b) { return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }); };
  var pdisp = function (p) { return p.name + (p.label ? ' (' + p.label + ')' : ''); };
  var norm = function (s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); };
  var badge = function (cls, icon, text) { return '<span class="badge ' + cls + '">' + ic(icon) + text + '</span>'; };
  var paidBadge = function (p) { return p ? badge('ok', 'check', 'Paid') : badge('warn', 'clock', 'Unpaid'); };
  var pickBadge = function (p) { return p ? badge('ok', 'check', 'Picked') : badge('mute', 'clock', 'Still to pick'); };
  var stat = function (v, l, icon) { return '<div class="stat"><div class="stat-ico">' + ic(icon) + '</div><div class="stat-v">' + v + '</div><div class="stat-l">' + l + '</div></div>'; };

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2600);
  }

  function reduced() {
    return S.settings.reduceMotion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function shareText(title, text) {
    if (navigator.share) {
      navigator.share({ title: title, text: text }).catch(function () { /* cancelled */ });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); }, function () { download('summary.txt', text); });
    } else { download('summary.txt', text); }
  }

  var slug = function (s) { return String(s || 'outing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'outing'; };

  /* ---------- Sound & haptics ---------- */
  var AC = null;
  function audio() {
    if (!S.settings.sound) return null;
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
    } catch (e) { AC = null; }
    return AC;
  }
  function beep(freq, dur, vol, type, when) {
    var a = audio(); if (!a) return;
    var t = a.currentTime + (when || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function buzz(p) { if (S.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* ignore */ } } }

  /* ---------- Modal helpers ---------- */
  function openModal(m) { ui.modal = m; render(); }
  function closeModal() { ui.modal = null; render(); }
  function confirmBox(o) { openModal(Object.assign({ type: 'box', cancel: 'Cancel', ok: 'Confirm' }, o)); }

  function pinModal(title, sub, cb) {
    var m = { type: 'pin', title: title, sub: sub, buf: '', err: '', cb: cb };
    openModal(m);
  }

  function enterOrganiser() {
    if (pinSet()) {
      pinModal('Organiser PIN', 'Enter your 4-digit PIN', function (pin) {
        return C.hashPin(pin, S.settings.pinSalt).then(function (h) {
          if (h !== S.settings.pinHash) return 'Incorrect PIN';
          grantOrganiser(); return true;
        });
      });
    } else {
      openModal({ type: 'hold' });
    }
  }
  function grantOrganiser() {
    ui.org = true; S.kiosk = false; ui.modal = null; ui.view = 'home'; save(); render();
  }
  function startKiosk(id) {
    ui.org = false; S.kiosk = true; ui.q = ''; ui.drawer = id || null; ui.modal = null;
    ui.view = id ? 'pickconfirm' : 'pickwho'; save(); render();
  }

  /* ---------- Shared pieces ---------- */
  function noOuting() {
    return { t: 'No active outing', back: 'home', b: '<section class="card center"><div class="big-ico">' + ic('flag') + '</div><h2>No active outing</h2><p class="muted">Create a new outing to start collecting and drawing.</p><button class="btn btn-gold" data-act="go" data-v="setup">' + ic('plus') + 'Create New Outing</button></section>' };
  }
  function chips(list, cur_) {
    return '<div class="chips" role="group">' + list.map(function (c) {
      return '<button class="chip ' + (cur_ === c[0] ? 'on' : '') + '" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (cur_ === c[0]) + '">' + c[1] + '</button>';
    }).join('') + '</div>';
  }
  function searchBox(ph) {
    return '<label class="search">' + ic('search') + '<input id="q" type="search" placeholder="' + ph + '" value="' + esc(ui.q) + '" data-bind="ui.q" data-live="1" autocomplete="off" autocapitalize="off" aria-label="' + ph + '"></label>';
  }
  function activePlayers() { return S.players.filter(function (p) { return !p.archived; }).sort(byName); }

  /* ---------- Views ---------- */
  var V = {};
  var KIOSK_VIEWS = ['pickwho', 'pickconfirm', 'pickgo', 'reel', 'resume', 'unpaidmsg', 'locked'];

  /* HOME */
  V.home = function () {
    var o = S.outing, b = '';
    if (!o) {
      b += '<section class="card hero"><div class="hero-ico">' + ic('flag') + '</div><h2>No active outing</h2><p class="muted">Set up an outing, choose who\u2019s playing, then hand the phone round for the draw.</p><button class="btn btn-gold btn-lg" data-act="go" data-v="setup">' + ic('plus') + 'Create New Outing</button></section>';
    } else {
      var n = o.participants.length, paid = C.paidCount(o), picked = C.pickedCount(o), left = n - picked;
      var label, act, v;
      if (picked >= n) { label = o.results.first ? 'Open Prize Giving' : 'Enter Results'; act = 'go'; v = o.results.first ? 'prize' : 'results'; }
      else if (picked === 0 && paid < n && S.settings.requirePay) { label = 'Continue Collecting'; act = 'go'; v = 'pay'; }
      else { label = 'Continue Draw'; act = 'kiosk'; v = ''; }
      b += '<section class="card outing-card"><div class="eyebrow">Current outing</div><h2>' + esc(o.name) + '</h2><div class="muted">' + esc(C.fmtDate(o.date)) + '</div>' +
        '<div class="stats">' + stat(n, 'Golfers', 'users') + stat(paid, 'Paid', 'coin') + stat(picked, 'Picked', 'check') + stat(left, 'Still to pick', 'clock') + '</div>' +
        '<div class="pot"><span>Collected</span><strong>' + money(C.collected(o)) + '</strong><span class="muted">of ' + money(n * o.contribution) + '</span></div>' +
        '<button class="btn btn-gold btn-lg" data-act="' + act + '" data-v="' + v + '">' + ic('play') + label + '</button></section>';
      if (o.pending) b += '<section class="card warn-card"><b>' + ic('warn') + 'A draw was interrupted</b><p>' + esc(C.nm(o, o.pending)) + '\u2019s result is safe. It can be shown again from the player screen; nobody can draw twice.</p></section>';
      b += '<div class="grid2"><button class="tile" data-act="go" data-v="still">' + ic('list') + '<span>Still to Pick</span><em>' + left + '</em></button>' +
        '<button class="tile" data-act="kiosk">' + ic('users') + '<span>Player Draw Mode</span></button></div>';
    }
    b += '<div class="grid3"><button class="tile sm" data-act="go" data-v="players">' + ic('users') + '<span>Players</span></button><button class="tile sm" data-act="go" data-v="history">' + ic('clock') + '<span>Previous Outings</span></button><button class="tile sm" data-act="go" data-v="settings">' + ic('cog') + '<span>Settings</span></button></div>';
    return { t: S.settings.appName, home: true, b: b };
  };

  /* PLAYERS */
  V.players = function () {
    var q = norm(ui.q);
    var list = S.players.filter(function (p) { return !!p.archived === ui.showArchived && (!q || norm(pdisp(p)).indexOf(q) > -1); }).sort(byName);
    var b = '<section class="card"><h3>Add a player</h3><div class="row-form"><input id="pn" type="text" placeholder="Name" autocomplete="off" aria-label="Player name"><input id="pl" type="text" placeholder="Label (optional)" autocomplete="off" aria-label="Distinguishing label"></div><div class="row-actions"><button class="btn btn-primary" data-act="p-add">' + ic('plus') + 'Add player</button><button class="btn btn-ghost" data-act="p-paste">Paste many</button></div></section>';
    b += searchBox('Search players');
    b += '<div class="list-head"><h3>' + (ui.showArchived ? 'Archived players' : 'Master list') + ' <span class="count">' + list.length + '</span></h3><button class="link" data-act="p-archived-toggle">' + (ui.showArchived ? 'Show current' : 'Show archived') + '</button></div>';
    if (!list.length) b += '<div class="empty">' + (S.players.length ? 'No matches.' : 'No players yet. Add names above, or paste a list.') + '</div>';
    b += '<div class="list">' + list.map(function (p) {
      return '<div class="item"><div class="grow"><b>' + esc(p.name) + '</b>' + (p.label ? '<span class="tag">' + esc(p.label) + '</span>' : '') + '</div>' +
        (ui.showArchived ? '<button class="icon-btn" data-act="p-restore" data-id="' + p.id + '" aria-label="Restore ' + esc(p.name) + '">' + ic('undo') + '</button>' :
          '<button class="icon-btn" data-act="p-edit" data-id="' + p.id + '" aria-label="Edit ' + esc(p.name) + '">' + ic('edit') + '</button><button class="icon-btn" data-act="p-archive" data-id="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">' + ic('archive') + '</button>') + '</div>';
    }).join('') + '</div>';
    b += '<p class="hint">Removed players are archived, so past outings keep their names.</p>';
    return { t: 'Players', b: b };
  };

  function dupCheck(name, label, exceptId) {
    var n = norm(name), l = norm(label);
    var same = S.players.filter(function (p) { return p.id !== exceptId && !p.archived && norm(p.name) === n; });
    if (same.some(function (p) { return norm(p.label) === l; })) return 'exact';
    if (same.length && !l) return 'needlabel';
    return same.length ? 'labelled' : 'ok';
  }

  /* SETUP */
  function draftInit() {
    if (!S.draft) S.draft = { name: '', date: C.today(), contribution: S.settings.contribution, sel: {}, guests: [], step: 1 };
    return S.draft;
  }
  function draftParticipants(d) {
    var a = activePlayers().filter(function (p) { return d.sel[p.id]; }).map(function (p) { return { id: p.id, name: pdisp(p) }; });
    return a.concat(d.guests.map(function (g) { return { id: g.id, name: g.name }; }));
  }
  V.setup = function () {
    if (S.outing) return { t: 'Set Up Outing', back: 'home', b: '<section class="card center"><h2>An outing is in progress</h2><p class="muted">Complete or reset the current outing before starting another.</p><button class="btn btn-primary" data-act="go" data-v="home">Back to Home</button></section>' };
    var d = draftInit();
    var parts = draftParticipants(d), n = parts.length, c = +d.contribution || 0;
    if (d.step === 2) {
      var dupNames = {}, dup = false;
      parts.forEach(function (p) { var k = norm(p.name); if (dupNames[k]) dup = true; dupNames[k] = 1; });
      var b2 = '<section class="card"><div class="eyebrow">Confirm outing</div><h2>' + esc(d.name || 'Golf Outing') + '</h2><div class="muted">' + esc(C.fmtDate(d.date)) + '</div><div class="stats three">' + stat(n, 'Golfers', 'users') + stat(money(c), 'Each', 'coin') + stat(money(n * c), 'Potential pot', 'trophy') + '</div></section>';
      if (dup) b2 += '<section class="card warn-card"><b>' + ic('warn') + 'Two golfers have the same name</b><p>Go back and give one of them a label (or edit the guest name) so they can be told apart.</p></section>';
      b2 += '<section class="card"><h3>Participants</h3><div class="chips wrap">' + parts.slice().sort(byName).map(function (p) { return '<span class="chip static">' + esc(p.name) + '</span>'; }).join('') + '</div></section>';
      b2 += '<div class="sticky-actions"><button class="btn btn-ghost" data-act="d-back">' + ic('back') + 'Edit</button><button class="btn btn-gold" data-act="d-start" ' + (dup || n < 2 ? 'disabled' : '') + '>' + ic('play') + 'Start collection &amp; draw</button></div>';
      return { t: 'Confirm Outing', b: b2 };
    }
    var pl = activePlayers();
    var b = '<section class="card"><label class="lbl" for="on">Outing name</label><input id="on" type="text" value="' + esc(d.name) + '" placeholder="e.g. Autumn Medal" data-bind="draft.name" autocomplete="off"><div class="row-form"><div><label class="lbl" for="od">Date</label><input id="od" type="date" value="' + esc(d.date) + '" data-bind="draft.date"></div><div><label class="lbl" for="oc">Sweep (' + esc(cur()) + ')</label><input id="oc" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(d.contribution) + '" data-bind="draft.contribution" data-num="1" data-live="1"></div></div></section>';
    b += '<section class="card summary-bar"><div><b>' + n + '</b> golfers</div><div><b>' + money(c) + '</b> each</div><div><b>' + money(n * c) + '</b> pot</div></section>';
    b += '<div class="list-head"><h3>Who\u2019s playing?</h3><div><button class="link" data-act="d-all">Select all</button> \u00B7 <button class="link" data-act="d-none">Clear</button></div></div>';
    if (!pl.length) b += '<div class="empty">Your master list is empty. <button class="link" data-act="go" data-v="players">Add players</button> or add guests below.</div>';
    b += '<div class="list">' + pl.map(function (p) {
      var on = !!d.sel[p.id];
      return '<button class="toggle ' + (on ? 'on' : '') + '" data-act="d-toggle" data-id="' + p.id + '" aria-pressed="' + on + '"><span class="tick">' + ic('check') + '</span><span class="grow">' + esc(pdisp(p)) + '</span></button>';
    }).join('') + '</div>';
    b += '<section class="card"><h3>Add a guest</h3><div class="row-form one"><input id="gn" type="text" placeholder="Guest name" autocomplete="off" aria-label="Guest name"></div><button class="btn btn-ghost" data-act="d-guest-add">' + ic('plus') + 'Add guest</button>' +
      (d.guests.length ? '<div class="chips wrap mt">' + d.guests.map(function (g) { return '<span class="chip static">' + esc(g.name) + '<button class="chip-x" data-act="d-guest-rm" data-id="' + g.id + '" aria-label="Remove ' + esc(g.name) + '">' + ic('x') + '</button></span>'; }).join('') + '</div>' : '') + '</section>';
    b += '<div class="sticky-actions"><button class="btn btn-primary" data-act="d-review" ' + (n < 2 ? 'disabled' : '') + '>Review outing' + ic('back', 'flip') + '</button></div>';
    if (n < 2) b += '<p class="hint center">At least two golfers are needed.</p>';
    return { t: 'Set Up Outing', back: 'home', b: b };
  };

  /* PAYMENTS */
  V.pay = function () {
    var o = S.outing; if (!o) return noOuting();
    var f = ui.filter;
    var list = o.participants.filter(function (p) { return f === 'all' || (f === 'paid') === !!o.paid[p.id]; }).sort(byName);
    var b = '<section class="card summary-bar"><div><b>' + C.paidCount(o) + '/' + o.participants.length + '</b> paid</div><div><b>' + money(C.collected(o)) + '</b> collected</div><div><b>' + money(o.participants.length * o.contribution) + '</b> due</div></section>';
    b += chips([['all', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid']], f);
    b += '<div class="list">' + list.map(function (p) {
      var pd = !!o.paid[p.id];
      return '<div class="item"><div class="grow"><b>' + esc(p.name) + '</b><div class="sub">' + pickBadge(o.revealed[p.id]) + '</div></div>' +
        '<button class="pay-btn ' + (pd ? 'is-paid' : '') + '" data-act="pay-toggle" data-id="' + p.id + '" aria-pressed="' + pd + '" aria-label="' + esc(p.name) + (pd ? ' paid. Tap to reverse' : ' unpaid. Tap to mark paid') + '">' + (pd ? ic('check') + 'Paid' : 'Mark paid') + '</button></div>';
    }).join('') + '</div>';
    if (!list.length) b += '<div class="empty">Nobody in this view.</div>';
    b += '<p class="hint">' + (S.settings.requirePay ? 'Golfers must be marked paid before they can draw.' : 'Golfers can draw before paying (see Settings).') + '</p>';
    return { t: 'Payments', b: b };
  };

  /* STILL TO PICK */
  V.still = function () {
    var o = S.outing; if (!o) return noOuting();
    var all = o.participants.filter(function (p) { return !o.revealed[p.id]; });
    var pd = all.filter(function (p) { return o.paid[p.id]; }).length;
    var list = all.filter(function (p) { return ui.filter === 'all' || (ui.filter === 'paid') === !!o.paid[p.id]; }).sort(byName);
    var b = '<section class="card summary-bar"><div><b>' + all.length + '</b> still to pick</div><div><b>' + pd + '</b> paid</div><div><b>' + (all.length - pd) + '</b> unpaid</div></section>';
    if (!all.length) {
      b += '<section class="card success center"><div class="big-ico">' + ic('trophy') + '</div><h2>All players have made their selection.</h2><button class="btn btn-gold" data-act="go" data-v="' + (o.results.first ? 'prize' : 'results') + '">' + (o.results.first ? 'Open Prize Giving' : 'Enter Results') + '</button></section>';
    } else {
      b += chips([['all', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid']], ui.filter);
      b += '<div class="list">' + list.map(function (p) {
        var pdd = !!o.paid[p.id], can = pdd || !S.settings.requirePay;
        return '<div class="item col"><div class="between"><b>' + esc(p.name) + '</b><span>' + paidBadge(pdd) + ' ' + pickBadge(false) + '</span></div><div class="row-actions">' +
          (pdd ? '' : '<button class="btn btn-small btn-ghost" data-act="pay-toggle" data-id="' + p.id + '">' + ic('coin') + 'Mark paid</button>') +
          '<button class="btn btn-small btn-primary" data-act="begin-as" data-id="' + p.id + '" ' + (can ? '' : 'disabled') + '>' + ic('play') + 'Start draw</button></div></div>';
      }).join('') + '</div>';
      if (!list.length) b += '<div class="empty">Nobody in this view.</div>';
    }
    b += '<div class="grid2"><button class="btn btn-gold" data-act="kiosk">' + ic('users') + 'Player screen</button><button class="btn btn-ghost" data-act="go" data-v="status">' + ic('list') + 'All-player status</button></div>';
    return { t: 'Still to Pick', b: b };
  };

  /* STATUS */
  V.status = function () {
    var o = S.outing; if (!o) return noOuting();
    var f = ui.filter;
    var list = o.participants.filter(function (p) {
      if (f === 'unpaid') return !o.paid[p.id];
      if (f === 'pending') return !o.revealed[p.id];
      return true;
    }).sort(byName);
    var b = '<section class="card summary-bar"><div><b>' + C.paidCount(o) + '</b> paid</div><div><b>' + C.pickedCount(o) + '</b> picked</div><div><b>' + (o.participants.length - C.pickedCount(o)) + '</b> to pick</div></section>';
    b += chips([['all', 'All'], ['unpaid', 'Unpaid'], ['pending', 'Still to pick']], f);
    b += '<div class="list">' + list.map(function (p) {
      return '<div class="item col"><div class="between"><b>' + esc(p.name) + '</b></div><div class="badges">' + paidBadge(o.paid[p.id]) + pickBadge(o.revealed[p.id]) + '</div></div>';
    }).join('') + '</div>';
    return { t: 'All-Player Status', back: 'still', b: b };
  };

  /* DRAW LIST */
  V.drawlist = function () {
    var o = S.outing; if (!o) return noOuting();
    var inv = o.alloc || {};
    var sort = ui.dsort;
    if (ui.hide && sort === 'golfer') sort = 'name';
    var rows = o.participants.slice().sort(function (a, b) {
      if (sort === 'golfer') return C.nm(o, inv[a.id]).localeCompare(C.nm(o, inv[b.id]));
      if (sort === 'pay') return (!!o.paid[b.id] - !!o.paid[a.id]) || byName(a, b);
      if (sort === 'sel') return (!!o.revealed[b.id] - !!o.revealed[a.id]) || byName(a, b);
      return byName(a, b);
    });
    var n = o.participants.length;
    var b = '<section class="card summary-bar wrap"><div><b>' + n + '</b> golfers</div><div><b>' + C.paidCount(o) + '</b> paid</div><div><b>' + money(C.collected(o)) + '</b> collected</div><div><b>' + C.pickedCount(o) + '</b> drawn</div><div><b>' + (n - C.pickedCount(o)) + '</b> to draw</div></section>';
    b += '<div class="toolbar"><label class="sel-wrap"><span class="sr">Sort by</span><select data-bind="ui.dsort" data-live="1" aria-label="Sort by"><option value="name" ' + (sort === 'name' ? 'selected' : '') + '>Sort: Drawer</option>' + (ui.hide ? '' : '<option value="golfer" ' + (sort === 'golfer' ? 'selected' : '') + '>Sort: Golfer drawn</option>') + '<option value="pay" ' + (sort === 'pay' ? 'selected' : '') + '>Sort: Payment</option><option value="sel" ' + (sort === 'sel' ? 'selected' : '') + '>Sort: Selection</option></select></label>' +
      '<button class="btn btn-small btn-ghost" data-act="dl-hide">' + ic(ui.hide ? 'eye' : 'eyeoff') + (ui.hide ? 'Show drawn' : 'Hide drawn') + '</button></div>';
    if (!o.alloc) b += '<div class="empty">The draw is created when the first golfer picks. Nothing has been drawn yet.</div>';
    b += '<div class="list dl">' + rows.map(function (p) {
      var g = o.alloc ? (ui.hide ? '\u2022\u2022\u2022\u2022\u2022\u2022' : esc(C.nm(o, o.alloc[p.id]))) : '\u2014';
      return '<details class="item col dl-row"><summary><div class="dl-main"><span class="dl-a">' + esc(p.name) + '</span><span class="dl-arrow">' + ic('back', 'flip') + '</span><span class="dl-b">' + g + '</span></div><div class="badges">' + paidBadge(o.paid[p.id]) + pickBadge(o.revealed[p.id]) + '</div></summary><div class="audit">Revealed: ' + esc(C.fmtTime(o.revealed[p.id])) + '<br>Confirmed done: ' + esc(C.fmtTime(o.done[p.id])) + '</div></details>';
    }).join('') + '</div>';
    b += '<p class="hint">Draw created: ' + esc(C.fmtTime(o.allocAt)) + ' \u00B7 Tap a row for its audit trail.</p>';
    b += '<div class="grid2"><button class="btn btn-ghost" data-act="dl-csv">' + ic('download') + 'CSV</button><button class="btn btn-ghost" data-act="dl-share">' + ic('share') + 'Share text</button></div>';
    b += '<section class="card danger-zone"><h3>Danger zone</h3><p class="muted">Resetting the draw invalidates every previous selection.</p><div class="row-actions"><button class="btn btn-danger btn-small" data-act="reset-draw" ' + (o.alloc ? '' : 'disabled') + '>Reset draw</button><button class="btn btn-danger btn-small" data-act="cancel-outing">Cancel outing</button></div></section>';
    return { t: 'Organiser\u2019s Draw List', back: 'more', b: b };
  };

  /* MORE */
  V.more = function () {
    var items = [['drawlist', 'list', 'Organiser\u2019s Draw List', 'Who drew whom'], ['status', 'check', 'All-Player Status', 'Payments and picks'], ['results', 'medal', 'Enter Results', 'Finishing positions and prizes'], ['prize', 'trophy', 'Prize Giving', 'Reveal the winners'], ['history', 'clock', 'Outing History', 'Past outings'], ['practice', 'play', 'Practice Draw', 'Try the reel safely'], ['settings', 'cog', 'Settings & Backup', 'PIN, sound, export']];
    var b = '<div class="list">' + items.map(function (i) { return '<button class="menu-row" data-act="go" data-v="' + i[0] + '">' + ic(i[1]) + '<span class="grow"><b>' + i[2] + '</b><small>' + i[3] + '</small></span>' + ic('back', 'flip muted') + '</button>'; }).join('') + '</div>';
    b += '<button class="btn btn-primary mt" data-act="kiosk">' + ic('lock') + 'Switch to Player Draw Mode</button>';
    return { t: 'More', b: b };
  };

  /* RESULTS */
  var PRESETS = ['Nearest the pin', 'Longest drive', 'Nearest the pin in two', 'Best front nine', 'Best back nine', 'Two\u2019s competition', 'Custom prize'];
  function pSelect(o, path, val, taken) {
    return '<select data-bind="' + path + '" data-live="1"><option value="">\u2014 choose golfer \u2014</option>' + o.participants.slice().sort(byName).map(function (p) {
      return '<option value="' + p.id + '" ' + (p.id === val ? 'selected' : '') + ((taken.indexOf(p.id) > -1 && p.id !== val) ? ' disabled' : '') + '>' + esc(p.name) + '</option>';
    }).join('') + '</select>';
  }
  V.results = function () {
    var o = S.outing; if (!o) return noOuting();
    var taken = ['first', 'second', 'third', 'last'].map(function (k) { return o.results[k]; }).filter(Boolean);
    var inv = o.alloc ? C.inverse(o.alloc) : {};
    var b = '';
    if (C.pickedCount(o) < o.participants.length) b += '<section class="card warn-card"><b>' + ic('warn') + 'Draw not finished</b><p>' + (o.participants.length - C.pickedCount(o)) + ' golfer(s) have not picked yet. You can still enter results.</p></section>';
    b += '<section class="card"><h3>Finishing positions</h3>';
    [['first', '1st place'], ['second', '2nd place'], ['third', '3rd place'], ['last', 'Last place']].forEach(function (x) {
      var g = o.results[x[0]];
      b += '<div class="res-row"><label class="lbl">' + x[1] + '</label>' + pSelect(o, 'outing.results.' + x[0], g, taken) +
        '<div class="row-form"><input type="number" inputmode="decimal" min="0" step="0.5" placeholder="Prize ' + esc(cur()) + ' (optional)" value="' + esc(o.prizes[x[0]]) + '" data-bind="outing.prizes.' + x[0] + '" data-num="1" aria-label="' + x[1] + ' prize amount"></div>' +
        (g ? '<div class="drawn-by">' + ic('users') + 'Drawn by <b>' + esc(inv[g] ? C.nm(o, inv[g]) : 'nobody yet') + '</b></div>' : '') + '</div>';
    });
    b += '</section>';
    b += '<section class="card"><h3>Other competitions</h3>';
    o.extras.forEach(function (x, i) {
      b += '<div class="res-row"><div class="between"><input type="text" value="' + esc(x.title) + '" data-bind="outing.extras.' + i + '.title" aria-label="Competition name" class="grow"><button class="icon-btn" data-act="x-rm" data-i="' + i + '" aria-label="Remove competition">' + ic('trash') + '</button></div>' +
        pSelect(o, 'outing.extras.' + i + '.winner', x.winner, []) +
        '<div class="row-form"><input type="number" inputmode="decimal" min="0" step="0.5" placeholder="Prize ' + esc(cur()) + ' (optional)" value="' + esc(x.prize) + '" data-bind="outing.extras.' + i + '.prize" data-num="1" aria-label="Prize amount"></div></div>';
    });
    b += '<div class="row-form one"><select data-bind="ui.xnew" aria-label="Competition type">' + PRESETS.map(function (p) { return '<option ' + (p === ui.xnew ? 'selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></div><button class="btn btn-ghost" data-act="x-add">' + ic('plus') + 'Add competition</button></section>';
    b += '<div class="sticky-actions"><button class="btn btn-gold" data-act="go" data-v="prize">' + ic('trophy') + 'Go to Prize Giving</button></div>';
    return { t: 'Enter Results', back: 'more', b: b };
  };

  /* PRIZE GIVING */
  function prizeItems(o) {
    var inv = o.alloc ? C.inverse(o.alloc) : {}, out = [];
    [['first', '1st Place', 'gold', 4], ['second', '2nd Place', 'silver', 3], ['third', '3rd Place', 'bronze', 2], ['last', 'Last Place', 'last', 1]].forEach(function (d) {
      var g = o.results[d[0]]; if (!g) return;
      out.push({ l: d[1], cls: d[2], rank: d[3], golfer: C.nm(o, g), drawer: inv[g] ? C.nm(o, inv[g]) : 'Not drawn', prize: o.prizes[d[0]] });
    });
    o.extras.forEach(function (x) { if (x.winner) out.push({ l: x.title || 'Competition', cls: 'extra', rank: 9, winner: C.nm(o, x.winner), prize: x.prize }); });
    return out;
  }
  function prizeCard(it, anim) {
    var icon = it.cls === 'gold' ? 'trophy' : it.cls === 'extra' ? 'flag' : it.cls === 'last' ? 'ball' : 'medal';
    var b = '<article class="prize ' + it.cls + (anim ? ' pop' : '') + '"><div class="prize-ico">' + ic(icon) + '</div><div class="prize-body"><div class="prize-l">' + esc(it.l) + '</div>';
    if (it.cls === 'extra') b += '<div class="prize-n">' + esc(it.winner) + '</div>';
    else b += '<div class="prize-k">Golfer</div><div class="prize-n">' + esc(it.golfer) + '</div><div class="prize-k">Draw winner</div><div class="prize-d">' + esc(it.drawer) + '</div>';
    if (it.cls === 'last') b += '<div class="prize-tag">Somebody had to.</div>';
    if (money(it.prize)) b += '<div class="prize-amt">' + money(it.prize) + '</div>';
    return b + '</div></article>';
  }
  V.prize = function () {
    var o = S.outing; if (!o) return noOuting();
    var items = prizeItems(o);
    if (!items.length) return { t: 'Prize Giving', back: 'more', b: '<section class="card center"><h2>No results yet</h2><p class="muted">Enter finishing positions first.</p><button class="btn btn-primary" data-act="go" data-v="results">Enter Results</button></section>' };
    var order = items.slice().sort(function (a, b) { return (a.cls === 'extra' ? 10 : 0) - (b.cls === 'extra' ? 10 : 0) || a.rank - b.rank; });
    var reveal = items.slice().sort(function (a, b) { return (a.cls === 'extra' ? 0 : 1) - (b.cls === 'extra' ? 0 : 1) || a.rank - b.rank; });
    var showAll = ui.prizeAll || ui.prizeIdx >= reveal.length;
    var b = '<div class="prize-head"><div class="eyebrow">' + esc(C.fmtDate(o.date)) + '</div><h2>' + esc(o.name) + '</h2></div>';
    if (showAll) {
      b += order.map(function (i) { return prizeCard(i, false); }).join('');
    } else {
      var shown = reveal.slice(0, ui.prizeIdx).reverse();
      if (!shown.length) b += '<section class="card center"><div class="big-ico">' + ic('trophy') + '</div><h2>Ready to reveal</h2><p class="muted">' + items.length + ' prize' + (items.length > 1 ? 's' : '') + ' to announce.</p></section>';
      b += shown.map(function (i, k) { return prizeCard(i, k === 0); }).join('');
    }
    b += '<div class="sticky-actions col">' + (showAll ? '' : '<button class="btn btn-gold btn-lg" data-act="prize-next">' + ic('sparkle') + 'Reveal Next Prize</button>') +
      '<div class="grid2"><button class="btn btn-ghost" data-act="prize-all">' + (showAll && ui.prizeAll ? 'Reveal one by one' : 'Show All Results') + '</button><button class="btn btn-ghost" data-act="prize-share">' + ic('share') + 'Share Results</button></div>' +
      '<div class="grid2"><button class="btn btn-ghost" data-act="go" data-v="results">Edit results</button><button class="btn btn-primary" data-act="prize-complete">' + ic('check') + 'Complete Outing</button></div></div>';
    return { t: 'Prize Giving', back: 'more', b: b };
  };

  /* HISTORY */
  V.history = function () {
    var list = S.history.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || (b.completedAt - a.completedAt); });
    var b = list.length ? '<div class="list">' + list.map(function (o) {
      return '<button class="menu-row" data-act="h-open" data-id="' + o.id + '">' + ic('trophy') + '<span class="grow"><b>' + esc(o.name) + '</b><small>' + esc(C.fmtDate(o.date)) + ' \u00B7 ' + o.participants.length + ' golfers \u00B7 ' + money(C.collected(o)) + '</small></span>' + ic('back', 'flip muted') + '</button>';
    }).join('') + '</div>' : '<div class="empty">No completed outings yet. They appear here after you press Complete Outing.</div>';
    return { t: 'Outing History', back: 'home', b: b };
  };
  V.hist = function () {
    var o = S.history.filter(function (x) { return x.id === ui.histId; })[0];
    if (!o) return V.history();
    var items = prizeItems(o).sort(function (a, b) { return (a.cls === 'extra' ? 10 : 0) - (b.cls === 'extra' ? 10 : 0) || a.rank - b.rank; });
    var b = '<section class="card"><h2>' + esc(o.name) + '</h2><div class="muted">' + esc(C.fmtDate(o.date)) + '</div><div class="stats three">' + stat(o.participants.length, 'Golfers', 'users') + stat(money(o.contribution), 'Each', 'coin') + stat(money(C.collected(o)), 'Collected', 'trophy') + '</div></section>';
    b += items.map(function (i) { return prizeCard(i, false); }).join('');
    b += '<section class="card"><h3>Draw</h3><div class="list dl">' + o.participants.slice().sort(byName).map(function (p) {
      return '<div class="item col"><div class="dl-main"><span class="dl-a">' + esc(p.name) + '</span><span class="dl-arrow">' + ic('back', 'flip') + '</span><span class="dl-b">' + esc(o.alloc ? C.nm(o, o.alloc[p.id]) : '\u2014') + '</span></div><div class="badges">' + paidBadge(o.paid[p.id]) + '</div></div>';
    }).join('') + '</div></section>';
    b += '<div class="grid2"><button class="btn btn-ghost" data-act="h-csv">' + ic('download') + 'CSV</button><button class="btn btn-ghost" data-act="h-txt">' + ic('share') + 'Share text</button><button class="btn btn-ghost" data-act="h-dup">' + ic('users') + 'Duplicate golfers</button><button class="btn btn-ghost" data-act="h-reopen">' + ic('undo') + 'Reopen</button></div>';
    b += '<button class="btn btn-danger" data-act="h-del">' + ic('trash') + 'Delete outing</button>';
    return { t: 'Outing', back: 'history', b: b };
  };

  /* PRACTICE */
  V.practice = function () {
    var b = '<section class="card"><div class="big-ico">' + ic('play') + '</div><h2>Practice Draw</h2><p class="muted">Try the full draw and reel with pretend results. Nothing is saved: your payments, real draw and history are untouched.</p>' +
      '<button class="btn btn-gold" data-act="pr-demo">' + ic('play') + 'Practise with sample golfers</button>' +
      '<button class="btn btn-ghost mt" data-act="pr-copy" ' + (S.outing || S.players.length > 1 ? '' : 'disabled') + '>Practise with a copy of the current list</button></section>';
    return { t: 'Practice Draw', back: 'more', b: b };
  };

  /* SETTINGS */
  function toggleRow(label, path, val, help) {
    return '<label class="set-row"><span class="grow"><b>' + label + '</b>' + (help ? '<small>' + help + '</small>' : '') + '</span><input type="checkbox" class="switch" role="switch" data-bind="' + path + '" ' + (val ? 'checked' : '') + '></label>';
  }
  V.settings = function () {
    var s = S.settings;
    var b = '<section class="card"><h3>Outings</h3><label class="lbl" for="sn">App name</label><input id="sn" type="text" value="' + esc(s.appName) + '" data-bind="settings.appName" data-title="1" autocomplete="off">' +
      '<div class="row-form"><div><label class="lbl" for="sc">Default sweep</label><input id="sc" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(s.contribution) + '" data-bind="settings.contribution" data-num="1"></div><div><label class="lbl" for="scur">Currency</label><select id="scur" data-bind="settings.currency"><option value="\u00A3" ' + (s.currency === '\u00A3' ? 'selected' : '') + '>\u00A3 GBP</option><option value="\u20AC" ' + (s.currency === '\u20AC' ? 'selected' : '') + '>\u20AC EUR</option><option value="$" ' + (s.currency === '$' ? 'selected' : '') + '>$ USD</option></select></div></div>' +
      toggleRow('Require payment before drawing', 'settings.requirePay', s.requirePay, 'Unpaid golfers are sent back to the organiser.') + '</section>';
    b += '<section class="card"><h3>Organiser PIN</h3><p class="muted">' + (pinSet() ? 'A PIN protects organiser screens.' : 'No PIN set. Organiser mode needs a press-and-hold instead.') + '</p><div class="row-actions"><button class="btn btn-primary btn-small" data-act="pin-set">' + (pinSet() ? 'Change PIN' : 'Set PIN') + '</button>' + (pinSet() ? '<button class="btn btn-ghost btn-small" data-act="pin-remove">Remove PIN</button>' : '') + '</div></section>';
    b += '<section class="card"><h3>Reel &amp; feedback</h3><label class="lbl" for="sr">Reel duration: <b>' + esc(s.reelSecs) + 's</b></label><input id="sr" type="range" min="3" max="5" step="0.5" value="' + esc(s.reelSecs) + '" data-bind="settings.reelSecs" data-num="1">' +
      toggleRow('Sound effects', 'settings.sound', s.sound) + toggleRow('Vibration', 'settings.vibrate', s.vibrate, 'Not supported on every phone.') + toggleRow('Reduce animation', 'settings.reduceMotion', s.reduceMotion, 'Also follows your phone\u2019s setting.') +
      '<label class="lbl" for="sh">Auto-hide revealed name</label><select id="sh" data-bind="settings.autoHide" data-num="1"><option value="0" ' + (+s.autoHide === 0 ? 'selected' : '') + '>Off</option>' + [10, 15, 30, 60].map(function (v) { return '<option value="' + v + '" ' + (+s.autoHide === v ? 'selected' : '') + '>After ' + v + ' seconds</option>'; }).join('') + '</select></section>';
    b += '<section class="card"><h3>Backup &amp; restore</h3><p class="muted">Everything is stored only on this phone. Export a backup before changing or resetting your phone.</p><div class="grid2"><button class="btn btn-primary" data-act="s-export">' + ic('download') + 'Export backup</button><button class="btn btn-ghost" data-act="s-import">' + ic('upload') + 'Import backup</button></div><input id="imp" type="file" accept="application/json,.json" class="sr" tabindex="-1"></section>';
    b += '<section class="card danger-zone"><h3>Reset</h3><button class="btn btn-danger btn-small" data-act="s-reset-players">Reset master player list</button><button class="btn btn-danger btn-small mt" data-act="s-erase">Erase all app data</button></section>';
    b += '<p class="hint center">' + esc(s.appName) + ' \u00B7 works offline \u00B7 no accounts \u00B7 no servers</p>';
    return { t: 'Settings & Backup', back: 'more', b: b };
  };

  /* ---------- Kiosk (player) views ---------- */
  V.locked = function () {
    return { kiosk: true, b: '<section class="kiosk-card center"><div class="big-ico">' + ic('lock') + '</div><h1>' + esc(S.settings.appName) + '</h1><p>Organiser controls are locked.</p><button class="btn btn-gold btn-lg" data-act="org-enter">' + ic('lock') + 'Unlock organiser</button><button class="btn btn-ghost-light" data-act="kiosk">Player draw screen</button></section>' };
  };

  V.pickwho = function () {
    var o = ctx();
    if (!o) return { kiosk: true, b: '<section class="kiosk-card center"><div class="big-ico">' + ic('flag') + '</div><h1>No outing yet</h1><p>Please give the phone back to the organiser.</p></section>' };
    if (o.pending) return V.resume();
    var left = o.participants.filter(function (p) { return !o.revealed[p.id]; }).sort(byName);
    if (!left.length) {
      return { kiosk: true, b: '<section class="kiosk-card center"><div class="big-ico">' + ic('trophy') + '</div><h1>All players have made their selection.</h1><p>Good luck everyone!</p>' + (ui.practice ? '<button class="btn btn-gold" data-act="pr-again">Run practice again</button><button class="btn btn-ghost-light" data-act="pr-exit">Exit practice</button>' : '') + '</section>' };
    }
    var q = norm(ui.q);
    var shown = left.filter(function (p) { return !q || norm(p.name).indexOf(q) > -1; });
    var b = '<section class="kiosk-card"><h1>Who are you?</h1><p>Tap your own name.</p>' + (left.length > 8 ? searchBox('Find your name') : '') +
      '<div class="who-list">' + shown.map(function (p) { return '<button class="who" data-act="who-pick" data-id="' + p.id + '">' + esc(p.name) + '</button>'; }).join('') + '</div>' + (shown.length ? '' : '<p class="muted-l">No match.</p>') + '</section>';
    return { kiosk: true, b: b };
  };

  V.pickconfirm = function () {
    var o = ctx(), p = o && o.participants.filter(function (x) { return x.id === ui.drawer; })[0];
    if (!p) { ui.view = 'pickwho'; return V.pickwho(); }
    return { kiosk: true, back: 'who', b: '<section class="kiosk-card center"><p>You are drawing as</p><h1 class="big-name">' + esc(p.name) + '</h1><button class="btn btn-gold btn-lg" data-act="confirm-yes">' + ic('check') + 'Yes, that\u2019s me</button><button class="btn btn-ghost-light btn-lg" data-act="confirm-no">Go back</button></section>' };
  };

  V.unpaidmsg = function () {
    var o = ctx(), p = o && o.participants.filter(function (x) { return x.id === ui.drawer; })[0];
    return { kiosk: true, b: '<section class="kiosk-card center"><div class="big-ico">' + ic('coin') + '</div><h1>Almost there' + (p ? ', ' + esc(p.name.split(' ')[0]) : '') + '!</h1><p>Please hand the phone back to the organiser to sort your sweep money first, then you can draw.</p><button class="btn btn-gold btn-lg" data-act="confirm-no">OK</button></section>' };
  };

  V.pickgo = function () {
    var o = ctx(), p = o && o.participants.filter(function (x) { return x.id === ui.drawer; })[0];
    if (!p || o.revealed[p.id]) { ui.view = 'pickwho'; return V.pickwho(); }
    return { kiosk: true, b: '<section class="kiosk-card center go"><div class="motif">' + ic('ball') + '</div><h1 class="big-name">' + esc(p.name) + '</h1><p>Press the button to draw your player.</p><button class="pick-btn" data-act="go-pick">Make Your Pick</button><button class="link-light" data-act="confirm-no">Not me? Go back</button></section>' };
  };

  V.reel = function () {
    return { kiosk: true, b: '<section class="kiosk-card center reel-view"><p id="rv-label" class="rv-label">Drawing\u2026</p><div class="reel" id="reel" aria-live="off"><div class="reel-band"></div><div class="reel-strip" id="strip"></div></div><div class="reveal" id="reveal" hidden><div class="reveal-tag">Your player is</div><div class="reveal-card"><div class="reveal-name" id="rname"></div></div></div><button class="btn btn-gold btn-lg" id="done" data-act="reveal-done" hidden>Done</button><div class="confetti" id="conf" aria-hidden="true"></div></section>' };
  };

  V.resume = function () {
    var o = ctx(), p = o && o.participants.filter(function (x) { return x.id === o.pending; })[0];
    if (!p) { if (o) { o.pending = null; save(); } ui.view = 'pickwho'; return V.pickwho(); }
    return { kiosk: true, b: '<section class="kiosk-card center"><div class="big-ico">' + ic('clock') + '</div><h1>' + esc(p.name) + '</h1><p>Your draw was interrupted. Your player is safe and can only be shown to you. Make sure nobody else is looking.</p><button class="btn btn-gold btn-lg" data-act="resume-show">Show my player</button></section>' };
  };

  /* ---------- Reel ---------- */
  var reelRAF = 0, hideTimer = 0;
  var ITEM = 68;

  function celebrate() {
    var box = document.getElementById('conf');
    if (!box || reduced()) return;
    var cols = ['#C6A15B', '#E7D3A1', '#FFFFFF', '#2F6B4F', '#F5F3ED'];
    var h = '';
    for (var i = 0; i < 36; i++) {
      var s = 6 + Math.random() * 8;
      h += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;width:' + s.toFixed(1) + 'px;height:' + (Math.random() > .5 ? s : s * 2).toFixed(1) + 'px;background:' + cols[i % cols.length] + ';animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's;animation-duration:' + (2.2 + Math.random() * 1.6).toFixed(2) + 's;border-radius:' + (i % 3 === 0 ? '50%' : '2px') + '"></i>';
    }
    box.innerHTML = h;
    setTimeout(function () { if (box) box.innerHTML = ''; }, 4500);
  }

  function runReel(o, id, instant) {
    var strip = document.getElementById('strip'), reel = document.getElementById('reel');
    if (!strip) return;
    var target = C.nm(o, o.alloc[id]);
    var pool = o.participants.filter(function (p) { return p.id !== id; }).map(function (p) { return p.name; });
    var secs = Math.min(5, Math.max(3, +S.settings.reelSecs || 4));
    var quick = instant || reduced();
    var L = quick ? 0 : Math.max(30, Math.round(secs * 12));
    var pre = C.shuffle(pool).slice(0, 2), post = C.shuffle(pool).slice(0, 2);
    while (pre.length < 2) pre.push(pool[0]);
    while (post.length < 2) post.push(pool[0]);
    var mid = [];
    while (mid.length < L) mid = mid.concat(C.shuffle(pool));
    mid.length = L;
    var seq = pre.concat(mid, [target], post);
    var tIdx = 2 + L;
    strip.innerHTML = seq.map(function (n, i) { return '<div class="reel-item' + (i === tIdx ? ' final' : '') + '">' + esc(n) + '</div>'; }).join('');
    var items = strip.children;
    var lastTick = 0, lastIdx = -1;

    function finish() {
      strip.style.transform = 'translateY(' + ((2 - tIdx) * ITEM) + 'px)';
      if (items[tIdx]) items[tIdx].classList.add('center');
      buzz([30, 40, 60]);
      beep(660, 0.25, 0.12, 'sine'); beep(880, 0.25, 0.12, 'sine', 0.14); beep(1175, 0.5, 0.12, 'sine', 0.28);
      setTimeout(function () {
        reel.classList.add('done');
        var rv = document.getElementById('reveal');
        document.getElementById('rname').textContent = target;
        document.getElementById('rv-label').textContent = '';
        rv.hidden = false; rv.classList.add('pop');
        var d = document.getElementById('done'); d.hidden = false;
        celebrate();
        var t = +S.settings.autoHide;
        clearTimeout(hideTimer);
        if (t > 0) hideTimer = setTimeout(function () { finishPick(); }, t * 1000);
      }, quick ? 350 : 700);
    }

    if (quick) { finish(); return; }
    var start = performance.now(), dur = secs * 1000, maxP = L;
    function ease(t) { return 1 - Math.pow(1 - t, 3.4); }
    function frame(ts) {
      var t = Math.min(1, (ts - start) / dur), p = ease(t) * maxP;
      strip.style.transform = 'translateY(' + (-p * ITEM) + 'px)';
      var idx = 2 + Math.round(p);
      if (idx !== lastIdx) {
        if (items[lastIdx]) items[lastIdx].classList.remove('center');
        if (items[idx]) items[idx].classList.add('center');
        lastIdx = idx;
        if (ts - lastTick > 45) { beep(700 + (idx % 5) * 40, 0.04, 0.05, 'triangle'); lastTick = ts; if (t > 0.85) buzz(8); }
      }
      if (t < 1) reelRAF = requestAnimationFrame(frame); else finish();
    }
    reelRAF = requestAnimationFrame(frame);
  }

  function finishPick() {
    cancelAnimationFrame(reelRAF); clearTimeout(hideTimer);
    var o = ctx(), id = ui.drawer;
    if (o && id) { o.done[id] = now(); o.pending = null; save(); }
    ui.drawer = null; ui.q = ''; ui.view = 'pickwho'; render();
  }

  function startPick() {
    var o = ctx(), id = ui.drawer;
    if (!o || !id || o.revealed[id]) { ui.view = 'pickwho'; render(); return; }
    audio();
    if (!o.alloc) {
      try { o.alloc = C.derange(o.participants.map(function (p) { return p.id; })); }
      catch (e) { toast('Could not create the draw. Ask the organiser.'); return; }
      o.allocAt = now();
    }
    o.locked = true; o.revealed[id] = now(); o.pending = id; save();
    buzz(20);
    ui.view = 'reel'; render();
    runReel(o, id, false);
  }

  /* ---------- Render ---------- */
  var NAV = [['home', 'home', 'Home'], ['players', 'users', 'Players'], ['pay', 'coin', 'Payments'], ['still', 'flag', 'To Pick'], ['more', 'more', 'More']];
  var NAV_GROUP = { setup: 'home', hist: 'more', history: 'more', status: 'still', drawlist: 'more', results: 'more', prize: 'more', settings: 'more', practice: 'more' };

  function modalHtml() {
    var m = ui.modal; if (!m) return '';
    var h = '<div class="scrim" data-act="' + (m.type === 'box' ? 'modal-cancel' : 'modal-cancel') + '"></div><div class="modal" role="dialog" aria-modal="true">';
    if (m.type === 'box') {
      h += '<h3>' + esc(m.title) + '</h3>' + (m.msg ? '<p>' + m.msg + '</p>' : '') + (m.body || '') +
        (m.typed ? '<label class="lbl" for="m-typed">Type <b>' + esc(m.typed) + '</b> to confirm</label><input id="m-typed" type="text" autocomplete="off" autocapitalize="characters">' : '') +
        '<div class="row-actions"><button class="btn btn-ghost" data-act="modal-cancel">' + esc(m.cancel) + '</button><button class="btn ' + (m.danger ? 'btn-danger' : 'btn-primary') + '" data-act="modal-ok">' + esc(m.ok) + '</button></div>';
    } else if (m.type === 'pin') {
      var dots = ''; for (var i = 0; i < 4; i++) dots += '<span class="dot ' + (i < m.buf.length ? 'on' : '') + '"></span>';
      h += '<h3>' + esc(m.title) + '</h3><p>' + esc(m.sub) + '</p><div class="dots ' + (m.err ? 'shake' : '') + '" aria-label="' + m.buf.length + ' of 4 digits entered">' + dots + '</div><div class="pin-err" role="alert">' + esc(m.err) + '</div><div class="keypad">';
      [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (k) { h += '<button data-act="pin-key" data-k="' + k + '">' + k + '</button>'; });
      h += '<button data-act="modal-cancel" class="kp-s" aria-label="Cancel">' + ic('x') + '</button><button data-act="pin-key" data-k="0">0</button><button data-act="pin-del" class="kp-s" aria-label="Delete">' + ic('back') + '</button></div>';
    } else if (m.type === 'hold') {
      h += '<h3>Organiser access</h3><p>Press and hold the button for one second to enter organiser mode.</p><button class="hold-btn" id="hold" aria-label="Press and hold to enter organiser mode"><span class="hold-fill"></span><span class="hold-txt">' + ic('lock') + 'Hold to enter</span></button><button class="btn btn-ghost mt" data-act="modal-cancel">Cancel</button>';
    }
    return h + '</div>';
  }

  var lastView = '';
  function render() {
    if (!ui.practice && !ui.org && KIOSK_VIEWS.indexOf(ui.view) < 0) ui.view = S.kiosk ? 'pickwho' : 'locked';
    if (ui.practice && KIOSK_VIEWS.indexOf(ui.view) < 0) ui.view = 'pickwho';
    if (!ui.practice && S.kiosk && !ui.org && ui.view === 'locked') ui.view = 'pickwho';
    var v = (V[ui.view] || V.home)();
    var html = '';
    if (!storageOk) html += '<div class="banner-err">' + ic('warn') + 'Storage is unavailable or full. Changes may not be saved. Export a backup if you can.</div>';
    if (ui.practice) html += '<div class="practice-bar">' + ic('play') + 'PRACTICE MODE \u2014 nothing is saved<button data-act="pr-again">Reset</button><button data-act="pr-exit">Exit</button></div>';
    if (v.kiosk) {
      html += '<div class="shell kiosk"><header class="khead"><span class="klogo">' + ic('flag') + esc(S.settings.appName) + '</span>' + (ui.practice ? '' : '<button class="klock" data-act="org-enter" aria-label="Organiser access">' + ic('lock') + '</button>') + '</header><main id="main">' + v.b + '</main></div>';
    } else {
      var group = NAV_GROUP[ui.view] || ui.view;
      html += '<div class="shell"><header class="head' + (v.home ? ' home' : '') + '">' + (v.back ? '<button class="hb" data-act="go" data-v="' + v.back + '" aria-label="Back">' + ic('back') + '</button>' : '<span class="logo">' + ic('flag') + '</span>') + '<h1>' + esc(v.t) + '</h1></header><main id="main">' + v.b + '</main>' +
        '<nav class="nav" aria-label="Main">' + NAV.map(function (n) { return '<button class="' + (group === n[0] ? 'on' : '') + '" data-act="go" data-v="' + n[0] + '" ' + (group === n[0] ? 'aria-current="page"' : '') + '>' + ic(n[1]) + '<span>' + n[2] + '</span></button>'; }).join('') + '</nav></div>';
    }
    html += modalHtml();
    var fid = document.activeElement && document.activeElement.id, ss, se;
    try { ss = document.activeElement.selectionStart; se = document.activeElement.selectionEnd; } catch (e) { /* ignore */ }
    app.innerHTML = html;
    document.body.classList.toggle('reduce', !!S.settings.reduceMotion);
    if (fid && ui.liveFocus) {
      var el = document.getElementById(fid);
      if (el) { el.focus(); try { el.setSelectionRange(ss, se); } catch (e) { /* ignore */ } }
    }
    ui.liveFocus = false;
    if (ui.view !== lastView) { window.scrollTo(0, 0); lastView = ui.view; }
    document.title = S.settings.appName;
  }

  /* ---------- Data helpers ---------- */
  function setPath(path, val) {
    var parts = path.split('.'), root = parts[0] === 'ui' ? ui : (parts[0] === 'settings' ? S.settings : (parts[0] === 'draft' ? S.draft : (parts[0] === 'outing' ? S.outing : null)));
    if (!root) return;
    for (var i = 1; i < parts.length - 1; i++) root = root[parts[i]];
    root[parts[parts.length - 1]] = val;
  }

  function exitPractice() { ui.practice = false; PR = null; ui.drawer = null; ui.view = 'practice'; render(); }

  function startPractice(names) {
    var o = C.mkOuting('Practice', names, 0);
    o.participants.forEach(function (p) { o.paid[p.id] = 1; });
    PR = o; ui.practice = true; ui.drawer = null; ui.q = ''; ui.view = 'pickwho'; render();
  }

  function exportBackup() {
    var d = { app: 'golf-outing-sweep', version: 1, exportedAt: new Date().toISOString(), data: { settings: S.settings, players: S.players, history: S.history, outing: S.outing, draft: null } };
    download('golf-outing-sweep-backup-' + C.today() + '.json', JSON.stringify(d, null, 2), 'application/json');
    toast('Backup exported');
  }

  function importBackup(file) {
    var r = new FileReader();
    r.onload = function () {
      var parsed;
      try { parsed = JSON.parse(r.result); } catch (e) { toast('That file is not valid JSON.'); return; }
      var v = C.validateBackup(parsed);
      if (!v.ok) { openModal({ type: 'box', title: 'Cannot import', msg: esc(v.error), ok: 'OK', cancel: 'Close', onOk: function () { return true; } }); return; }
      confirmBox({
        title: 'Replace all data?', danger: true, ok: 'Replace everything',
        msg: 'This backup has <b>' + v.data.players.length + '</b> players and <b>' + v.data.history.length + '</b> past outings' + (v.data.outing ? ' plus an active outing' : '') + '. Importing <b>replaces</b> all current data on this phone.',
        onOk: function () {
          var f = fresh();
          S = Object.assign(f, { settings: Object.assign({}, DEFAULT_SETTINGS, v.data.settings), players: v.data.players, history: v.data.history, outing: v.data.outing, draft: null, kiosk: false });
          save(); toast('Backup restored'); ui.view = 'home'; return true;
        }
      });
    };
    r.onerror = function () { toast('Could not read the file.'); };
    r.readAsText(file);
  }

  function completeOuting() {
    var o = S.outing; if (!o) return;
    o.completedAt = now();
    S.history.push(JSON.parse(JSON.stringify(o)));
    S.outing = null; ui.view = 'hist'; ui.histId = o.id; ui.prizeIdx = 0; ui.prizeAll = false; save(); render();
  }

  /* ---------- Actions ---------- */
  var ACT = {
    go: function (d) { ui.view = d.v; ui.q = ''; ui.filter = 'all'; ui.prizeIdx = 0; ui.prizeAll = false; ui.pasteOpen = false; render(); },
    filter: function (d) { ui.filter = d.f; render(); },
    kiosk: function () { startKiosk(); },
    'org-enter': enterOrganiser,
    'modal-cancel': function () { closeModal(); },
    'modal-ok': function () {
      var m = ui.modal;
      if (m.typed) { var t = document.getElementById('m-typed'); if (!t || t.value.trim().toUpperCase() !== m.typed) { toast('Type ' + m.typed + ' to confirm'); return; } }
      var r = m.onOk ? m.onOk() : true;
      if (r !== false) { if (ui.modal === m) ui.modal = null; render(); }
    },

    /* PIN */
    'pin-key': function (d) {
      var m = ui.modal; if (!m || m.type !== 'pin' || m.busy) return;
      if (m.buf.length >= 4) return;
      m.buf += d.k; m.err = ''; buzz(5);
      if (m.buf.length === 4) {
        m.busy = true;
        Promise.resolve(m.cb(m.buf)).then(function (r) {
          m.busy = false;
          if (typeof r === 'string') { m.err = r; m.buf = ''; render(); }
          else if (ui.modal === m) { ui.modal = null; render(); }
        });
        render();
      } else render();
    },
    'pin-del': function () { var m = ui.modal; if (m && m.type === 'pin') { m.buf = m.buf.slice(0, -1); render(); } },
    'pin-set': function () {
      var first = '';
      var again = function () {
        pinModal('Confirm PIN', 'Enter the same PIN again', function (pin) {
          if (pin !== first) return 'PINs did not match';
          var salt = C.uid();
          return C.hashPin(pin, salt).then(function (h) { S.settings.pinSalt = salt; S.settings.pinHash = h; save(); toast('PIN saved'); return true; });
        });
      };
      var ask = function () {
        pinModal('New PIN', 'Choose a 4-digit PIN', function (pin) { first = pin; setTimeout(again, 0); return true; });
      };
      if (pinSet()) {
        pinModal('Current PIN', 'Enter your current PIN', function (pin) {
          return C.hashPin(pin, S.settings.pinSalt).then(function (h) { if (h !== S.settings.pinHash) return 'Incorrect PIN'; setTimeout(ask, 0); return true; });
        });
      } else ask();
    },
    'pin-remove': function () {
      pinModal('Remove PIN', 'Enter your current PIN', function (pin) {
        return C.hashPin(pin, S.settings.pinSalt).then(function (h) { if (h !== S.settings.pinHash) return 'Incorrect PIN'; S.settings.pinHash = ''; S.settings.pinSalt = ''; save(); toast('PIN removed'); return true; });
      });
    },

    /* Players */
    'p-add': function () {
      var n = document.getElementById('pn').value.trim().replace(/\s+/g, ' '), l = document.getElementById('pl').value.trim();
      if (!n) { toast('Enter a name'); return; }
      var r = dupCheck(n, l);
      if (r === 'exact') { toast(n + ' is already in the list'); return; }
      if (r === 'needlabel') { toast('Someone called ' + n + ' exists: add a label to tell them apart'); document.getElementById('pl').focus(); return; }
      S.players.push({ id: C.uid(), name: n, label: l, archived: false }); save(); render(); toast(n + ' added');
    },
    'p-paste': function () {
      openModal({ type: 'box', title: 'Paste names', ok: 'Add names', body: '<p>One name per line.</p><textarea id="paste" rows="8" aria-label="Names, one per line"></textarea>',
        onOk: function () {
          var lines = document.getElementById('paste').value.split(/\r?\n/).map(function (s) { return s.trim().replace(/\s+/g, ' '); }).filter(Boolean);
          var add = 0, skip = [];
          lines.forEach(function (n) {
            if (dupCheck(n, '') !== 'ok') { skip.push(n); return; }
            S.players.push({ id: C.uid(), name: n, label: '', archived: false }); add++;
          });
          save();
          setTimeout(function () { toast(add + ' added' + (skip.length ? ', ' + skip.length + ' duplicate' + (skip.length > 1 ? 's' : '') + ' skipped (' + skip.slice(0, 3).join(', ') + (skip.length > 3 ? '\u2026' : '') + ')' : '')); }, 50);
          return true;
        } });
    },
    'p-edit': function (d) {
      var p = S.players.filter(function (x) { return x.id === d.id; })[0]; if (!p) return;
      openModal({ type: 'box', title: 'Edit player', ok: 'Save', body: '<label class="lbl" for="en">Name</label><input id="en" type="text" value="' + esc(p.name) + '"><label class="lbl" for="el">Label (optional)</label><input id="el" type="text" value="' + esc(p.label) + '">',
        onOk: function () {
          var n = document.getElementById('en').value.trim().replace(/\s+/g, ' '), l = document.getElementById('el').value.trim();
          if (!n) { toast('Name cannot be empty'); return false; }
          var r = dupCheck(n, l, p.id);
          if (r === 'exact' || r === 'needlabel') { toast('Another player has that name. Add a label.'); return false; }
          p.name = n; p.label = l; save(); return true;
        } });
    },
    'p-archive': function (d) {
      var p = S.players.filter(function (x) { return x.id === d.id; })[0]; if (!p) return;
      confirmBox({ title: 'Remove ' + p.name + '?', msg: 'They are archived, not deleted. Past outings keep their name. You can restore them later.', ok: 'Remove', onOk: function () { p.archived = true; save(); return true; } });
    },
    'p-restore': function (d) {
      var p = S.players.filter(function (x) { return x.id === d.id; })[0]; if (!p) return;
      if (dupCheck(p.name, p.label, p.id) === 'exact') { toast('A current player already has that name'); return; }
      p.archived = false; save(); render();
    },
    'p-archived-toggle': function () { ui.showArchived = !ui.showArchived; ui.q = ''; render(); },

    /* Setup */
    'd-toggle': function (d) { var s = draftInit(); if (s.sel[d.id]) delete s.sel[d.id]; else s.sel[d.id] = 1; save(); render(); },
    'd-all': function () { var s = draftInit(); activePlayers().forEach(function (p) { s.sel[p.id] = 1; }); save(); render(); },
    'd-none': function () { draftInit().sel = {}; save(); render(); },
    'd-guest-add': function () {
      var el = document.getElementById('gn'), n = el.value.trim().replace(/\s+/g, ' ');
      if (!n) { toast('Enter the guest\u2019s name'); return; }
      var s = draftInit();
      var taken = draftParticipants(s).some(function (p) { return norm(p.name) === norm(n); });
      if (taken) { toast('A golfer called ' + n + ' is already in. Add a label, e.g. ' + n + ' (guest)'); return; }
      s.guests.push({ id: 'g' + C.uid(), name: n }); save(); render();
    },
    'd-guest-rm': function (d) { var s = draftInit(); s.guests = s.guests.filter(function (g) { return g.id !== d.id; }); save(); render(); },
    'd-review': function () { var s = draftInit(); if (draftParticipants(s).length < 2) { toast('Select at least two golfers'); return; } s.step = 2; save(); render(); },
    'd-back': function () { draftInit().step = 1; save(); render(); },
    'd-start': function () {
      var d = draftInit(), parts = draftParticipants(d);
      if (parts.length < 2) return;
      var o = C.mkOuting(d.name.trim() || 'Golf Outing', [], +d.contribution || 0);
      o.date = d.date || C.today();
      o.participants = parts.map(function (p) { return { id: p.id, name: p.name }; });
      S.outing = o; S.draft = null; ui.view = 'pay'; ui.filter = 'all'; save(); render();
    },

    /* Payments */
    'pay-toggle': function (d) {
      var o = S.outing; if (!o) return;
      if (o.paid[d.id]) delete o.paid[d.id]; else o.paid[d.id] = now();
      save(); render();
    },
    'begin-as': function (d) { startKiosk(d.id); },

    /* Draw list */
    'dl-hide': function () { ui.hide = !ui.hide; render(); },
    'dl-csv': function () { var o = S.outing; download(slug(o.name) + '-draw.csv', C.drawCsv(o), 'text/csv'); },
    'dl-share': function () { var o = S.outing; shareText(o.name, C.drawText(o, cur())); },
    'reset-draw': function () {
      var o = S.outing;
      confirmBox({ title: 'Reset the draw?', danger: true, typed: 'RESET', ok: 'Reset draw', msg: '<b>This invalidates every previous selection.</b> Golfers who have already seen their player will draw again from a brand new allocation. Payments are kept.',
        onOk: function () { o.alloc = null; o.allocAt = null; o.revealed = {}; o.done = {}; o.pending = null; o.locked = false; o.results = { first: '', second: '', third: '', last: '' }; save(); toast('Draw reset'); return true; } });
    },
    'cancel-outing': function () {
      var o = S.outing;
      confirmBox({ title: 'Cancel this outing?', danger: true, typed: o.locked ? 'RESET' : '', ok: 'Cancel outing', msg: o.locked ? '<b>The draw has started.</b> Cancelling deletes this outing, its payments and all selections. It will not be saved to history.' : 'This deletes the outing and its payments. Nothing has been drawn yet.',
        onOk: function () { S.outing = null; save(); ui.view = 'home'; return true; } });
    },

    /* Results */
    'x-add': function () { var o = S.outing; o.extras.push({ id: C.uid(), title: ui.xnew === 'Custom prize' ? '' : ui.xnew, winner: '', prize: '' }); save(); render(); },
    'x-rm': function (d) { var o = S.outing; o.extras.splice(+d.i, 1); save(); render(); },

    /* Prize giving */
    'prize-next': function () { ui.prizeIdx++; beep(880, 0.3, 0.1, 'sine'); beep(1320, 0.4, 0.1, 'sine', 0.12); render(); },
    'prize-all': function () { ui.prizeAll = !ui.prizeAll; ui.prizeIdx = 0; render(); },
    'prize-share': function () { var o = S.outing; shareText(o.name + ' results', C.resultsText(o, cur())); },
    'prize-complete': function () {
      var o = S.outing;
      var pending = C.pickedCount(o) < o.participants.length;
      confirmBox({ title: 'Complete this outing?', ok: 'Complete & save', msg: (pending ? '<b>Not everyone has drawn yet.</b> ' : '') + 'It is saved to history and locked. You can reopen it from Outing History if needed.', onOk: function () { setTimeout(completeOuting, 0); return true; } });
    },

    /* History */
    'h-open': function (d) { ui.histId = d.id; ui.view = 'hist'; render(); },
    'h-csv': function () { var o = S.history.filter(function (x) { return x.id === ui.histId; })[0]; download(slug(o.name) + '-' + o.date + '.csv', C.outingCsv(o), 'text/csv'); },
    'h-txt': function () { var o = S.history.filter(function (x) { return x.id === ui.histId; })[0]; shareText(o.name, C.resultsText(o, cur()) + '\n\n' + C.drawText(o, cur())); },
    'h-dup': function () {
      var o = S.history.filter(function (x) { return x.id === ui.histId; })[0];
      if (S.outing) { toast('Finish the current outing first'); return; }
      var sel = {}, guests = [];
      o.participants.forEach(function (p) {
        if (S.players.some(function (m) { return m.id === p.id && !m.archived; })) sel[p.id] = 1; else guests.push({ id: 'g' + C.uid(), name: p.name });
      });
      S.draft = { name: o.name, date: C.today(), contribution: o.contribution, sel: sel, guests: guests, step: 1 };
      save(); ui.view = 'setup'; render(); toast('Golfers copied. Adjust and start.');
    },
    'h-reopen': function () {
      var o = S.history.filter(function (x) { return x.id === ui.histId; })[0];
      if (S.outing) { toast('Finish the current outing first'); return; }
      confirmBox({ title: 'Reopen this outing?', ok: 'Reopen', msg: 'It moves back to the active outing so results can be edited. Complete it again to save.', onOk: function () {
        var c = JSON.parse(JSON.stringify(o)); c.completedAt = null;
        S.history = S.history.filter(function (x) { return x.id !== o.id; }); S.outing = c; ui.view = 'prize'; save(); return true; } });
    },
    'h-del': function () {
      var o = S.history.filter(function (x) { return x.id === ui.histId; })[0];
      confirmBox({ title: 'Delete "' + o.name + '"?', danger: true, ok: 'Delete permanently', msg: 'This cannot be undone. Export it first if you want to keep a copy.', onOk: function () { S.history = S.history.filter(function (x) { return x.id !== o.id; }); ui.view = 'history'; save(); return true; } });
    },

    /* Practice */
    'pr-demo': function () { startPractice(['Andrew', 'Ben', 'Callum', 'Dougie', 'Euan', 'Fraser']); },
    'pr-copy': function () {
      var names = S.outing ? S.outing.participants.map(function (p) { return p.name; }) : activePlayers().map(pdisp);
      if (names.length < 2) { toast('Need at least two golfers'); return; }
      startPractice(names);
    },
    'pr-again': function () { var names = PR.participants.map(function (p) { return p.name; }); cancelAnimationFrame(reelRAF); clearTimeout(hideTimer); startPractice(names); toast('Practice reset'); },
    'pr-exit': function () { cancelAnimationFrame(reelRAF); clearTimeout(hideTimer); exitPractice(); },

    /* Settings */
    's-export': exportBackup,
    's-import': function () { var i = document.getElementById('imp'); i.value = ''; i.click(); },
    's-reset-players': function () { confirmBox({ title: 'Reset master player list?', danger: true, typed: 'RESET', ok: 'Reset list', msg: 'All players are removed from the master list. Past outings keep their names. Any current outing is unaffected.', onOk: function () { S.players = []; S.draft = null; save(); return true; } }); },
    's-erase': function () {
      confirmBox({ title: 'Erase everything?', danger: true, typed: 'ERASE', ok: 'Erase all data', msg: 'Players, outings, history and settings will be permanently deleted from this phone. Export a backup first.', onOk: function () { S = fresh(); save(); ui.view = 'home'; ui.org = true; return true; } });
    },

    /* Player flow */
    'who-pick': function (d) { ui.drawer = d.id; ui.view = 'pickconfirm'; render(); },
    'confirm-no': function () { ui.drawer = null; ui.view = 'pickwho'; render(); },
    'confirm-yes': function () {
      var o = ctx();
      if (!ui.practice && S.settings.requirePay && !o.paid[ui.drawer]) { ui.view = 'unpaidmsg'; render(); return; }
      ui.view = 'pickgo'; render();
    },
    'go-pick': function () {
      var o = ctx();
      if (!ui.practice && S.settings.requirePay && !o.paid[ui.drawer]) { ui.view = 'unpaidmsg'; render(); return; }
      startPick();
    },
    'resume-show': function () {
      var o = ctx(); ui.drawer = o.pending; audio(); ui.view = 'reel'; render(); runReel(o, o.pending, true);
    },
    'reveal-done': function () { finishPick(); }
  };

  /* ---------- Events ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.classList.contains('scrim') && ui.modal && ui.modal.type === 'pin') return;
    var fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  function bindHandler(e) {
    var el = e.target;
    if (el.id === 'imp' && e.type === 'change') { if (el.files && el.files[0]) importBackup(el.files[0]); return; }
    var path = el.dataset && el.dataset.bind; if (!path) return;
    var isInput = el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'range' && el.type !== 'date';
    if (isInput && e.type === 'change') return;
    var val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num) val = val === '' ? '' : parseFloat(val);
    if (el.dataset.num && val !== '' && isNaN(val)) val = '';
    var m = path.match(/^(outing|settings)\.(extras)\.(\d+)\.(\w+)$/);
    if (m) { S.outing.extras[+m[3]][m[4]] = val; }
    else setPath(path, val);
    if (path.indexOf('ui.') !== 0) save();
    if (el.dataset.title) document.title = val || 'Golf Outing Sweep';
    if (el.type === 'range') { var lb = document.querySelector('label[for="' + el.id + '"] b'); if (lb) lb.textContent = val + 's'; }
    if (el.dataset.live) { ui.liveFocus = true; render(); }
  }
  document.addEventListener('input', bindHandler);
  document.addEventListener('change', bindHandler);

  /* press-and-hold to enter organiser mode (no PIN set) */
  var holdT = 0;
  function holdStart(e) {
    var b = e.target.closest('#hold'); if (!b) return;
    if (e.type === 'keydown' && (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.type === 'keydown' && e.repeat) return;
    b.classList.add('holding');
    clearTimeout(holdT);
    holdT = setTimeout(function () { buzz(30); grantOrganiser(); }, 1000);
  }
  function holdEnd() { clearTimeout(holdT); var b = document.getElementById('hold'); if (b) b.classList.remove('holding'); }
  document.addEventListener('pointerdown', holdStart);
  document.addEventListener('keydown', holdStart);
  ['pointerup', 'pointercancel', 'pointerleave', 'keyup'].forEach(function (t) { document.addEventListener(t, holdEnd); });
  document.addEventListener('contextmenu', function (e) { if (e.target.closest('#hold')) e.preventDefault(); });

  /* ---------- Boot ---------- */
  (function boot() {
    var o = S.outing;
    if (S.kiosk && o) { ui.view = o.pending ? 'resume' : 'pickwho'; }
    else if (S.kiosk) { S.kiosk = false; }
    if (!S.kiosk) {
      if (pinSet()) ui.view = 'locked'; else ui.org = true;
    }
    render();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () { /* offline install unavailable */ }); });
    }
  })();
})();
