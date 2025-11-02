// Common header for all pages
function renderHeader(activePage) {
    return `
        <div class="app-header">
            <div class="header-content">
                <a href="/landing.html" class="logo">
                    <span class="logo-icon"></span>
                    <span class="logo-text">Portfolio Manager</span>
                </a>
                <nav class="main-nav">
                    <a href="/news.html" class="${activePage === 'news' ? 'active' : ''}">News</a>
                    <a href="/dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">Dashboard</a>
                    <a href="/digest.html" class="${activePage === 'digest' ? 'active' : ''}">Daily Digest</a>
                    <a href="/analysis.html" class="${activePage === 'analysis' ? 'active' : ''}">Portfolio Analytics</a>
                </nav>
                <nav class="secondary-nav">
                    <a href="/holdings.html" class="${activePage === 'holdings' ? 'active' : ''}">Manage Holdings</a>
                    <a href="/settings.html" class="${activePage === 'settings' ? 'active' : ''}">System Settings</a>
                    <a href="#" onclick="logout(event)" class="logout-link">Logout</a>
                </nav>
            </div>
        </div>
    `;
}

// Logout function
async function logout(event) {
    event.preventDefault();
    
    try {
        await fetch('/api/logout', {
            method: 'POST'
        });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login.html';
    }
}

// Common CSS for header
const headerCSS = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #f5f5f7;
        min-height: 100vh;
    }
    .app-header {
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: saturate(180%) blur(20px);
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        position: sticky;
        top: 0;
        z-index: 1000;
        padding: 0 40px;
    }
    .header-content {
        max-width: 1400px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 64px;
        gap: 40px;
    }
    .logo {
        display: flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: #1d1d1f;
        font-weight: 600;
        font-size: 18px;
        transition: opacity 0.2s;
    }
    .logo:hover { opacity: 0.7; }
    .logo-icon { font-size: 24px; }
    .main-nav {
        display: flex;
        gap: 32px;
        flex: 1;
    }
    .main-nav a, .secondary-nav a {
        color: #1d1d1f;
        text-decoration: none;
        font-size: 15px;
        font-weight: 500;
        padding: 8px 0;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
    }
    .main-nav a:hover, .secondary-nav a:hover {
        color: #0071e3;
    }
    .main-nav a.active, .secondary-nav a.active {
        color: #0071e3;
        border-bottom-color: #0071e3;
    }
    .logout-link {
        color: #ff3b30 !important;
    }
    .logout-link:hover {
        color: #ff453a !important;
    }
    .secondary-nav {
        display: flex;
        gap: 20px;
    }
    .page-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 40px 40px;
    }
    h1 {
        font-size: 40px;
        font-weight: 700;
        color: #1d1d1f;
        margin-bottom: 10px;
        letter-spacing: -0.5px;
    }
    .subtitle {
        color: #86868b;
        font-size: 18px;
        margin-bottom: 40px;
    }
    
    @media (max-width: 768px) {
        .app-header { padding: 0 20px; }
        .header-content { flex-wrap: wrap; height: auto; padding: 12px 0; }
        .main-nav, .secondary-nav { flex-direction: column; gap: 12px; }
    }
`;