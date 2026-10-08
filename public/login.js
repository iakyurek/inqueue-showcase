(function () {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const submit = document.getElementById('loginSubmit');
  const params = new URLSearchParams(window.location.search);
  // Only ever redirect to a same-origin path after login. A cross-origin or
  // malformed `next` collapses to the dashboard so a crafted ?next= can't turn
  // the login page into an open redirect. Same-origin absolute URLs (used by
  // the hub's own gated-page redirects) are accepted and reduced to a path.
  function safeNext(raw) {
    if (!raw) return '/';
    try {
      const u = new URL(raw, window.location.origin);
      if (u.origin !== window.location.origin) return '/';
      const rel = u.pathname + u.search + u.hash;
      if (!rel.startsWith('/') || rel.startsWith('//')) return '/';
      return rel;
    } catch {
      return '/';
    }
  }
  const next = safeNext(params.get('next'));

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }
  function clearError() {
    errorBox.classList.remove('show');
    errorBox.textContent = '';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: document.getElementById('usernameInput').value,
          password: document.getElementById('passwordInput').value,
        }),
      });
      if (res.ok) {
        // Full navigation so the cookie is applied by the browser before the
        // gated destination reloads.
        window.location.href = next;
        return;
      }
      let msg = 'Invalid username or password.';
      try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
      showError(msg);
    } catch (err) {
      showError('Network error. Try again.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
})();
