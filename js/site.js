/* Shared behaviour for all mockups: mobile nav, lightbox, contact form (mock). */
(function () {
  // Mobile navigation toggle
  document.querySelectorAll('[data-nav-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // Lightbox: every element with [data-work] opens the large image + title
  var items = Array.prototype.slice.call(document.querySelectorAll('[data-work]'));
  if (items.length) {
    var lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.hidden = true;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Sculpture viewer');
    lb.innerHTML =
      '<button class="lb-btn lb-close" aria-label="Close">&times;</button>' +
      '<button class="lb-btn lb-prev" aria-label="Previous sculpture">&#8249;</button>' +
      '<figure class="lb-fig"><img class="lb-img" alt="">' +
      '<figcaption class="lb-cap"><div class="lb-views" hidden></div><span class="lb-title"></span><span class="lb-meta"></span>' +
      '<a class="lb-cta" href="commissions.html">Commission something similar &rarr;</a></figcaption></figure>' +
      '<button class="lb-btn lb-next" aria-label="Next sculpture">&#8250;</button>';
    document.body.appendChild(lb);
    var img = lb.querySelector('.lb-img'), title = lb.querySelector('.lb-title'), meta = lb.querySelector('.lb-meta');
    var idx = 0, lastFocus = null, views = [], view = 0;
    var strip = lb.querySelector('.lb-views');
    function showView(v) {
      if (!views.length) return;
      view = (v + views.length) % views.length;
      img.src = views[view][0];
      Array.prototype.forEach.call(strip.children, function (b, k) { b.setAttribute('aria-current', k === view ? 'true' : 'false'); });
    }
    function show(i) {
      idx = (i + items.length) % items.length;
      var el = items[idx];
      views = []; view = 0;
      try { views = JSON.parse(el.getAttribute('data-views') || '[]'); } catch (err) { views = []; }
      strip.innerHTML = '';
      strip.hidden = views.length < 2;
      lb.classList.toggle('has-views', views.length > 1);
      views.forEach(function (v, k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'View ' + (k + 1) + ' of ' + views.length);
        b.innerHTML = '<img alt="" src="' + v[1] + '">';
        b.addEventListener('click', function () { showView(k); });
        strip.appendChild(b);
      });
      if (views.length > 1) showView(0);
      img.src = el.getAttribute('data-full');
      img.alt = el.getAttribute('data-title') + ' — paper mâché sculpture by Naava Naslavsky';
      title.textContent = el.getAttribute('data-title');
      meta.textContent = el.getAttribute('data-meta') || '';
    }
    function open(i) { lastFocus = document.activeElement; show(i); lb.hidden = false; document.body.classList.add('lb-open'); lb.querySelector('.lb-close').focus(); }
    function close() { lb.hidden = true; document.body.classList.remove('lb-open'); if (lastFocus) lastFocus.focus(); }
    items.forEach(function (el, i) { el.addEventListener('click', function (e) { e.preventDefault(); open(i); }); });
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.querySelector('.lb-prev').addEventListener('click', function () { show(idx - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { show(idx + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
      if (e.key === 'ArrowDown' && views.length > 1) { e.preventDefault(); showView(view + 1); }
      if (e.key === 'ArrowUp' && views.length > 1) { e.preventDefault(); showView(view - 1); }
    });
    // basic swipe on touch screens
    var x0 = null;
    lb.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1)); x0 = null;
    });
  }

  // Contact form: sent through FormSubmit (free), which forwards it to Naava's email.
  document.querySelectorAll('form[data-endpoint]').forEach(function (f) {
    var params = new URLSearchParams(location.search);
    if (params.get('topic') && f.topic) f.topic.value = params.get('topic');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = f.querySelector('.form-note'), btn = f.querySelector('button[type="submit"]');
      var data = {};
      new FormData(f).forEach(function (v, k) { data[k] = v; });
      if (data._honey) return;                       // spam bot
      data._replyto = data.email;
      btn.disabled = true; note.hidden = false; note.textContent = 'Sending…';
      fetch(f.getAttribute('data-endpoint'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(data)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          var msg = (res.j && res.j.message) || '';
          if (res.ok && String(res.j.success) === 'true') { note.textContent = 'Thank you! Your message was sent — I’ll get back to you soon.'; f.reset(); return; }
          if (/activat/i.test(msg)) {   // FormSubmit's one-time setup: the site owner must click the link it emailed her
            note.textContent = 'Almost ready: this contact form is waiting to be activated (a one-time step for the site owner). Please email me directly at nnaslavsky@unmc.edu for now.';
            if (window.console) console.warn('FormSubmit:', msg);
            return;
          }
          throw new Error(msg || 'unexpected reply');
        })
        .catch(function (err) {
          if (window.console) console.warn('Contact form error:', err && err.message);
          note.textContent = 'Sorry, the message couldn’t be sent' + (err && err.message ? ' (' + err.message + ')' : '') + '. Please email me directly at nnaslavsky@unmc.edu.';
        })
        .then(function () { btn.disabled = false; });
    });
  });
})();
