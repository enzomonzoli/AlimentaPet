/* SMARTFEED CA-1 · simulação do funcionamento.
   Lê as configurações e os comandos enviados pela página Controle e anima o aparelho. */
(function () {
  'use strict';
  var SF = window.SF;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- atualização do DOM só quando muda ---------- */
  var cache = {};
  function T(id, s) { if (cache['t' + id] !== s) { cache['t' + id] = s; var e = $(id); if (e) e.textContent = s; } }
  function A(id, n, v) { var k = 'a' + id + n; v = String(v); if (cache[k] !== v) { cache[k] = v; var e = $(id); if (e) e.setAttribute(n, v); } }
  function S(id, p, v) { var k = 's' + id + p; if (cache[k] !== v) { cache[k] = v; var e = $(id); if (e) e.style[p] = v; } }
  function C(id, c, on) { on = !!on; var k = 'c' + id + c; if (cache[k] !== on) { cache[k] = on; var e = $(id); if (e) e.classList.toggle(c, on); } }

  function fmtG(n) { return Math.round(n).toLocaleString('pt-BR'); }
  function fmtL(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function r(n) { return fmtG(n); }
  function pad3(n) { n = Math.round(n); return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }

  /* ---------- estado ---------- */
  var cfg = SF.get('cfg');
  var dyn = SF.get('dyn');
  var prev = JSON.stringify(cfg);
  var job = null, queue = [], eat = null, petUntil = 0;
  var lastT = Date.now(), lastSave = 0, lastVirt = SF.virtNow(cfg), logSeen = -1;

  function rollDay(v) {
    var k = SF.dkey(v);
    if (dyn.dia !== k) { dyn.dia = k; dyn.feitas = {}; dyn.servidoHoje = 0; }
  }
  rollDay(lastVirt);
  dyn.nivel = Math.min(dyn.nivel, SF.capG(cfg));

  function log(txt, tipo) {
    dyn.logN = (dyn.logN || 0) + 1;
    dyn.log.unshift({ n: dyn.logN, t: SF.virtNow(cfg), txt: txt, tipo: tipo || 'info' });
    if (dyn.log.length > 40) dyn.log.length = 40;
  }
  function save(force) {
    var n = Date.now();
    if (force || n - lastSave > 300) { lastSave = n; SF.set('dyn', dyn); }
  }

  /* ---------- dosagem ---------- */
  function start(q) {
    var alvo = q.alvo;
    if (alvo <= 0) return;
    if (!cfg.pote) { log('Porção de ' + r(alvo) + ' g não servida: pote removido', 'warn'); return; }
    if (dyn.nivel <= 0.5) { dyn.porcao = true; log('Porção de ' + r(alvo) + ' g não servida: reservatório vazio', 'err'); return; }
    job = { alvo: alvo, servido: 0, origem: q.origem, rate: Math.min(30, Math.max(alvo / 1.2, 3)),
            limite: cfg.falha ? alvo * 0.25 : alvo, motivo: '' };
    log('Dosador ligado: ' + r(alvo) + ' g · ' + q.origem, 'info');
  }
  function finish() {
    var j = job; job = null;
    dyn.servidoHoje += j.servido;
    var diff = j.alvo - j.servido, tol = Math.max(3, j.alvo * 0.1);
    if (diff > tol) {
      dyn.porcao = true;
      log('Porção incorreta: servidos ' + r(j.servido) + ' g de ' + r(j.alvo) + ' g (' + (j.motivo || 'falha') + ')', 'err');
    } else {
      log('Servidos ' + r(j.servido) + ' g · ' + j.origem, 'ok');
    }
  }
  function abort(motivo) {
    if (!job) return;
    dyn.servidoHoje += job.servido;
    dyn.porcao = true;
    log('Dosagem interrompida (' + motivo + '): ' + r(job.servido) + ' g de ' + r(job.alvo) + ' g', 'err');
    job = null;
  }
  function stepJob(dt) {
    if (!job) return;
    if (!cfg.pote) { abort('pote removido'); return; }
    var space = SF.BOWL_MAX - dyn.pote;
    var d = Math.min(job.rate * dt, job.limite - job.servido, dyn.nivel, space);
    if (d > 0) { dyn.nivel -= d; dyn.pote += d; job.servido += d; }
    if (job.servido >= job.alvo - 0.05) finish();
    else if (job.servido >= job.limite - 0.05) { job.motivo = 'dosador travado'; finish(); }
    else if (dyn.nivel <= 0.05) { dyn.nivel = 0; job.motivo = 'reservatório vazio'; finish(); }
    else if (space - d <= 0.05) { job.motivo = 'pote cheio'; finish(); }
  }
  function stepEat(dt) {
    if (!eat) return;
    var d = Math.min(12 * dt, eat.resta, dyn.pote);
    dyn.pote -= d; eat.resta -= d;
    if (eat.resta <= 0.05 || dyn.pote <= 0.05) {
      if (dyn.pote < 0.05) dyn.pote = 0;
      log('O pet comeu ' + r(eat.total - Math.max(eat.resta, 0)) + ' g', 'info');
      eat = null; petUntil = Date.now() + 2500;
    }
  }

  /* ---------- refeições automáticas ---------- */
  function fire(i, ts) {
    var m = cfg.refeicoes[i];
    var key = SF.dkey(ts) + ':' + i;
    if (dyn.feitas[key]) return;
    dyn.feitas[key] = 1;
    queue.push({ alvo: m.g, origem: 'Refeição ' + (i + 1) + ' (automática)' });
  }
  function checkMeals(vNow) {
    var a = lastVirt, b = vNow;
    lastVirt = b;
    if (!cfg.automatico || b <= a) return;
    cfg.refeicoes.forEach(function (m, i) {
      if (!m.on) return;
      var p = String(m.hora).split(':'), hh = +p[0], mm = +p[1];
      if (isNaN(hh) || isNaN(mm)) return;
      var d = new Date(a);
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() <= a) d.setDate(d.getDate() + 1);
      var guard = 0;
      while (d.getTime() <= b && guard++ < 40) { fire(i, d.getTime()); d.setDate(d.getDate() + 1); }
    });
  }

  /* ---------- comandos vindos do Controle ---------- */
  function exec(m) {
    var d = m.data || {};
    var g = Math.max(0, +d.g || 0);
    var cap = SF.capG(cfg);
    switch (m.type) {
      case 'liberar':
        if (!cfg.alimentacao) return;
        if (!cfg.wifi) { log('Comando do aplicativo recusado: sem Wi-Fi', 'warn'); break; }
        log('Aplicativo: liberar ' + r(g) + ' g agora', 'info');
        queue.push({ alvo: g, origem: 'Aplicativo' });
        break;
      case 'abastecer':
        dyn.nivel = Math.min(cap, dyn.nivel + g);
        log('Reservatório abastecido: +' + r(g) + ' g', 'info');
        break;
      case 'encher': dyn.nivel = cap; log('Reservatório cheio: ' + r(cap) + ' g', 'info'); break;
      case 'esvaziar': dyn.nivel = 0; log('Reservatório esvaziado', 'info'); break;
      case 'pet':
        if (!cfg.pote) { log('O pet não tem pote para comer', 'warn'); break; }
        if (dyn.pote < 1) { log('O pet foi ao pote, mas ele está vazio', 'warn'); petUntil = Date.now() + 2500; break; }
        eat = { total: Math.min(g, dyn.pote), resta: Math.min(g, dyn.pote) };
        petUntil = Date.now() + 99999;
        break;
      case 'limpar_pote': dyn.pote = 0; log('Pote esvaziado', 'info'); break;
      case 'limpar_alertas': dyn.porcao = false; log('Alertas limpos', 'info'); break;
      case 'reiniciar':
        var keep = dyn.lastCmd;
        dyn = SF.fresh('dyn'); dyn.lastCmd = keep;
        job = null; queue = []; eat = null; petUntil = 0; cache = {}; logSeen = -1;
        rollDay(SF.virtNow(cfg));
        dyn.nivel = Math.min(dyn.nivel, cap);
        log('Simulação reiniciada', 'info');
        break;
    }
  }
  function runCmds() {
    var c = SF.get('cmd');
    if (c.seq < dyn.lastCmd) dyn.lastCmd = 0;
    c.list.forEach(function (m) {
      if (m.id <= dyn.lastCmd) return;
      dyn.lastCmd = m.id;
      if (m.ts > Date.now() - 300000) exec(m);
    });
  }

  /* ---------- mudança de configuração ---------- */
  function onCfg() {
    var n = SF.get('cfg');
    var j = JSON.stringify(n);
    if (j === prev) return;
    var o = JSON.parse(prev);
    cfg = n; prev = j;
    if (o.alimentacao !== n.alimentacao) {
      if (n.alimentacao) log('Aparelho ligado na tomada', 'ok');
      else { abort('falta de energia'); log('Sem energia: aparelho desligado', 'err'); }
    }
    if (n.alimentacao) {
      if (o.wifi !== n.wifi) log(n.wifi ? 'Wi-Fi conectado: aplicativo online' : 'Wi-Fi perdido: aplicativo offline', n.wifi ? 'ok' : 'warn');
      if (o.tampa !== n.tampa) log(n.tampa ? 'Tampa travada' : 'Tampa destravada', n.tampa ? 'ok' : 'warn');
      if (o.pote !== n.pote) { if (!n.pote) abort('pote removido'); log(n.pote ? 'Pote recolocado' : 'Pote removido para lavar', n.pote ? 'ok' : 'warn'); }
      if (o.falha !== n.falha) log(n.falha ? 'Falha simulada no dosador ativada' : 'Falha simulada no dosador desativada', 'info');
    }
    if (o.capacidadeL !== n.capacidadeL) log('Capacidade do reservatório: ' + fmtL(n.capacidadeL) + ' L', 'info');
    if (o.clock.rev !== n.clock.rev) {
      dyn.feitas = {}; lastVirt = SF.virtNow(n); rollDay(lastVirt);
      log('Hora do aparelho acertada: ' + SF.hm(lastVirt), 'info');
    }
    dyn.nivel = Math.min(dyn.nivel, SF.capG(n));
    render();
    save(true);
  }

  /* ---------- desenho ---------- */
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = Math.floor(min % 60);
    if (h > 0) return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
    if (m > 0) return m + ' min';
    return 'menos de 1 min';
  }
  function speedLabel(s) {
    if (s === 1) return 'tempo real';
    if (s === 1440) return '1.440× · 1 dia por minuto';
    return s.toLocaleString('pt-BR') + '× mais rápido';
  }

  function render() {
    var now = Date.now();
    var vNow = SF.virtNow(cfg);
    var on = cfg.alimentacao;
    var cap = SF.capG(cfg);
    var pct = Math.max(0, Math.min(100, dyn.nivel / cap * 100));

    var al = {
      baixa: on && pct <= cfg.alertaPct && dyn.nivel > 0.5,
      vazia: on && dyn.nivel <= 0.5,
      porcao: on && dyn.porcao,
      pote: on && !cfg.pote,
      tampa: on && !cfg.tampa,
      wifi: on && !cfg.wifi,
      energia: !on
    };

    /* A · reservatório */
    T('resG', fmtG(dyn.nivel));
    T('resPct', Math.round(pct) + '%');
    T('resL', fmtL(dyn.nivel / SF.BPG) + ' L de ' + fmtL(cfg.capacidadeL) + ' L');
    T('resAl', 'abaixo de ' + cfg.alertaPct + '%');
    S('resBar', 'width', pct.toFixed(1) + '%');
    C('resBar', 'low', pct <= cfg.alertaPct);
    S('resLow', 'left', cfg.alertaPct + '%');
    var HY = 40, HH = 144, ky = HY + HH * (1 - pct / 100);
    A('kFill', 'y', ky.toFixed(1)); A('kFill', 'height', (HY + HH - ky + 2).toFixed(1));
    A('kTop', 'y1', ky.toFixed(1)); A('kTop', 'y2', ky.toFixed(1));
    S('kTop', 'display', pct > 0.2 ? '' : 'none');
    var ly = HY + HH * (1 - cfg.alertaPct / 100);
    A('lowLine', 'y1', ly.toFixed(1)); A('lowLine', 'y2', ly.toFixed(1));

    /* tampa */
    A('lid', 'transform', cfg.tampa ? '' : 'translate(0 -14) rotate(-7 98 30)');
    S('latch', 'fill', cfg.tampa ? 'var(--ok)' : 'var(--crit)');

    /* E/F · pote e balança */
    var pote = cfg.pote ? dyn.pote : 0;
    var ph = Math.min(1, dyn.pote / SF.BOWL_MAX) * 26;
    var my = 412 - ph;
    A('mound', 'd', 'M86 412V' + (my + 3).toFixed(1) + 'Q170 ' + (my - 6).toFixed(1) + ' 254 ' + (my + 3).toFixed(1) + 'V412Z');
    S('mound', 'display', ph > 0.4 ? '' : 'none');
    A('bowlG', 'transform', cfg.pote ? '' : 'translate(-30 -46) rotate(-9 170 400)');
    S('bowlGhost', 'display', cfg.pote ? 'none' : '');
    T('balSvg', on ? pad3(pote) + ' g' : '--- g');
    T('balG', on ? pad3(pote) : '---');
    S('balBar', 'width', (Math.min(1, pote / SF.BOWL_MAX) * 100).toFixed(1) + '%');
    T('balSt', !on ? 'sem energia' : !cfg.pote ? 'sem pote' : eat ? 'pet comendo' : job ? 'recebendo ração' : pote < 1 ? 'pote vazio' : 'estável');
    T('balPote', cfg.pote ? 'instalado' : 'removido para lavar');

    /* D · motor e dosador */
    var run = !!job && on;
    C('dv', 'motor-on', run);
    C('dv', 'off', !on);
    S('mled', 'fill', run ? 'var(--accent)' : 'var(--steel)');
    T('dosEst', !on ? 'SEM ENERGIA' : run ? 'DOSANDO' : 'PARADO');
    C('dosEst', 'run', run); C('dosEst', 'off', !on);
    S('dosBar', 'width', job ? (job.servido / job.alvo * 100).toFixed(1) + '%' : '0%');
    T('dosTxt', job ? fmtG(job.servido) + ' de ' + fmtG(job.alvo) + ' g' : 'nenhuma em andamento');
    T('dosOri', job ? job.origem : '—');
    T('dosRate', job ? fmtG(job.rate) + ' g/s' : '0 g/s');
    T('dosHoje', fmtG(dyn.servidoHoje) + ' g' + (queue.length ? ' · ' + queue.length + ' na fila' : ''));
    T('dosFalha', cfg.falha ? 'com falha (simulada)' : 'normal');

    /* G · cabo */
    var px = on ? 322 : 282, py = on ? 426 : 402;
    A('cord', 'd', 'M276 334C306 350 ' + (px - 12) + ' ' + (py - 36) + ' ' + px + ' ' + py);
    A('plug', 'transform', 'translate(' + px + ' ' + py + ')' + (on ? '' : ' rotate(-12)'));

    /* H · Wi-Fi */
    var wst = !on ? 'off' : cfg.wifi ? 'on' : 'warn';
    A('wifi', 'class', 'wf ' + wst);
    S('wifiX', 'display', on && !cfg.wifi ? '' : 'none');
    A('led', 'class', 'ink ' + (!on ? 'led-off' : cfg.wifi ? 'led-on' : 'led-warn'));
    S('rec', 'display', on ? '' : 'none');

    /* B · display */
    var l1 = '', l2 = '', warn = false;
    if (on) {
      if (job) { l1 = 'SERVINDO'; l2 = pad3(job.servido) + '/' + pad3(job.alvo) + ' g'; }
      else {
        var list = [];
        if (al.vazia) list.push(['RESERV.', 'VAZIO']); else if (al.baixa) list.push(['RAÇÃO', 'BAIXA']);
        if (al.porcao) list.push(['PORÇÃO', 'INCORRETA']);
        if (al.pote) list.push(['POTE', 'REMOVIDO']);
        if (al.tampa) list.push(['TAMPA', 'DESTRAVADA']);
        if (al.wifi) list.push(['SEM', 'WI-FI']);
        if (!list.length) { l1 = 'APLICATIVO'; l2 = 'CONECTADO'; }
        else { var p = list[Math.floor(now / 2200) % list.length]; l1 = p[0]; l2 = p[1]; warn = true; }
      }
    }
    T('lcd1', l1); T('lcd2', l2);
    C('lcd1', 'warn', warn); C('lcd2', 'warn', warn);

    /* B · programação */
    var vd = new Date(vNow);
    var nowMin = vd.getHours() * 60 + vd.getMinutes() + vd.getSeconds() / 60;
    var today = SF.dkey(vNow);
    T('clk', SF.hms(vNow));
    T('clkDia', vd.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }));
    T('clkSp', speedLabel(cfg.clock.speed));
    var nextIdx = -1, nextDelta = 1e9;
    cfg.refeicoes.forEach(function (m, i) {
      if (!m.on || dyn.feitas[today + ':' + i]) return;
      var p = String(m.hora).split(':'), mm = (+p[0]) * 60 + (+p[1]);
      if (isNaN(mm)) return;
      var dl = (mm - nowMin + 1440) % 1440;
      if (dl < nextDelta) { nextDelta = dl; nextIdx = i; }
    });
    cfg.refeicoes.forEach(function (m, i) {
      var done = !!dyn.feitas[today + ':' + i];
      var p = String(m.hora).split(':'), mm = (+p[0]) * 60 + (+p[1]);
      var st;
      if (!m.on) st = 'desativada';
      else if (done) st = 'servida';
      else if (!cfg.automatico) st = 'pausada';
      else if (i === nextIdx) st = 'próxima, em ' + fmtDur(nextDelta);
      else st = mm > nowMin ? 'aguardando' : 'passou';
      T('mt' + i, m.hora); T('mg' + i, fmtG(m.g) + ' g'); T('ms' + i, st);
      C('ml' + i, 'next', m.on && !done && cfg.automatico && i === nextIdx);
      C('ml' + i, 'done', m.on && done);
      C('ml' + i, 'off', !m.on);
    });
    T('modo', cfg.automatico ? 'Modo automático ativo. O aplicativo também pode liberar porções.' : 'Modo automático pausado. Só o aplicativo libera porções.');

    /* alertas */
    var info = { baixa: 'warn', vazia: 'crit', porcao: 'crit', pote: 'warn', tampa: 'warn', wifi: 'warn', energia: 'crit' };
    Object.keys(info).forEach(function (k) {
      C('al_' + k, info[k], al[k]);
      T('al_' + k + '_s', al[k] ? 'ativo' : 'inativo');
    });

    /* sistema */
    T('sAli', on ? 'fonte elétrica conectada' : 'desconectada');
    T('sWifi', !on ? '—' : cfg.wifi ? 'Wi-Fi conectado' : 'sem Wi-Fi');
    T('sCtrl', !on ? '—' : (cfg.automatico ? 'automático ativo' : 'automático pausado') + ' · aplicativo ' + (cfg.wifi ? 'online' : 'offline'));
    T('sTampa', cfg.tampa ? 'travada' : 'destravada');
    T('sCap', fmtL(cfg.capacidadeL) + ' L · cerca de ' + fmtG(cap) + ' g');
    T('sPub', (cfg.publico === 'gato' ? 'gato' : 'cão') + (cfg.nome ? ' · ' + cfg.nome : '') + ' (cães e gatos)');

    /* C · câmera */
    var feed = on && cfg.wifi;
    S('camOff', 'display', feed ? 'none' : '');
    T('camMsg', !on ? 'SEM SINAL' : 'SEM TRANSMISSÃO · SEM WI-FI');
    S('camScene', 'display', feed ? '' : 'none');
    S('camRec', 'display', on ? '' : 'none');
    T('camT', SF.hms(vNow));
    var petOn = !!eat || now < petUntil;
    S('camPet', 'display', petOn ? '' : 'none');
    S('petCao', 'display', cfg.publico === 'gato' ? 'none' : '');
    S('petGato', 'display', cfg.publico === 'gato' ? '' : 'none');
    A('camPet', 'transform', 'translate(0 ' + (eat ? (Math.sin(now / 170) > 0 ? 30 : 24) : 0) + ')');
    var cph = Math.min(1, dyn.pote / SF.BOWL_MAX) * 18;
    var cy = 166 - cph;
    A('camMound', 'd', 'M105 166V' + (cy + 4).toFixed(1) + 'Q160 ' + (cy - 5).toFixed(1) + ' 215 ' + (cy + 4).toFixed(1) + 'V166Z');
    S('camMound', 'display', cfg.pote && cph > 0.3 ? '' : 'none');

    /* registro */
    if (logSeen !== dyn.logN) {
      logSeen = dyn.logN;
      var ul = $('log');
      ul.textContent = '';
      if (!dyn.log.length) {
        var e0 = document.createElement('li'), s0 = document.createElement('span');
        s0.className = 'empty'; s0.textContent = 'Nenhum evento ainda.'; e0.appendChild(s0); ul.appendChild(e0);
      }
      dyn.log.slice(0, 14).forEach(function (it) {
        var li = document.createElement('li'), t = document.createElement('time'), s = document.createElement('span');
        t.textContent = SF.hm(it.t); s.textContent = it.txt; s.className = it.tipo;
        li.appendChild(t); li.appendChild(s); ul.appendChild(li);
      });
    }

    /* vínculo com a página Controle */
    var linked = SF.alive('c');
    C('linkPill', 'on', linked);
    T('linkTxt', linked ? 'Controle conectado' : 'Página de controle fechada');
  }

  /* ---------- laço principal ---------- */
  function tick() {
    var now = Date.now();
    var dt = Math.min((now - lastT) / 1000, 5);
    lastT = now;
    cfg = SF.get('cfg');
    var vNow = SF.virtNow(cfg);
    rollDay(vNow);
    runCmds();
    if (cfg.alimentacao) {
      checkMeals(vNow);
      if (!job && queue.length) start(queue.shift());
      stepJob(dt);
    } else {
      lastVirt = vNow;
      queue = [];
    }
    stepEat(dt);
    render();
    save(false);
  }

  SF.on('cfg', onCfg);
  SF.on('cmd', function () { runCmds(); render(); save(true); });

  runCmds();
  log('Painel de funcionamento aberto', 'info');
  SF.beat('f');
  setInterval(function () { SF.beat('f'); }, 1000);
  setInterval(tick, 100);
  tick();
  save(true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
})();
