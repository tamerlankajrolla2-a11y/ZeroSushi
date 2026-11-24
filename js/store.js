/* Zero Sushi — слой данных.
   Меню, заказы и вход в админку хранятся на сервере sites-api (Cloudflare Worker + база D1):
   что поменяли в админке — сразу видно на сайте у всех, заказы видны в админке с любого устройства.
   Если сервер недоступен, сайт показывает меню из data/menu.json (или последнюю сохранённую копию).
*/
window.Store = (function () {
  'use strict';

  var API = 'https://sites-api.tamerlankajrolla2.workers.dev', SITE = 'zerosushi';
  var LS_MENU = 'zerosushi_menu', LS_TOK = 'zerosushi_api_token';

  function ls(k, v) {
    try {
      if (v === undefined) { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
      return v;
    } catch (e) { return null; }
  }

  var token = ls(LS_TOK) || null;    // {token, exp}
  function authed() { return !!(token && token.token && token.exp > Date.now()); }
  function req(path, opt) {
    opt = opt || {};
    var h = { 'Content-Type': 'application/json' };
    if (opt.auth && authed()) h.Authorization = 'Bearer ' + token.token;
    return fetch(API + path + (path.indexOf('?') < 0 ? '?' : '&') + 'site=' + SITE, {
      method: opt.method || 'GET', headers: h, cache: 'no-store', keepalive: !!opt.keepalive,
      body: opt.body !== undefined ? (typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body)) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
        if (!r.ok) {
          var msg = (d && d.error) || ('HTTP ' + r.status);
          if (r.status === 401 && opt.auth) { logout(); msg = 'вход истёк, обновите страницу и войдите снова'; }
          if (r.status === 401 && !opt.auth) msg = 'неверный пароль';
          if (r.status === 413) msg = 'меню слишком большое — уберите часть загруженных фото';
          var e2 = new Error(msg); e2.status = r.status; throw e2;
        }
        return d;
      });
    });
  }

  /* ---------- меню ---------- */
  var cache = null, upgraded = false;
  var DEFAULT_CATS = [
    { id: 'sets', name: 'Сеты', icon: '🍱', view: 'cards', sort: 'manual', on: true },
    { id: 'rolls', name: 'Роллы', icon: '🍣', view: 'list', sort: 'manual', on: true },
    { id: 'pizza', name: 'Пиццы', icon: '🍕', view: 'list', sort: 'manual', on: true, sub: 'Все пиццы 30 см' },
    { id: 'chicken', name: 'Чикен и комбо', icon: '🍗', view: 'list', sort: 'manual', on: true },
    { id: 'dops', name: 'Соусы и напитки', icon: '🥤', view: 'list', sort: 'manual', on: true, noMega: true, upsell: true }
  ];

  function fromFile() {
    var p = location.pathname.replace(/[^/]*$/, '');
    return fetch(p + 'data/menu.json?v=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error('menu.json не найден');
      return r.json();
    });
  }

  // приводит данные к текущему виду
  function normalize(d) {
    d = d || {};
    var s = d.settings = d.settings || {};
    if (!d.items && d.sets) d.items = d.sets;
    delete d.sets;
    d.items = d.items || [];
    if (!d.cats || !d.cats.length) d.cats = JSON.parse(JSON.stringify(DEFAULT_CATS));
    d.items = d.items.map(function (x) {
      x.cat = x.cat || 'sets';
      x.on = x.on !== false;
      x.price = +x.price || 0;
      x.old = +x.old || 0;
      x.chips = x.chips || [];
      x.groups = x.groups || [];
      x.desc = x.desc || '';
      x.img = x.img || '';
      x.grp = x.grp || '';
      x.opts = (Array.isArray(x.opts) ? x.opts : []).map(function (o) { return { n: String(o.n || '').trim(), p: +o.p || 0 }; }).filter(function (o) { return o.n && o.p > 0; });
      if (x.opts.length) x.price = Math.min.apply(null, x.opts.map(function (o) { return o.p; }));
      return x;
    });
    var known = {};
    d.cats.forEach(function (c) { c.on = c.on !== false; c.view = c.view || 'list'; c.sort = c.sort || 'manual'; known[c.id] = 1; });
    d.items.forEach(function (x) {
      if (!known[x.cat]) { d.cats.push({ id: x.cat, name: x.cat, icon: '', view: 'list', sort: 'manual', on: true }); known[x.cat] = 1; }
    });
    d.promo = d.promo || {};
    if (!d.promo.gift) d.promo.gift = { on: !!s.gift, title: s.gift || 'Подарок при первом заказе', text: '' };
    d.promo.codes = d.promo.codes || [];
    // «Мега выгода»: зачёркнутая цена = настоящая + add, надпись на всех товарах
    if (!d.promo.mega) d.promo.mega = { on: false, title: 'Мега выгода', add: 2000 };
    d.promo.mega.on = d.promo.mega.on !== false;
    d.promo.mega.add = +d.promo.mega.add || 0;
    if (d.promo.mega.title == null) d.promo.mega.title = 'Мега выгода';
    // блок «О нас»
    var ab = d.about = d.about || {};
    ab.on = ab.on !== false;
    if (ab.title == null) ab.title = 'О нас';
    if (ab.text == null) ab.text = 'Zero Sushi — суши, пицца и чикен с доставкой по Петропавловску.';
    ab.address = ab.address || '';
    ab.points = Array.isArray(ab.points) ? ab.points : [];
    if (!s.delivery) s.delivery = { price: 0, freeFrom: 0, note: s.deliveryNote || 'доставку подтвердит оператор' };
    s.delivery.price = +s.delivery.price || 0;
    s.delivery.freeFrom = +s.delivery.freeFrom || 0;
    s.minOrder = +s.minOrder || 0;
    s.pay = s.pay && s.pay.length ? s.pay : ['Kaspi', 'Наличными'];
    d.rev = +d.rev || 1;
    return d;
  }
  function hasItems(d) { return !!(d && ((d.items && d.items.length) || (d.sets && d.sets.length))); }

  /* Новая версия меню от разработчика (data/menu.json с большим rev) заменяет меню на сервере,
     только если владелец ещё ничего не менял в админке (edited !== true). */
  function loadMenu(force) {
    if (cache && !force) return Promise.resolve(cache);
    upgraded = false;
    var file = fromFile().catch(function () { return null; });
    return req('/menu').then(function (r) {
      var d = r && r.data;
      return file.then(function (f) {
        if (hasItems(d)) {
          if (f && hasItems(f) && (+f.rev || 1) > (+d.rev || 1) && !d.edited) { upgraded = true; return normalize(f); }
          ls(LS_MENU, d); return normalize(d);
        }
        if (f) return normalize(f);
        throw new Error('нет меню');
      });
    }).catch(function () {
      var local = ls(LS_MENU);
      return hasItems(local) ? normalize(local) : file.then(function (f) { if (!f) throw new Error('нет меню'); return normalize(f); });
    }).then(function (d) { cache = d; return d; });
  }

  function saveMenu(d) {
    cache = normalize(d); upgraded = false;
    return req('/menu', { method: 'PUT', auth: true, body: JSON.stringify(cache) })
      .then(function () { ls(LS_MENU, cache); return true; });
  }

  // взять меню из файла data/menu.json и записать на сервер
  function resetMenu() {
    return fromFile().then(normalize).then(function (d) { d.edited = false; return saveMenu(d).then(function () { return cache; }); });
  }
  function fileRev() { return fromFile().then(function (d) { return +d.rev || 1; }); }

  /* ---------- заказы ---------- */
  function createOrder(o) {
    return req('/order', { method: 'POST', body: o, keepalive: true }).then(function (r) { return (r && r.id) || true; }).catch(function () { return false; });
  }
  // Telegram-уведомления о заказах (бот на сервере)
  function tgInfo() { return req('/tg', { auth: true }); }
  function tgLink() { return req('/tg/link', { method: 'POST', auth: true, body: {} }); }
  function tgOff() { return req('/tg', { method: 'DELETE', auth: true }); }
  // свой бот сайта: токен из @BotFather вводит владелец в админке, сервер сам проверит бота и подключит его
  function tgOwn(token) { return req('/tg/own', { method: 'POST', auth: true, body: { token: token } }); }
  // промокод: можно ли применить (сервер помнит номера телефонов). Старый сервер или нет сети — не мешаем заказу.
  function promoCheck(code, phone) {
    var t = new Promise(function (res) { setTimeout(function () { res({ allowed: true, offline: true }); }, 6000); });
    var q = req('/promo?code=' + encodeURIComponent(code) + '&phone=' + encodeURIComponent(phone || '')).then(function (r) {
      return r && typeof r.allowed === 'boolean' ? r : { allowed: true, offline: true };
    }).catch(function () { return { allowed: true, offline: true }; });
    return Promise.race([q, t]);
  }
  function promoStats() { return req('/promo/stats', { auth: true }); }
  function promoReset(code) { return req('/promo/uses?code=' + encodeURIComponent(code), { method: 'DELETE', auth: true }); }
  function listOrders(limit) { return req('/orders?limit=' + (limit || 200), { auth: true }); }
  function setStatus(id, status) { return req('/order?id=' + encodeURIComponent(id), { method: 'PATCH', auth: true, body: { status: status } }); }

  /* ---------- вход ---------- */
  function login(pass) {
    return req('/login', { method: 'POST', body: { password: pass } }).then(function (d) {
      token = { token: d.token, exp: d.exp }; ls(LS_TOK, token); return token;
    });
  }
  /* первое подключение сайта к серверу: ключ разработчика + пароль админки (вводит разработчик) */
  function register(master, pass) { return req('/register', { method: 'POST', body: { master: master, password: pass } }); }
  /* true — сайт подключён, false — сервер не знает сайт, null — нет связи */
  function connected() { return req('/menu').then(function () { return true; }, function (e) { return e.status === 404 ? false : null; }); }
  function logout() { token = null; ls(LS_TOK, null); }
  function changePassword(pw) { return req('/password', { method: 'POST', auth: true, body: { password: pw } }); }

  return {
    loadMenu: loadMenu, saveMenu: saveMenu, resetMenu: resetMenu, fromFile: fromFile, fileRev: fileRev, normalize: normalize,
    createOrder: createOrder, promoCheck: promoCheck, promoStats: promoStats, promoReset: promoReset, listOrders: listOrders, setStatus: setStatus, tgInfo: tgInfo, tgLink: tgLink, tgOff: tgOff, tgOwn: tgOwn,
    login: login, register: register, connected: connected, upgraded: function () { return upgraded; }, logout: logout, authed: authed, changePassword: changePassword,
    isCloud: function () { return true; }, api: API
  };
})();
