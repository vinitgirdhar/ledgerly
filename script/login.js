document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('container');
  const toRegisterBtn = document.getElementById('register');
  const toLoginBtn = document.getElementById('login');

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, data };
  }

  if (toRegisterBtn) {
    toRegisterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      container.classList.add('right-panel-active');
      history.replaceState(null, '', '#register');
    });
  }

  if (toLoginBtn) {
    toLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      container.classList.remove('right-panel-active');
      history.replaceState(null, '', '#login');
    });
  }

  // Video sound toggle
  const bgVideo = document.getElementById('bgVideo');
  const soundBtn = document.getElementById('videoSoundToggle');
  if (bgVideo && soundBtn) {
    soundBtn.addEventListener('click', () => {
      const willMute = !bgVideo.muted;
      bgVideo.muted = willMute;
      soundBtn.textContent = willMute ? '🔊 Enable Sound' : '🔈 Mute';
      soundBtn.setAttribute('aria-label', willMute ? 'Enable sound' : 'Mute');
      soundBtn.title = willMute ? 'Enable sound' : 'Mute';
    });
  }

  // Simple validation helpers
  function setFieldError(wrapper, smallSelector, msg) {
    const small = wrapper.querySelector(smallSelector);
    if (small) small.textContent = msg || '';
  }

  // Register form
  const regForm = document.getElementById('registerForm');
  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById('username');
      const emailEl = document.getElementById('email');
      const passEl = document.getElementById('password');
      const cpassEl = document.getElementById('confirm-password');

      let ok = true;
      if (!nameEl.value.trim()) { ok = false; }
      if (!emailEl.value.includes('@')) { ok = false; }
      if (passEl.value.length < 8) { ok = false; }
      if (cpassEl.value !== passEl.value) { ok = false; }

      if (!ok) {
        const status = document.getElementById('register-status');
        if (status) { status.className = 'form-status error'; status.textContent = 'Please fix the highlighted fields.'; }
        return;
      }

      const status = document.getElementById('register-status');
      if (status) { status.className = 'form-status'; status.textContent = 'Creating account...'; }

      const resp = await postJson('/api/register', {
        username: nameEl.value.trim(),
        email: emailEl.value.trim(),
        password: passEl.value
      });

      if (!resp.ok) {
        let msg = 'Registration failed.';
        if (resp.data) {
          if (resp.data.error === 'user_exists') {
            msg = '❌ Email already registered. Please use a different email or log in.';
          } else if (resp.data.message) {
            msg = resp.data.message;
          } else if (resp.data.error) {
            msg = resp.data.error;
          }
        }
        if (status) { status.className = 'form-status error'; status.textContent = msg; }
        return;
      }

      if (status) { status.className = 'form-status success'; status.textContent = 'Registered! You can now log in.'; }
      container.classList.remove('right-panel-active');
      history.replaceState(null, '', '#login');
    });
  }

  // Login form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userEl = loginForm.querySelector('.username-2');
      const passEl = loginForm.querySelector('.password-2');
      if (!userEl.value.trim() || passEl.value.length < 8) {
        const status = document.getElementById('login-status');
        if (status) { status.className = 'form-status error'; status.textContent = 'Enter valid credentials.'; }
        return;
      }
      const status = document.getElementById('login-status');

      if (status) { status.className = 'form-status'; status.textContent = 'Signing in...'; }

      const rememberEl = document.getElementById('checkbox');
      const resp = await postJson('/api/login', {
        identifier: userEl.value.trim(),
        password: passEl.value,
        remember: Boolean(rememberEl && rememberEl.checked)
      });

      if (!resp.ok) {
        const msg = (resp.data && (resp.data.message || resp.data.error)) ? (resp.data.message || resp.data.error) : 'Login failed.';
        if (status) { status.className = 'form-status error'; status.textContent = msg; }
        return;
      }

      if (status) { status.className = 'form-status success'; status.textContent = 'Logged in! Redirecting...'; }
      setTimeout(() => { window.location.href = '/dashboard'; }, 500);
    });
  }
});
