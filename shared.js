/* SMARTFEED CA-1 · estado compartilhado entre as páginas Funcionamento e Controle.
   Cada chave tem um único escritor:
     cfg  -> página Controle   (configurações e relógio)
     cmd  -> página Controle   (comandos pontuais)
     dyn  -> página Funcionamento (nível, balança, registro)
   A comunicação usa BroadcastChannel + localStorage (evento "storage"). */
(function (w) {
  'use strict';

  var P = 'smartfeed.ca1.';
  var KEYS = { cfg: P + 'cfg', dyn: P + 'dyn', cmd: P + 'cmd' };
  var BPG = 500;       // g de ração seca por litro (estimativa)
  var BOWL_MAX = 450;  // g que o pote comporta

  var DEF = {
    cfg: function () {
      var t = Date.now();
      return {
        nome: 'Thor', publico: 'cao', capacidadeL: 4, alertaPct: 15,
        alimentacao: true, wifi: true, tampa: true, pote: true,
        automatico: true, falha: false,
        refeicoes: [
          { on: true, hora: '07:00', g: 60 },
          { on: true, hora: '12:00', g: 50 },
          { on: true, hora: '17:30', g: 50 },
          { on: true, hora: '21:30', g: 40 }
        ],
        clock: { virt: t, real: t, speed: 1, rev: 0 }
      };
    },
    dyn: function () {
      return { nivel: 1500, pote: 0, feitas: {}, porcao: false, log: [], logN: 0,
               servidoHoje: 0, dia: '', lastCmd: 0 };
    },
    cmd: function () { return { seq: 0, list: [] }; }
  };

  var mem = {};
  var subs = { cfg: [], dyn: [], cmd: [] };
  var hbMem = {};
  var bc = null;
  try { bc = new BroadcastChannel('smartfeed-ca1'); } catch (e) { bc = null; }

  function fill(k, o) {
    var d = DEF[k]();
    if (!o || typeof o !== 'object') return d;
    for (var p in d) { if (!(p in o)) o[p] = d[p]; }
    if (k === 'cfg' && (!Array.isArray(o.refeicoes) || o.refeicoes.length !== 4)) o.refeicoes = d.refeicoes;
    return o;
  }
  function read(k) {
    try {
      var r = w.localStorage.getItem(KEYS[k]);
      if (r) return fill(k, JSON.parse(r));
    } catch (e) {}
    return null;
  }
  function get(k) {
    if (!mem[k]) mem[k] = read(k) || DEF[k]();
    return mem[k];
  }
  function emit(k) {
    subs[k].forEach(function (f) { try { f(mem[k]); } catch (e) { console.error(e); } });
  }
  function set(k, v) {
    mem[k] = v;
    try { w.localStorage.setItem(KEYS[k], JSON.stringify(v)); } catch (e) {}
    if (bc) { try { bc.postMessage({ k: k, v: v }); } catch (e) {} }
    emit(k);
  }
  function on(k, f) { subs[k].push(f); }

  if (bc) {
    bc.onmessage = function (ev) {
      var m = ev.data;
      if (!m) return;
      if (m.k === 'hb') { hbMem[m.w] = m.t; return; }
      if (subs[m.k]) { mem[m.k] = fill(m.k, m.v); emit(m.k); }
    };
  }
  w.addEventListener('storage', function (ev) {
    for (var k in KEYS) {
      if (KEYS[k] === ev.key && ev.newValue) {
        try { mem[k] = fill(k, JSON.parse(ev.newValue)); emit(k); } catch (e) {}
      }
    }
  });

  function patch(fn) {
    var c = read('cfg') || get('cfg');
    fn(c);
    set('cfg', c);
    return c;
  }
  function send(type, data) {
    var c = read('cmd') || get('cmd');
    c.seq += 1;
    c.list.push({ id: c.seq, type: type, data: data || {}, ts: Date.now() });
    if (c.list.length > 20) c.list = c.list.slice(-20);
    set('cmd', c);
    return c.seq;
  }

  function beat(who) {
    var t = Date.now();
    hbMem[who] = t;
    try { w.localStorage.setItem(P + 'hb.' + who, String(t)); } catch (e) {}
    if (bc) { try { bc.postMessage({ k: 'hb', w: who, t: t }); } catch (e) {} }
  }
  function alive(who) {
    var t = hbMem[who] || 0;
    try { var s = +w.localStorage.getItem(P + 'hb.' + who); if (s > t) t = s; } catch (e) {}
    return Date.now() - t < 4500;
  }

  function virtNow(c) { return c.clock.virt + (Date.now() - c.clock.real) * c.clock.speed; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hms(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function dkey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function capG(c) { return c.capacidadeL * BPG; }

  w.SF = {
    get: get, set: set, on: on, patch: patch, send: send, beat: beat, alive: alive,
    fresh: function (k) { return DEF[k](); },
    virtNow: virtNow, hm: hm, hms: hms, dkey: dkey, pad: pad, capG: capG,
    BPG: BPG, BOWL_MAX: BOWL_MAX
  };
})(window);
