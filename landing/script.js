// Luna AI Cut — Landing Page Script

document.addEventListener('DOMContentLoaded', () => {
  // Smooth scroll for nav links
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Detect platform and highlight download
  const ua = navigator.userAgent.toLowerCase();
  const isMac = /macintosh|mac os x/.test(ua);
  const isWin = /windows|win32|win64/.test(ua);

  const macCard = document.getElementById('dl-mac');
  const winCard = document.getElementById('dl-win');

  // Set current date in the mockup
  const dateEl = document.getElementById('mockup-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  }

  // Auto-highlight the matching platform download card
  if (isMac && macCard) {
    macCard.style.borderColor = '#2997ff';
    macCard.style.background = 'rgba(41, 151, 255, 0.08)';
  } else if (isWin && winCard) {
    winCard.style.borderColor = '#2997ff';
    winCard.style.background = 'rgba(41, 151, 255, 0.08)';
  }

  // Fetch latest release download URLs from GitHub API
  fetch('https://api.github.com/repos/diamondfsd/luna-ai-cut/releases/latest')
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch release');
      return res.json();
    })
    .then(data => {
      const assets = data.assets || [];

      // Match macOS dmg: contains "-Mac-" and ends with ".dmg"
      const macAsset = assets.find(a => a.name.includes('-Mac-') && a.name.endsWith('.dmg'));
      // Match Windows setup exe: contains "-Windows-" and ends with "Setup.exe"
      const winAsset = assets.find(a => a.name.includes('-Windows-') && a.name.endsWith('Setup.exe'));

      if (macAsset && macCard) {
        macCard.href = macAsset.browser_download_url;
      }
      if (winAsset && winCard) {
        winCard.href = winAsset.browser_download_url;
      }
    })
    .catch(() => {
      // API 失败时不做任何事，卡片 href 保持指向 Releases 页面
    });
});
