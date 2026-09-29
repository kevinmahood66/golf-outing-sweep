/* Golf Outing Sweep - core logic (pure functions, no DOM). */
(function (root) {
  'use strict';

  /* ---------- Randomness ---------- */
  function randInt(n) {
    var c = root.crypto;
    if (c && c.getRandomValues) {
      var max = Math.floor(0x100000000 / n) * n;
      var a = new Uint32Array(1);
      do { c.getRandomValues(a); } while (a[0] >= max);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- Derangement ---------- */
  function validateAlloc(ids, m) {
    if (!m || typeof m !== 'object') return false;
    if (Object.keys(m).length !== ids.length) return false;
    var seen = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], t = m[id];
      if (t === undefined || t === id) return false;
      if (ids.indexOf(t) === -1) return false;
      if (seen[t]) return false;
      seen[t] = true;
    }
    return Object.keys(seen).length === ids.length;
  }

  /* Uniform random derangement by rejection sampling (about e tries on average). */
  function derange(ids) {
    if (ids.length < 2) throw new Error('At least two golfers are needed.');
    for (var tries = 0; tries < 5000; tries++) {
      var s = shuffle(ids);
      var ok = true;
      for (var i = 0; i < ids.length; i++) if (s[i] === ids[i]) { ok = false; break; }
      if (!ok) continue;
      var m = {};
      for (var k = 0; k < ids.length; k++) m[ids[k]] = s[k];
      if (validateAlloc(ids, m)) return m;
    }
    throw new Error('Could not build a valid draw.');
  }

  function inverse(alloc) {
    var r = {};
    for (var k in alloc) r[alloc[k]] = k;
    return r;
  }

  /* ---------- Helpers ---------- */
  function uid() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4) + randInt(1296).toString(36);
  }

  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function fmtDate(s) {
    if (!s) return '';
    var p = String(s).split('-');
    if (p.length !== 3) return s;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function money(v, cur) {
    if (v === '' || v === null || v === undefined || isNaN(+v)) return '';
    var n = +v;
    var s = (Math.round(n * 100) % 100 === 0) ? String(Math.round(n)) : n.toFixed(2);
    return (cur || '\u00A3') + s;
  }

  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function nm(o, id) {
    var p = o.participants.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : '(unknown)';
  }

  function paidCount(o) { return o.participants.filter(function (p) { return o.paid[p.id]; }).length; }
  function pickedCount(o) { return o.participants.filter(function (p) { return o.revealed[p.id]; }).length; }
  function collected(o) { return paidCount(o) * (+o.contribution || 0); }

  function mkOuting(name, names, contribution) {
    return {
      id: uid(), name: name, date: today(), contribution: contribution,
      participants: names.map(function (n) { return { id: uid(), name: n }; }),
      paid: {}, alloc: null, allocAt: null, revealed: {}, done: {}, pending: null, locked: false,
      createdAt: Date.now(),
      results: { first: '', second: '', third: '', last: '' },
      prizes: { first: '', second: '', third: '', last: '' },
      extras: [], completedAt: null
    };
  }

  /* ---------- Text / CSV exports ---------- */
  function drawText(o, cur) {
    var L = [];
    L.push(o.name + ' - ' + fmtDate(o.date));
    L.push('Contribution ' + money(o.contribution, cur) + ' | Golfers ' + o.participants.length + ' | Collected ' + money(collected(o), cur));
    L.push('');
    o.participants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
      var t = o.alloc && o.alloc[p.id] ? nm(o, o.alloc[p.id]) : '(not drawn)';
      L.push(p.name + '  ->  ' + t + '   [' + (o.paid[p.id] ? 'Paid' : 'Unpaid') + ', ' + (o.revealed[p.id] ? 'Picked' : 'Still to pick') + ']');
    });
    return L.join('\n');
  }

  function drawCsv(o) {
    var rows = [['Person making the draw', 'Golfer drawn', 'Paid', 'Selection made', 'Revealed at']];
    o.participants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
      rows.push([p.name, o.alloc && o.alloc[p.id] ? nm(o, o.alloc[p.id]) : '', o.paid[p.id] ? 'Yes' : 'No', o.revealed[p.id] ? 'Yes' : 'No', o.revealed[p.id] ? new Date(o.revealed[p.id]).toISOString() : '']);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  var POS = [['first', '1st'], ['second', '2nd'], ['third', '3rd'], ['last', 'Last']];

  function resultsText(o, cur) {
    var inv = o.alloc ? inverse(o.alloc) : {};
    var L = [o.name + ' - ' + fmtDate(o.date), 'Sweep total ' + money(collected(o), cur), ''];
    POS.forEach(function (p) {
      var g = o.results && o.results[p[0]];
      if (!g) return;
      var d = inv[g] ? nm(o, inv[g]) : 'n/a';
      var pr = money(o.prizes && o.prizes[p[0]], cur);
      L.push(p[1] + ': ' + nm(o, g) + ' - drawn by ' + d + (pr ? ' - ' + pr : ''));
    });
    var ex = (o.extras || []).filter(function (x) { return x.winner; });
    if (ex.length) {
      L.push('');
      ex.forEach(function (x) {
        var pr = money(x.prize, cur);
        L.push((x.title || 'Competition') + ': ' + nm(o, x.winner) + (pr ? ' - ' + pr : ''));
      });
    }
    return L.join('\n');
  }

  function outingCsv(o) {
    var inv = o.alloc ? inverse(o.alloc) : {};
    var rows = [['Outing', 'Date', 'Prize', 'Golfer / winner', 'Drawn by', 'Amount']];
    POS.forEach(function (p) {
      var g = o.results && o.results[p[0]];
      if (g) rows.push([o.name, o.date, p[1], nm(o, g), inv[g] ? nm(o, inv[g]) : '', o.prizes[p[0]]]);
    });
    (o.extras || []).forEach(function (x) {
      if (x.winner) rows.push([o.name, o.date, x.title, nm(o, x.winner), '', x.prize]);
    });
    rows.push([]);
    rows.push(['Person making the draw', 'Golfer drawn', 'Paid']);
    o.participants.forEach(function (p) {
      rows.push([p.name, o.alloc && o.alloc[p.id] ? nm(o, o.alloc[p.id]) : '', o.paid[p.id] ? 'Yes' : 'No']);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /* ---------- PIN hashing ---------- */
  function hashPin(pin, salt) {
    var str = salt + ':' + pin;
    if (root.crypto && root.crypto.subtle && root.TextEncoder) {
      return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    var h = 2166136261;
    for (var r = 0; r < 5000; r++) for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Promise.resolve('f' + (h >>> 0).toString(16));
  }

  /* ---------- Backup validation ---------- */
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  function cleanOuting(o) {
    if (!isObj(o) || typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.participants)) return null;
    for (var i = 0; i < o.participants.length; i++) {
      var p = o.participants[i];
      if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string') return null;
    }
    var ids = o.participants.map(function (p) { return p.id; });
    if (o.alloc !== null && o.alloc !== undefined && !validateAlloc(ids, o.alloc)) return null;
    var base = mkOuting(o.name, [], 10);
    var out = {};
    for (var k in base) out[k] = o[k] !== undefined ? o[k] : base[k];
    out.alloc = o.alloc || null;
    ['paid', 'revealed', 'done'].forEach(function (f) { if (!isObj(out[f])) out[f] = {}; });
    if (!isObj(out.results)) out.results = base.results;
    if (!isObj(out.prizes)) out.prizes = base.prizes;
    if (!Array.isArray(out.extras)) out.extras = [];
    out.contribution = +out.contribution || 0;
    return out;
  }

  function validateBackup(obj) {
    try {
      if (!isObj(obj) || obj.app !== 'golf-outing-sweep' || typeof obj.version !== 'number') {
        return { ok: false, error: 'This is not a Golf Outing Sweep backup file.' };
      }
      var d = obj.data;
      if (!isObj(d) || !Array.isArray(d.players) || !Array.isArray(d.history) || !isObj(d.settings)) {
        return { ok: false, error: 'The backup is missing required sections.' };
      }
      for (var i = 0; i < d.players.length; i++) {
        var p = d.players[i];
        if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string') return { ok: false, error: 'The player list in this backup is damaged.' };
      }
      var history = [];
      for (var j = 0; j < d.history.length; j++) {
        var h = cleanOuting(d.history[j]);
        if (!h) return { ok: false, error: 'Outing ' + (j + 1) + ' in this backup is damaged or has an invalid draw.' };
        history.push(h);
      }
      var outing = null;
      if (d.outing) {
        outing = cleanOuting(d.outing);
        if (!outing) return { ok: false, error: 'The active outing in this backup is damaged or has an invalid draw.' };
      }
      return { ok: true, data: { settings: d.settings, players: d.players, history: history, outing: outing, draft: null } };
    } catch (e) {
      return { ok: false, error: 'The file could not be read.' };
    }
  }

  root.Core = {
    randInt: randInt, shuffle: shuffle, derange: derange, validateAlloc: validateAlloc, inverse: inverse,
    uid: uid, today: today, fmtDate: fmtDate, fmtTime: fmtTime, money: money, csvCell: csvCell, nm: nm,
    paidCount: paidCount, pickedCount: pickedCount, collected: collected, mkOuting: mkOuting,
    drawText: drawText, drawCsv: drawCsv, resultsText: resultsText, outingCsv: outingCsv,
    hashPin: hashPin, validateBackup: validateBackup, cleanOuting: cleanOuting
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
