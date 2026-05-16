(function () {
  'use strict';

  var script = document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();

  var BOT_ID   = script.getAttribute('data-bot-id');
  var COLOR    = script.getAttribute('data-color') || '#1a9e5c';
  var POSITION = script.getAttribute('data-position') || 'bottom-right';
  var API_BASE = script.src.replace('/widget.js', '');

  if (!BOT_ID) {
    console.error('[Wispy] data-bot-id is required');
    return;
  }

  var sessionId = null;
  var isOpen    = false;
  var isInited  = false;
  var botConfig = null;
  var leadAsked = false;
  var msgCount  = 0;

  function storageGet(k) {
    try { return localStorage.getItem('wispy_' + BOT_ID + '_' + k); } catch (e) { return null; }
  }
  function storageSet(k, v) {
    try { localStorage.setItem('wispy_' + BOT_ID + '_' + k, v); } catch (e) {}
  }

  function apiFetch(path, body) {
    return fetch(API_BASE + '/api/widget/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  var isLeft = POSITION === 'bottom-left';
  var css = [
    '#wispy-launcher{position:fixed;z-index:2147483647;bottom:20px;' + (isLeft ? 'left:20px' : 'right:20px') + ';width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.28);transition:transform .2s,box-shadow .2s;font-size:26px;}',
    '#wispy-launcher:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(0,0,0,.32);}',
    '#wispy-box{position:fixed;z-index:2147483646;bottom:88px;' + (isLeft ? 'left:20px' : 'right:20px') + ';width:370px;height:580px;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.22);background:#fff;transition:opacity .25s,transform .25s;transform-origin:' + (isLeft ? 'bottom left' : 'bottom right') + ';}',
    '#wispy-box.wispy-hidden{opacity:0;transform:scale(.93) translateY(14px);pointer-events:none;}',
    '#wispy-header{display:flex;align-items:center;gap:10px;padding:14px 16px;flex-shrink:0;color:#fff;}',
    '#wispy-header .w-avatar{font-size:24px;line-height:1;}',
    '#wispy-header .w-title{flex:1;font-weight:700;font-size:15px;}',
    '#wispy-header .w-close{background:none;border:none;color:rgba(255,255,255,.85);font-size:20px;cursor:pointer;padding:2px 6px;line-height:1;}',
    '#wispy-header .w-close:hover{color:#fff;}',
    '#wispy-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f7f8fa;}',
    '.w-msg{max-width:82%;padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;word-break:break-word;animation:wfadein .2s ease;}',
    '.w-msg.w-bot{background:#fff;border:1px solid #e5e7eb;align-self:flex-start;border-bottom-left-radius:4px;color:#111;}',
    '.w-msg.w-user{align-self:flex-end;border-bottom-right-radius:4px;color:#fff;}',
    '@keyframes wfadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '.w-typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#c0c4cc;margin:0 2px;animation:wbounce .9s infinite ease-in-out;}',
    '.w-typing span:nth-child(2){animation-delay:.15s;}',
    '.w-typing span:nth-child(3){animation-delay:.3s;}',
    '@keyframes wbounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}',
    '#wispy-footer{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #f0f0f0;background:#fff;flex-shrink:0;}',
    '#wispy-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:9px 14px;font-size:14px;font-family:inherit;outline:none;resize:none;max-height:100px;overflow-y:auto;line-height:1.4;}',
    '#wispy-input:focus{border-color:' + COLOR + ';}',
    '#wispy-send{width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:17px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s;}',
    '#wispy-send:hover{opacity:.85;}',
    '#wispy-send:disabled{opacity:.4;cursor:not-allowed;}',
    '#wispy-branding{text-align:center;font-size:11px;color:#c0c4cc;padding:5px 0 9px;background:#fff;flex-shrink:0;}',
    '#wispy-branding a{color:#c0c4cc;text-decoration:none;}',
    '#wispy-branding a:hover{color:#999;}',
    '#wispy-lead-form{padding:14px 16px;background:#fff;border-top:1px solid #f0f0f0;flex-shrink:0;}',
    '#wispy-lead-form .lf-title{font-size:13px;font-weight:600;color:#333;margin:0 0 10px;}',
    '#wispy-lead-form input{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;margin-bottom:8px;}',
    '#wispy-lead-form input:focus{border-color:' + COLOR + ';}',
    '#wispy-lead-submit{width:100%;border:none;border-radius:8px;padding:9px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s;}',
    '#wispy-lead-submit:hover{opacity:.88;}',
    '@media(max-width:420px){#wispy-box{width:calc(100vw - 16px);height:72vh;bottom:0;' + (isLeft ? 'left:0' : 'right:0') + ';border-radius:16px 16px 0 0;}}',
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var launcher = document.createElement('button');
  launcher.id = 'wispy-launcher';
  launcher.style.background = COLOR;
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.textContent = '\uD83D\uDCAC';

  var box = document.createElement('div');
  box.id = 'wispy-box';
  box.className = 'wispy-hidden';
  box.innerHTML =
    '<div id="wispy-header" style="background:' + COLOR + '">' +
      '<span class="w-avatar" id="w-avatar">\uD83E\uDD16</span>' +
      '<span class="w-title" id="w-botname">Chat</span>' +
      '<button class="w-close" id="w-close" aria-label="Close">\u2715</button>' +
    '</div>' +
    '<div id="wispy-messages"></div>' +
    '<div id="wispy-footer">' +
      '<textarea id="wispy-input" rows="1" placeholder="Type a message..."></textarea>' +
      '<button id="wispy-send" style="background:' + COLOR + '" aria-label="Send">&#10148;</button>' +
    '</div>' +
    '<div id="wispy-branding">Powered by <a href="https://wispyaii.com" target="_blank" rel="noopener">Wispy</a></div>';

  document.body.appendChild(launcher);
  document.body.appendChild(box);

  var messagesEl = document.getElementById('wispy-messages');
  var inputEl    = document.getElementById('wispy-input');
  var sendBtn    = document.getElementById('wispy-send');

  function openChat() {
    isOpen = true;
    box.classList.remove('wispy-hidden');
    launcher.textContent = '\u2715';
    if (!isInited) initSession();
    else inputEl.focus();
  }

  function closeChat() {
    isOpen = false;
    box.classList.add('wispy-hidden');
    launcher.textContent = '\uD83D\uDCAC';
  }

  launcher.addEventListener('click', function () { isOpen ? closeChat() : openChat(); });
  document.getElementById('w-close').addEventListener('click', closeChat);

  function addMessage(text, role) {
    var div = document.createElement('div');
    div.className = 'w-msg w-' + role;
    if (role === 'user') div.style.background = COLOR;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'w-msg w-bot w-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showLeadForm() {
    if (leadAsked || document.getElementById('wispy-lead-form')) return;
    leadAsked = true;
    var lc = (botConfig && botConfig.leadCapture) || {};
    if (!lc.enabled) return;

    var form = document.createElement('div');
    form.id = 'wispy-lead-form';

    var fields = '';
    if (lc.askName !== false)  fields += '<input id="wlf-name"  type="text"  placeholder="Your name" />';
    if (lc.askEmail !== false) fields += '<input id="wlf-email" type="email" placeholder="Email address" />';
    if (lc.askPhone)           fields += '<input id="wlf-phone" type="tel"   placeholder="Phone number" />';

    form.innerHTML =
      '<p class="lf-title">Leave your details and we\'ll follow up!</p>' +
      fields +
      '<button id="wispy-lead-submit" style="background:' + COLOR + '">Submit</button>';

    box.insertBefore(form, document.getElementById('wispy-footer'));

    document.getElementById('wispy-lead-submit').addEventListener('click', function () {
      var name  = (document.getElementById('wlf-name')  || {}).value || '';
      var email = (document.getElementById('wlf-email') || {}).value || '';
      var phone = (document.getElementById('wlf-phone') || {}).value || '';

      if (lc.askEmail !== false && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('Please enter a valid email address.');
        return;
      }

      apiFetch('lead', { sessionId: sessionId, name: name, email: email, phone: phone })
        .then(function () {
          form.innerHTML = '<p style="color:#16a34a;text-align:center;padding:8px 0">\u2705 Thanks! We\'ll be in touch.</p>';
          setTimeout(function () { if (form.parentNode) form.remove(); }, 3000);
        })
        .catch(function () { if (form.parentNode) form.remove(); });
    });
  }

  function initSession() {
    isInited = true;
    var savedSession = storageGet('session');
    var typing = showTyping();

    apiFetch('init', {
      botId:       BOT_ID,
      sessionId:   savedSession || undefined,
      visitorInfo: { page: window.location.href, userAgent: navigator.userAgent },
    }).then(function (data) {
      typing.remove();
      if (!data.success) {
        addMessage('Unable to start chat. Please try again later.', 'bot');
        return;
      }
      sessionId = data.sessionId;
      botConfig  = data.bot;
      storageSet('session', sessionId);

      document.getElementById('w-avatar').textContent  = data.bot.avatarEmoji || '\uD83E\uDD16';
      document.getElementById('w-botname').textContent = data.bot.name || 'Chat';

      if (data.bot.theme && data.bot.theme.showBranding === false) {
        var brand = document.getElementById('wispy-branding');
        if (brand) brand.style.display = 'none';
      }

      addMessage(data.bot.welcomeMessage || 'Hi! How can I help you today?', 'bot');
      inputEl.focus();
    }).catch(function () {
      typing.remove();
      addMessage('Unable to connect. Please try again later.', 'bot');
    });
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !sessionId) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    addMessage(text, 'user');
    msgCount++;

    var typing = showTyping();
    sendBtn.disabled = true;

    apiFetch('message', {
      botId:       BOT_ID,
      sessionId:   sessionId,
      message:     text,
      visitorInfo: { page: window.location.href },
    }).then(function (data) {
      typing.remove();
      sendBtn.disabled = false;
      if (!data.success) {
        addMessage('Something went wrong. Please try again.', 'bot');
        return;
      }
      addMessage(data.message, 'bot');
      var trigger = (botConfig && botConfig.leadCapture && botConfig.leadCapture.triggerAfter) || 2;
      if (msgCount >= trigger && !data.leadCaptured) showLeadForm();
    }).catch(function () {
      typing.remove();
      sendBtn.disabled = false;
      addMessage('Connection error. Please try again.', 'bot');
    });
  }

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  window.addEventListener('beforeunload', function () {
    if (sessionId) {
      var data = JSON.stringify({ sessionId: sessionId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_BASE + '/api/widget/end', data);
      }
    }
  });

})();
