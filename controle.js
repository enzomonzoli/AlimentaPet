/* SMARTFEED CA-1 · página Controle: só entrada de dados.
   Tudo o que muda aqui vai para a página Funcionamento. */
(function () {
  'use strict';
  var SF = window.SF;
  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = 0;

  function num(el, min, max, fallback) {
    var v = parseFloat(String(el.value).replace(',', '.'));
    if (isNaN(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }
  function fmtL(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function stamp() { $('sync').textContent = 'Ajuste enviado às ' + SF.hms(Date.now()) + '.'; }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.textContent = ''; }, 4000);
  }
  function setVal(id, v) { var e = $(id); if (e && document.activeElement !== e && e.value !== String(v)) e.value = v; }
  function setChk(id, v) { var e = $(id); if (e) e.checked = !!v; }

  /* ---------- formulário <- estado ---------- */
  function paint(c) {
    setVal('nome', c.nome);
    $('pub-cao').checked = c.publico !== 'gato';
    $('pub-gato').checked = c.publico === 'gato';
    setVal('capL', c.capacidadeL);
    $('capLv').textContent = fmtL(c.capacidadeL);
    $('capG').textContent = '≈ ' + Math.round(SF.capG(c)).toLocaleString('pt-BR') + ' g de ração seca';
    setVal('alertaPct', c.alertaPct);
    ['alimentacao', 'wifi', 'tampa', 'pote', 'falha', 'automatico'].forEach(function (k) { setChk(k, c[k]); });
    var tot = 0;
    c.refeicoes.forEach(function (m, i) {
      setChk('m' + i + 'on', m.on);
      setVal('m' + i + 'h', m.hora);
      setVal('m' + i + 'g', m.g);
      if (m.on) tot += m.g;
    });
    $('totDia').textContent = tot.toLocaleString('pt-BR') + ' g';
    $('vel').value = String(c.clock.speed);
    $('offNote').hidden = c.alimentacao;
    $('wifiNote').hidden = !c.alimentacao || c.wifi;
  }

  /* ---------- estado <- formulário ---------- */
  function patch(fn) { var c = SF.patch(fn); paint(c); stamp(); }

  $('nome').addEventListener('input', function (e) { patch(function (c) { c.nome = e.target.value.slice(0, 24); }); });
  ['pub-cao', 'pub-gato'].forEach(function (id) {
    $(id).addEventListener('change', function (e) { patch(function (c) { c.publico = e.target.value; }); });
  });
  $('capL').addEventListener('input', function (e) {
    var v = Math.round(num(e.target, 3.5, 4.5, 4) * 10) / 10;
    patch(function (c) { c.capacidadeL = v; });
  });
  $('alertaPct').addEventListener('input', function (e) {
    if (e.target.value === '') return;
    var v = Math.round(num(e.target, 1, 50, 15));
    patch(function (c) { c.alertaPct = v; });
  });
  ['alimentacao', 'wifi', 'tampa', 'pote', 'falha', 'automatico'].forEach(function (k) {
    $(k).addEventListener('change', function (e) { patch(function (c) { c[k] = e.target.checked; }); });
  });
  [0, 1, 2, 3].forEach(function (i) {
    $('m' + i + 'on').addEventListener('change', function (e) { patch(function (c) { c.refeicoes[i].on = e.target.checked; }); });
    $('m' + i + 'h').addEventListener('input', function (e) {
      if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
      patch(function (c) { c.refeicoes[i].hora = e.target.value; });
    });
    $('m' + i + 'g').addEventListener('input', function (e) {
      if (e.target.value === '') return;
      var v = Math.round(num(e.target, 5, 300, 50));
      patch(function (c) { c.refeicoes[i].g = v; });
    });
  });

  $('vel').addEventListener('change', function (e) {
    var s = +e.target.value || 1;
    patch(function (c) {
      var v = SF.virtNow(c);
      c.clock = { virt: v, real: Date.now(), speed: s, rev: c.clock.rev };
    });
  });
  $('btnHora').addEventListener('click', function () {
    var p = String($('hora').value || '').split(':');
    if (p.length < 2) { toast('Escolha um horário para acertar o relógio.'); return; }
    patch(function (c) {
      var d = new Date(SF.virtNow(c));
      d.setHours(+p[0], +p[1], 0, 0);
      c.clock = { virt: d.getTime(), real: Date.now(), speed: c.clock.speed, rev: c.clock.rev + 1 };
    });
    toast('Relógio acertado para ' + $('hora').value + '.');
  });

  /* ---------- comandos ---------- */
  function cmd(type, data, msg) { SF.send(type, data); toast(msg); stamp(); }
  $('btnLib').addEventListener('click', function () {
    var g = Math.round(num($('cmdLib'), 5, 300, 50));
    cmd('liberar', { g: g }, 'Enviado: liberar ' + g + ' g.');
  });
  $('btnAdd').addEventListener('click', function () {
    var g = Math.round(num($('cmdAdd'), 10, 2250, 500));
    cmd('abastecer', { g: g }, 'Enviado: adicionar ' + g + ' g ao reservatório.');
  });
  $('btnEncher').addEventListener('click', function () { cmd('encher', {}, 'Enviado: encher o reservatório.'); });
  $('btnEsvaziar').addEventListener('click', function () { cmd('esvaziar', {}, 'Enviado: esvaziar o reservatório.'); });
  $('btnPet').addEventListener('click', function () {
    var g = Math.round(num($('cmdPet'), 5, 300, 30));
    cmd('pet', { g: g }, 'Enviado: o pet come até ' + g + ' g.');
  });
  $('btnPote').addEventListener('click', function () { cmd('limpar_pote', {}, 'Enviado: esvaziar o pote.'); });
  $('btnAlertas').addEventListener('click', function () { cmd('limpar_alertas', {}, 'Enviado: limpar alertas.'); });
  $('btnReset').addEventListener('click', function () { cmd('reiniciar', {}, 'Enviado: reiniciar a simulação.'); });

  /* ---------- vínculo com a página Funcionamento ---------- */
  function refresh() {
    var c = SF.get('cfg');
    $('vclock').textContent = SF.hms(SF.virtNow(c));
    var live = SF.alive('f');
    $('linkPill').classList.toggle('on', live);
    $('linkTxt').textContent = live ? 'Funcionamento conectado' : 'Funcionamento fechado';
    var d = SF.get('dyn');
    $('lastEvt').textContent = d.log && d.log[0] ? 'Último evento: ' + SF.hm(d.log[0].t) + ' · ' + d.log[0].txt : '';
  }

  SF.on('cfg', paint);
  paint(SF.get('cfg'));
  SF.beat('c');
  setInterval(function () { SF.beat('c'); }, 1000);
  setInterval(refresh, 500);
  refresh();
})();
