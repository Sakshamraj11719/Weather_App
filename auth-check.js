// Auth check and logout functionality
(function() {
  const sessionToken = localStorage.getItem('sessionToken');

  if (!sessionToken) {
    window.location.href = '/auth.html';
    return;
  }

  fetch('/api/auth/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.authenticated) {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('user');
      window.location.href = '/auth.html';
      return;
    }

    if (data.user) localStorage.setItem('user', JSON.stringify(data.user));

    const welcomeEl = document.getElementById('welcomeUser');
    if (welcomeEl && data.user) welcomeEl.textContent = `Welcome, ${data.user.name}!`;

    // Show admin link for admins
    if (data.user && data.user.role === 'admin') {
      const adminLink = document.getElementById('adminPanelLink');
      if (adminLink) adminLink.style.display = '';
    }

    // Announcement banner
    try {
      const ann = JSON.parse(localStorage.getItem('weather_announcement') || 'null');
      if (ann && (!ann.expiresAt || ann.expiresAt > Date.now())) {
        const banner = document.getElementById('announcementBanner');
        if (banner) {
          const colors = { info: '#00d4ff', warning: '#ffb820', success: '#00e5a0', error: '#ff4060' };
          const col = colors[ann.type] || '#00d4ff';
          const icons = { info: 'ℹ️', warning: '⚠️', success: '✅', error: '🚨' };
          banner.style.cssText = `display:flex;align-items:center;gap:12px;padding:10px 24px;background:${col}18;border-bottom:1px solid ${col}44;font-size:13px;`;
          banner.innerHTML = `<span>${icons[ann.type]||'📢'}</span><span style="flex:1;color:#e2eaf4">${ann.text}</span><button onclick="this.parentElement.style.display='none'" style="background:none;border:none;color:#5a7290;cursor:pointer;font-size:18px;padding:0 4px">✕</button>`;
        }
      }
    } catch(e) {}
  })
  .catch(() => { window.location.href = '/auth.html'; });

  window.logout = async function() {
    if (confirm('Are you sure you want to logout?')) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken })
        });
      } catch(e) {}
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('user');
      window.location.href = '/auth.html';
    }
  };

  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [url, config = {}] = args;
    if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
      config.headers = { ...config.headers, 'Authorization': `Bearer ${sessionToken}` };
    }
    return originalFetch(url, config);
  };
})();
