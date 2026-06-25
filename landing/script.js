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

  // ---- GitHub API: 获取最新 Release 下载链接 ---- //

  /**
   * 匹配 macOS DMG 文件
   * 几种可能的命名模式：
   *   - "Luna AI Cut-1.2.4-arm64.dmg"
   *   - "Luna AI Cut-1.2.4-Mac-arm64.dmg"
   */
  function isDmg(name) {
    return /\.dmg$/i.test(name);
  }

  /** 匹配 Windows Setup exe 文件 */
  function isSetupExe(name) {
    return /Setup.*\.exe$/i.test(name) || /\.exe$/i.test(name);
  }

  fetch('https://api.github.com/repos/diamondfsd/luna-ai-cut/releases/latest')
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch release');
      return res.json();
    })
    .then(data => {
      const assets = data.assets || [];

      const macAsset = assets.find(a => isDmg(a.name));
      const winAsset = assets.find(a => isSetupExe(a.name));

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

  // ---- GitCode API: 获取国内镜像下载链接 ---- //

  const macCnLink = document.getElementById('dl-mac-cn');
  const winCnLink = document.getElementById('dl-win-cn');

  fetch('https://api.gitcode.com/api/v5/repos/diamondfsd/luna-ai-cut-package-release/releases')
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch GitCode releases');
      return res.json();
    })
    .then(releases => {
      if (!releases || releases.length === 0) throw new Error('No releases found');
      const latest = releases[0]; // 按创建时间降序，第一条是最新
      const assets = latest.assets || [];

      const macAsset = assets.find(a => isDmg(a.name));
      const winAsset = assets.find(a => isSetupExe(a.name));

      if (macAsset && macCnLink && macAsset.browser_download_url) {
        macCnLink.href = macAsset.browser_download_url;
        macCnLink.querySelector('.mirror-link-text').textContent = 'macOS 镜像下载';
      }
      if (winAsset && winCnLink && winAsset.browser_download_url) {
        winCnLink.href = winAsset.browser_download_url;
        winCnLink.querySelector('.mirror-link-text').textContent = 'Windows 镜像下载';
      }
    })
    .catch(() => {
      // GitCode API 失败时，链路跳转到 GitCode 仓库 Releases 页面（href 已预设）
    });
});
