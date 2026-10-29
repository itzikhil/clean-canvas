/* The TV side: Luna calls through PalmServiceBridge. In a desktop browser every call just logs. */
var TV = (function () {
  'use strict';

  var webos = typeof window.PalmServiceBridge !== 'undefined';
  var pending = [];   // a bridge is garbage-collected if nothing holds it before its reply arrives

  /** One Luna call; done(result) with null on failure. */
  function luna(uri, params, done) {
    if (!webos) {
      console.log('[luna]', uri, JSON.stringify(params || {}));
      if (done) setTimeout(function () { done({returnValue: true}); }, 0);
      return;
    }
    var bridge = new window.PalmServiceBridge();
    pending.push(bridge);
    bridge.onservicecallback = function (message) {
      pending.splice(pending.indexOf(bridge), 1);
      var res = null;
      try { res = JSON.parse(message); } catch (e) {}
      if (done) done(res && res.returnValue !== false ? res : null);
    };
    bridge.call(uri, JSON.stringify(params || {}));
  }

  /** Test only: the reply exactly as the TV sends it (first message). */
  function raw(uri, params, done) {
    if (!webos) { done({webos: false}); return; }
    var bridge = new window.PalmServiceBridge();
    pending.push(bridge);
    var sent = false;
    bridge.onservicecallback = function (message) {
      if (sent) return;
      sent = true;
      var res = null;
      try { res = JSON.parse(message); } catch (e) { res = {unparsed: String(message)}; }
      done(res);
    };
    bridge.call(uri, JSON.stringify(params || {}));
  }

  var subscriptions = [];   // held for the app's lifetime, so the bridges (and subscriptions) stay open

  /** A Luna subscription; onMessage(result) for every reply. */
  function subscribe(uri, params, onMessage) {
    if (!webos) return;
    var bridge = new window.PalmServiceBridge();
    subscriptions.push(bridge);
    bridge.onservicecallback = function (message) {
      var res = null;
      try { res = JSON.parse(message); } catch (e) {}
      onMessage(res);
    };
    bridge.call(uri, JSON.stringify(params || {}));
  }

  return {
    webos: webos,
    raw: raw,
    subscribe: subscribe,
    luna: luna,
    launch: function (id, done, params) {
      luna('luna://com.webos.applicationManager/launch', params ? {id: id, params: params} : {id: id}, function (res) {
        if (!res) console.warn('launch failed:', id);
        if (done) done(!!res);
      });
    }
  };
})();
