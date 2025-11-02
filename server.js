require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Resend } = require('resend');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true,  // HTTPS required for production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'none'  // Allow cross-site cookies
    }
}));

// Static files AFTER session
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);
const MARKETSTACK_API_KEY = process.env.MARKETSTACK_API_KEY;
const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const CACHE_FILE = './cache.json';
const SETTINGS_FILE = './settings.json';
const USAGE_FILE = './api-usage.json';
const USERS_FILE = './users.json';
const PORTFOLIO_FILE = './portfolio.json';

// Load cache
let cache = {};
try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch (error) {
    cache = {};
}

// Load users
let users = [];
try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch (error) {
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    users = [{
    id: 1,
    username: 'admin',
    password: defaultPassword,
    name: 'Administrator',
    email: 'admin@example.com',
    receiveDailyDigest: true,
    receiveWeeklyDigest: true,
    receiveScheduledUpdates: true
}];
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    console.log('Default admin user created: username=admin, password=admin123');
}

// Load settings
let settings = {
    days: [2, 4, 6],
    hour: 17,
    minute: 0
};
try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
} catch (error) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Load API usage tracking
let apiUsage = {
    marketstack: [],
    newsapi: [],
    anthropic: []
};
try {
    apiUsage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
} catch (error) {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(apiUsage, null, 2));
}

// Load portfolio
let serverPortfolio = [];
try {
    serverPortfolio = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
    console.log('Portfolio loaded:', serverPortfolio);
} catch (error) {
    serverPortfolio = [];
}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function saveUsage() {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(apiUsage, null, 2));
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function savePortfolio() {
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(serverPortfolio, null, 2));
}

function trackAPI(service, ticker) {
    const timestamp = new Date().toISOString();
    apiUsage[service].push({
        ticker: ticker,
        timestamp: timestamp,
        date: new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane' }),
        time: new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane' })
    });
    
    if (apiUsage[service].length > 1000) {
        apiUsage[service] = apiUsage[service].slice(-1000);
    }
    
    saveUsage();
}

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ error: 'Not authenticated' });
        } else {
            res.redirect('/login.html');
        }
    }
}


// Public routes (no auth required)
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'public', 'landing.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// Auth endpoints
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id;
        res.json({ 
            success: true, 
            user: { 
                id: user.id,
                name: user.name, 
                email: user.email 
            } 
        });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/current-user', (req, res) => {
    if (req.session.userId) {
        const user = users.find(u => u.id === req.session.userId);
        res.json({ 
            loggedIn: true, 
            user: { 
                id: user.id,
                name: user.name, 
                email: user.email 
            } 
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// User management endpoints
app.get('/api/users', isAuthenticated, (req, res) => {
    const usersWithoutPasswords = users.map(u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        receiveDailyDigest: u.receiveDailyDigest,
        receiveWeeklyDigest: u.receiveWeeklyDigest !== undefined ? u.receiveWeeklyDigest : false,
        receiveScheduledUpdates: u.receiveScheduledUpdates
    }));
    res.json(usersWithoutPasswords);
});

app.post('/api/users/:id/preferences', isAuthenticated, async (req, res) => {
    const userId = parseInt(req.params.id);
    const { receiveDailyDigest, receiveWeeklyDigest, receiveScheduledUpdates } = req.body;
    
    const user = users.find(u => u.id === userId);
    if (user) {
        user.receiveDailyDigest = receiveDailyDigest;
        user.receiveWeeklyDigest = receiveWeeklyDigest !== undefined ? receiveWeeklyDigest : user.receiveWeeklyDigest;
        user.receiveScheduledUpdates = receiveScheduledUpdates;
        saveUsers();
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'User not found' });
    }
});

app.post('/api/users', isAuthenticated, async (req, res) => {
    const { username, password, name, email } = req.body;
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
    id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
    username,
    password: hashedPassword,
    name,
    email,
    receiveDailyDigest: false,
    receiveWeeklyDigest: false,
    receiveScheduledUpdates: true
};
    
    users.push(newUser);
    saveUsers();
    res.json({ success: true, user: { id: newUser.id, username, name, email } });
});

app.delete('/api/users/:id', isAuthenticated, (req, res) => {
    const userId = parseInt(req.params.id);
    
    if (req.session.userId === userId) {
        return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }
    
    users = users.filter(u => u.id !== userId);
    saveUsers();
    res.json({ success: true });
});
app.post('/api/users/:id/change-password', isAuthenticated, async (req, res) => {
    const userId = parseInt(req.params.id);
    const { currentPassword, newPassword } = req.body;
    
    // Users can only change their own password
    if (req.session.userId !== userId) {
        return res.status(403).json({ success: false, message: 'You can only change your own password' });
    }
    
    const user = users.find(u => u.id === userId);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    
    // Hash and update new password
    user.password = await bcrypt.hash(newPassword, 10);
    saveUsers();
    
    res.json({ success: true, message: 'Password changed successfully' });
});
// Protected API endpoints
app.get('/api/settings', isAuthenticated, (req, res) => {
    res.json({
        days: settings.days,
        time: `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`
    });
});

app.post('/api/settings', isAuthenticated, (req, res) => {
    settings = {
        days: req.body.days || [],
        hour: req.body.hour || 17,
        minute: req.body.minute || 0
    };
    saveSettings();
    
    console.log('Settings updated:', settings);
    console.log('Restart server to apply new schedule');
    
    res.json({ success: true });
});

app.get('/api/history/:ticker', isAuthenticated, async (req, res) => {
    const { ticker } = req.params;
    const days = parseInt(req.query.days) || 30;
    
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        const formatDate = (date) => date.toISOString().split('T')[0];
        
        const response = await fetch(
            `http://api.marketstack.com/v1/eod?` +
            `access_key=${process.env.MARKETSTACK_API_KEY}` +
            `&symbols=${ticker}` +
            `&date_from=${formatDate(startDate)}` +
            `&date_to=${formatDate(endDate)}` +
            `&limit=1000`
        );
        
        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            return res.json([]);
        }
        
        const history = data.data
            .map(item => ({
                date: item.date.split('T')[0],
                close: item.close,
                open: item.open,
                high: item.high,
                low: item.low
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        res.json(history);
        
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

app.get('/api/search-ticker', isAuthenticated, async (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
        return res.json({ quotes: [] });
    }
    
    try {
        const response = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        );
        
        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Ticker search error:', error);
        res.status(500).json({ quotes: [] });
    }
});

app.get('/api/exchange-rate/:from/:to', isAuthenticated, async (req, res) => {
    const { from, to } = req.params;
    
    try {
        const response = await fetch(
            `https://api.exchangerate-api.com/v4/latest/${from}`
        );
        
        const data = await response.json();
        const rate = data.rates[to];
        
        res.json({ rate: rate || 1 });
        
    } catch (error) {
        console.error('Exchange rate error:', error);
        res.json({ rate: 1 });
    }
});

app.get('/api/usage', isAuthenticated, (req, res) => {
    const today = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane' });
    
    const last7Days = {};
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane' });
        
        last7Days[dateStr] = {
            marketstack: apiUsage.marketstack.filter(u => u.date === dateStr).length,
            newsapi: apiUsage.newsapi.filter(u => u.date === dateStr).length,
            anthropic: apiUsage.anthropic.filter(u => u.date === dateStr).length
        };
    }
    
    const stats = {
        today: {
            marketstack: apiUsage.marketstack.filter(u => u.date === today).length,
            newsapi: apiUsage.newsapi.filter(u => u.date === today).length,
            anthropic: apiUsage.anthropic.filter(u => u.date === today).length
        },
        thisMonth: {
            marketstack: apiUsage.marketstack.filter(u => u.timestamp.startsWith(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'))).length,
            newsapi: apiUsage.newsapi.filter(u => u.timestamp.startsWith(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'))).length,
            anthropic: apiUsage.anthropic.filter(u => u.timestamp.startsWith(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'))).length
        },
        last7Days: last7Days,
        recent: {
            marketstack: apiUsage.marketstack.slice(-10).reverse(),
            newsapi: apiUsage.newsapi.slice(-10).reverse(),
            anthropic: apiUsage.anthropic.slice(-10).reverse()
        }
    };
    
    res.json(stats);
});

app.post('/api/sync-portfolio', isAuthenticated, (req, res) => {
    serverPortfolio = req.body.tickers || [];
    console.log('Portfolio synced:', serverPortfolio);
    savePortfolio();
    res.json({ success: true });
});

app.post('/api/update-all', isAuthenticated, async (req, res) => {
    const { tickers } = req.body;
    console.log(`Updating ${tickers.length} stocks...`);
    
    for (const ticker of tickers) {
        try {
            await updateStock(ticker);
        } catch (error) {
            console.error(`Failed to update ${ticker}:`, error.message);
        }
    }
    
    res.json({ success: true, message: 'All stocks updated' });
});

app.get('/api/stock/:ticker', isAuthenticated, async (req, res) => {
    const { ticker } = req.params;
    
    try {
        const today = new Date().toDateString();
        if (cache[ticker] && cache[ticker].date === today) {
            console.log(`Using cached data for ${ticker}`);
            return res.json(cache[ticker].data);
        }
        
        console.log(`Fetching fresh data for ${ticker}...`);
        const data = await updateStock(ticker);
        res.json(data);
    } catch (error) {
        console.error(`Error fetching ${ticker}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/digest', isAuthenticated, async (req, res) => {
    const { tickers } = req.body;
    
    try {
        console.log('Generating digest for portfolio...');
        
        const stocksData = [];
        for (const ticker of tickers) {
            try {
                const today = new Date().toDateString();
                let data;
                
                if (cache[ticker] && cache[ticker].date === today) {
                    data = cache[ticker].data;
                } else {
                    data = await updateStock(ticker);
                }
                
                stocksData.push({
                    ticker: ticker,
                    ...data
                });
            } catch (error) {
                console.error(`Error loading ${ticker}:`, error);
            }
        }
        
        const sorted = [...stocksData].sort((a, b) => b.price.changePercent - a.price.changePercent);
        const topGainer = sorted[0];
        const topLoser = sorted[sorted.length - 1];
        
        const keyNews = stocksData
            .filter(s => s.summary && s.summary !== 'No significant news today.')
            .map(s => ({ ticker: s.ticker, summary: s.summary }));
        
        const newsText = keyNews.map(n => `${n.ticker}: ${n.summary}`).join('\n\n');
        const avgChange = stocksData.reduce((sum, s) => sum + s.price.changePercent, 0) / stocksData.length;
        
        const executiveSummary = await generateExecutiveSummary(stocksData.length, avgChange, topGainer, topLoser, newsText);
        
        const actionItems = [];
        if (Math.abs(topGainer.price.changePercent) > 5) {
            actionItems.push(`${topGainer.ticker} up ${topGainer.price.changePercent.toFixed(2)}% - Review position size`);
        }
        if (Math.abs(topLoser.price.changePercent) > 5) {
            actionItems.push(`${topLoser.ticker} down ${Math.abs(topLoser.price.changePercent).toFixed(2)}% - Investigate cause`);
        }
        if (keyNews.length > 3) {
            actionItems.push(`${keyNews.length} stocks with significant news - Review detailed summaries`);
        }
        
        res.json({
            executiveSummary,
            topGainer: {
                ticker: topGainer.ticker,
                price: topGainer.price.price,
                changePercent: topGainer.price.changePercent
            },
            topLoser: {
                ticker: topLoser.ticker,
                price: topLoser.price.price,
                changePercent: topLoser.price.changePercent
            },
            keyNews,
            actionItems
        });
        
    } catch (error) {
        console.error('Error generating digest:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get weekly data for stock
async function getWeeklyHistory(ticker) {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        
        const formatDate = (date) => date.toISOString().split('T')[0];
        
        const response = await fetch(
            `http://api.marketstack.com/v1/eod?` +
            `access_key=${MARKETSTACK_API_KEY}` +
            `&symbols=${ticker}` +
            `&date_from=${formatDate(startDate)}` +
            `&date_to=${formatDate(endDate)}` +
            `&limit=10`
        );
        
        const data = await response.json();
        
        if (!data.data || data.data.length < 2) {
            return { weeklyChange: 0, high: 0, low: 0 };
        }
        
        const sorted = data.data.sort((a, b) => new Date(a.date) - new Date(b.date));
        const weekStart = sorted[0].close;
        const weekEnd = sorted[sorted.length - 1].close;
        const weeklyChange = ((weekEnd - weekStart) / weekStart) * 100;
        
        const high = Math.max(...sorted.map(d => d.high));
        const low = Math.min(...sorted.map(d => d.low));
        
        return { weeklyChange, high, low };
    } catch (error) {
        console.error(`Error getting weekly history for ${ticker}:`, error);
        return { weeklyChange: 0, high: 0, low: 0 };
    }
}

async function updateStock(ticker) {
    const priceUrl = `http://api.marketstack.com/v1/eod/latest?access_key=${MARKETSTACK_API_KEY}&symbols=${ticker}`;
    const priceResponse = await axios.get(priceUrl);
    trackAPI('marketstack', ticker);
    const quote = priceResponse.data.data[0];
    
    let searchQuery = ticker.replace('.AX', '');
    if (ticker.includes('.AX')) {
        const companyNames = {
            'CBA': 'Commonwealth Bank Australia',
            'BHP': 'BHP Group',
            'CSL': 'CSL Limited',
            'NAB': 'National Australia Bank',
            'WBC': 'Westpac Banking',
            'ANZ': 'ANZ Bank',
            'WES': 'Wesfarmers',
            'WOW': 'Woolworths Group'
        };
        searchQuery = companyNames[searchQuery] || `${searchQuery} ASX stock`;
    } else {
        searchQuery = `${searchQuery} stock`;
    }
    
    const newsUrl = `https://newsapi.org/v2/everything?q="${searchQuery}"&sortBy=publishedAt&language=en&pageSize=10&apiKey=${NEWSAPI_KEY}`;
    const newsResponse = await axios.get(newsUrl);
    trackAPI('newsapi', ticker);
    const news = newsResponse.data.articles || [];
    
    const newsSummary = await summarizeNews(ticker, news);
    trackAPI('anthropic', ticker);
    
    const data = {
        price: {
            symbol: quote.symbol,
            price: quote.close,
            change: quote.close - quote.open,
            changePercent: ((quote.close - quote.open) / quote.open) * 100,
            currency: quote.exchange
        },
        news: news,
        summary: newsSummary
    };
    
    cache[ticker] = {
        date: new Date().toDateString(),
        data: data
    };
    saveCache();
    
    return data;
}

async function summarizeNews(ticker, articles) {
    if (!articles.length) return "No significant news today.";
    
    const newsText = articles.slice(0, 10).map(a => 
        `Title: ${a.title}\nDescription: ${a.description || 'No description'}`
    ).join('\n\n');
    
    const message = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        messages: [{
            role: 'user',
            content: `Analyze these news articles about ${ticker}. Return ONLY the 1-2 most important bullet points for a long-term investor. Skip routine market updates. Focus on: earnings, major announcements, significant partnerships, regulatory changes, or major price moves. If nothing material happened, respond with "No significant news today."

News articles:
${newsText}

Format as bullet points starting with • `
        }]
    });
    
    return message.content[0].text;
}

async function generateExecutiveSummary(totalStocks, avgChange, topGainer, topLoser, newsText) {
    const message = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 400,
        messages: [{
            role: 'user',
            content: `Generate a 3-4 sentence executive summary for a portfolio of ${totalStocks} stocks.

Portfolio Stats:
- Average change today: ${avgChange.toFixed(2)}%
- Top gainer: ${topGainer.ticker} (+${topGainer.price.changePercent.toFixed(2)}%)
- Top loser: ${topLoser.ticker} (${topLoser.price.changePercent.toFixed(2)}%)

Key News:
${newsText || 'No significant news today.'}

Write a concise, actionable summary for a long-term investor. Focus on overall portfolio health and any critical developments.`
        }]
    });
    
    trackAPI('anthropic', 'digest');
    return message.content[0].text;
}

async function generateWeeklyExecutiveSummary(totalStocks, avgWeeklyChange, topGainer, topLoser, newsText) {
    const message = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 600,
        messages: [{
            role: 'user',
            content: `Generate a 4-5 sentence executive summary for a WEEKLY portfolio review of ${totalStocks} stocks.

Weekly Portfolio Stats:
- Average change this week: ${avgWeeklyChange.toFixed(2)}%
- Top weekly gainer: ${topGainer.ticker} (+${topGainer.weeklyChange.toFixed(2)}%)
- Top weekly loser: ${topLoser.ticker} (${topLoser.weeklyChange.toFixed(2)}%)

Key News This Week:
${newsText || 'No significant news this week.'}

Write a concise weekly review for a long-term investor. Focus on overall trends, portfolio health, and any critical developments that occurred this week.`
        }]
    });
    
    trackAPI('anthropic', 'weekly-digest');
    return message.content[0].text;
}

// Send daily digest email
async function sendDigestEmail(user, digestData) {
    const { executiveSummary, topGainer, topLoser, keyNews, actionItems } = digestData;
    
    const keyNewsHTML = keyNews.length > 0 
        ? keyNews.map(n => `
            <div style="margin-bottom: 15px; padding: 15px; background: #f5f5f7; border-radius: 8px;">
                <strong style="color: #0071e3;">${n.ticker}</strong>
                <p style="margin: 5px 0 0 0; color: #1d1d1f;">${n.summary}</p>
            </div>
        `).join('')
        : '<p style="color: #86868b;">No significant news today.</p>';
    
    const actionItemsHTML = actionItems.length > 0
        ? actionItems.map(item => `<li style="margin-bottom: 8px;">${item}</li>`).join('')
        : '<li style="color: #86868b;">No action items today</li>';
    
    const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #0071e3; color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .content { background: white; padding: 30px; border-radius: 0 0 12px 12px; }
    .section { margin-bottom: 30px; }
    .section h2 { color: #1d1d1f; font-size: 20px; margin-bottom: 15px; }
    .movers { display: flex; gap: 20px; margin-bottom: 20px; }
    .mover-card { flex: 1; padding: 20px; border-radius: 12px; text-align: center; }
    .gainer { background: #d4edda; }
    .loser { background: #f8d7da; }
    .footer { text-align: center; color: #86868b; font-size: 13px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #f5f5f7; }
    
    /* Mobile responsive */
    @media only screen and (max-width: 600px) {
        body { padding: 10px !important; }
        .container { width: 100% !important; }
        .header { padding: 20px !important; }
        .header h1 { font-size: 24px !important; }
        .content { padding: 20px !important; }
        .movers { flex-direction: column !important; gap: 10px !important; }
        .mover-card { padding: 15px !important; }
        .section h2 { font-size: 18px !important; }
    }
</style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 style="margin: 0;"> Daily Portfolio Digest</h1>
                    <p style="margin: 10px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                
                <div class="content">
                    <div class="section">
                        <h2>Executive Summary</h2>
                        <p style="color: #1d1d1f; line-height: 1.6;">${executiveSummary}</p>
                    </div>
                    
                    <div class="section">
                        <h2>Today's Movers</h2>
                        <div class="movers">
                            <div class="mover-card gainer">
                                <div style="font-size: 13px; color: #155724; margin-bottom: 5px;">Top Gainer</div>
                                <div style="font-size: 24px; font-weight: 700; color: #155724;">${topGainer.ticker}</div>
                                <div style="font-size: 18px; color: #155724; margin-top: 5px;">+${topGainer.changePercent.toFixed(2)}%</div>
                            </div>
                            <div class="mover-card loser">
                                <div style="font-size: 13px; color: #721c24; margin-bottom: 5px;">Top Loser</div>
                                <div style="font-size: 24px; font-weight: 700; color: #721c24;">${topLoser.ticker}</div>
                                <div style="font-size: 18px; color: #721c24; margin-top: 5px;">${topLoser.changePercent.toFixed(2)}%</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2>Key News</h2>
                        ${keyNewsHTML}
                    </div>
                    
                    <div class="section">
                        <h2>Action Items</h2>
                        <ul style="color: #1d1d1f; line-height: 1.8;">
                            ${actionItemsHTML}
                        </ul>
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html" style="display: inline-block; background: #0071e3; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Full Dashboard</a>
                    </div>
                    
                    <div class="footer">
                        <p>Banlan & Binch Investments</p>
                        <p style="margin-top: 10px;">You're receiving this because you enabled daily digest emails.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        console.log(`📧 Attempting to send daily email to ${user.email}...`);
        
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'Portfolio Manager <onboarding@resend.dev>',
            to: user.email,
            subject: `📊 Daily Portfolio Digest - ${new Date().toLocaleDateString('en-AU')}`,
            html: emailHTML
        });
        
        console.log(`✅ Daily email sent successfully! ID: ${result.id}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send daily email to ${user.email}:`, error);
        return false;
    }
}

// Send weekly digest email
async function sendWeeklyDigestEmail(user, digestData) {
    const { weeklyExecutiveSummary, avgWeeklyChange, topWeeklyGainer, topWeeklyLoser, stocksData, keyNews } = digestData;
    
    const stocksTableHTML = stocksData.map(stock => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #f5f5f7;"><strong>${stock.ticker}</strong></td>
            <td style="padding: 12px; border-bottom: 1px solid #f5f5f7; text-align: right;">$${stock.currentPrice.toFixed(2)}</td>
            <td style="padding: 12px; border-bottom: 1px solid #f5f5f7; text-align: right; color: ${stock.weeklyChange >= 0 ? '#155724' : '#721c24'}; font-weight: 600;">
                ${stock.weeklyChange >= 0 ? '+' : ''}${stock.weeklyChange.toFixed(2)}%
            </td>
        </tr>
    `).join('');
    
    const keyNewsHTML = keyNews.length > 0 
        ? keyNews.map(n => `
            <div style="margin-bottom: 15px; padding: 15px; background: #f5f5f7; border-radius: 8px;">
                <strong style="color: #0071e3;">${n.ticker}</strong>
                <p style="margin: 5px 0 0 0; color: #1d1d1f;">${n.summary}</p>
            </div>
        `).join('')
        : '<p style="color: #86868b;">No significant news this week.</p>';
    
    const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .content { background: white; padding: 30px; border-radius: 0 0 12px 12px; }
    .section { margin-bottom: 30px; }
    .section h2 { color: #1d1d1f; font-size: 20px; margin-bottom: 15px; }
    .stats-grid { display: flex; gap: 15px; margin-bottom: 20px; }
    .stat-card { flex: 1; padding: 20px; border-radius: 12px; text-align: center; background: #f5f5f7; }
    .stat-label { font-size: 12px; color: #86868b; margin-bottom: 5px; text-transform: uppercase; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1d1d1f; }
    .stat-change { font-size: 16px; margin-top: 5px; font-weight: 600; }
    .positive { color: #155724; }
    .negative { color: #721c24; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f5f5f7; padding: 12px; text-align: left; font-size: 13px; color: #86868b; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #f5f5f7; }
    .footer { text-align: center; color: #86868b; font-size: 13px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #f5f5f7; }
    
    /* Mobile responsive */
    @media only screen and (max-width: 600px) {
        body { padding: 10px !important; }
        .container { width: 100% !important; }
        .header { padding: 25px 15px !important; }
        .header h1 { font-size: 24px !important; }
        .content { padding: 20px !important; }
        .stats-grid { flex-direction: column !important; gap: 10px !important; }
        .stat-card { padding: 15px !important; }
        .section h2 { font-size: 18px !important; }
        table { font-size: 13px !important; }
        th, td { padding: 8px !important; }
    }
</style>
        </head>
        <body>
            <div class="container">
                <div class="header">
    <h1 style="margin: 0; font-size: 32px; color: #000000;">Weekly Portfolio Report</h1>
    <p style="margin: 10px 0 0 0; font-size: 16px; color: #000000;">Week ending ${new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
</div>
                
                <div class="content">
                    <div class="section">
                        <h2>Executive Summary</h2>
                        <p style="color: #1d1d1f; line-height: 1.6; font-size: 15px;">${weeklyExecutiveSummary}</p>
                    </div>
                    
                    <div class="section">
                        <h2>Weekly Overview</h2>
                        <div class="stats-grid">
                            <div class="stat-card">
                                <div class="stat-label">Portfolio Average</div>
                                <div class="stat-value ${avgWeeklyChange >= 0 ? 'positive' : 'negative'}">
                                    ${avgWeeklyChange >= 0 ? '+' : ''}${avgWeeklyChange.toFixed(2)}%
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Top Gainer</div>
                                <div class="stat-value">${topWeeklyGainer.ticker}</div>
                                <div class="stat-change positive">+${topWeeklyGainer.weeklyChange.toFixed(2)}%</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Top Loser</div>
                                <div class="stat-value">${topWeeklyLoser.ticker}</div>
                                <div class="stat-change negative">${topWeeklyLoser.weeklyChange.toFixed(2)}%</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h2>All Holdings - Weekly Performance</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>Stock</th>
                                    <th style="text-align: right;">Price</th>
                                    <th style="text-align: right;">Week Change</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${stocksTableHTML}
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="section">
                        <h2>Key News This Week</h2>
                        ${keyNewsHTML}
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html" style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Full Dashboard</a>
                    </div>
                    
                    <div class="footer">
                        <p>Banlan & Binch Investments</p>
                        <p style="margin-top: 10px;">You're receiving this weekly report because you enabled scheduled updates.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        console.log(`📧 Attempting to send weekly email to ${user.email}...`);
        
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'Portfolio Manager <onboarding@resend.dev>',
            to: user.email,
            subject: `📈 Weekly Portfolio Report - ${new Date().toLocaleDateString('en-AU')}`,
            html: emailHTML
        });
        
        console.log(`✅ Weekly email sent successfully! ID: ${result.id}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send weekly email to ${user.email}:`, error);
        return false;
    }
}

// Generate and send daily digests
async function generateAndSendDigests() {
    console.log('📧 Generating daily digests...');
    
    if (!serverPortfolio.length) {
        console.log('No portfolio to digest');
        return;
    }
    
    const stocksData = [];
    for (const ticker of serverPortfolio) {
        try {
            const today = new Date().toDateString();
            let data;
            
            if (cache[ticker] && cache[ticker].date === today) {
                data = cache[ticker].data;
            } else {
                data = await updateStock(ticker);
            }
            
            stocksData.push({
                ticker: ticker,
                ...data
            });
        } catch (error) {
            console.error(`Error loading ${ticker}:`, error);
        }
    }
    
    const sorted = [...stocksData].sort((a, b) => b.price.changePercent - a.price.changePercent);
    const topGainer = sorted[0];
    const topLoser = sorted[sorted.length - 1];
    
    const keyNews = stocksData
        .filter(s => s.summary && s.summary !== 'No significant news today.')
        .map(s => ({ ticker: s.ticker, summary: s.summary }));
    
    const newsText = keyNews.map(n => `${n.ticker}: ${n.summary}`).join('\n\n');
    const avgChange = stocksData.reduce((sum, s) => sum + s.price.changePercent, 0) / stocksData.length;
    
    const executiveSummary = await generateExecutiveSummary(stocksData.length, avgChange, topGainer, topLoser, newsText);
    
    const actionItems = [];
    if (Math.abs(topGainer.price.changePercent) > 5) {
        actionItems.push(`${topGainer.ticker} up ${topGainer.price.changePercent.toFixed(2)}% - Review position size`);
    }
    if (Math.abs(topLoser.price.changePercent) > 5) {
        actionItems.push(`${topLoser.ticker} down ${Math.abs(topLoser.price.changePercent).toFixed(2)}% - Investigate cause`);
    }
    if (keyNews.length > 3) {
        actionItems.push(`${keyNews.length} stocks with significant news - Review detailed summaries`);
    }
    
    const digestData = {
        executiveSummary,
        topGainer: {
            ticker: topGainer.ticker,
            price: topGainer.price.price,
            changePercent: topGainer.price.changePercent
        },
        topLoser: {
            ticker: topLoser.ticker,
            price: topLoser.price.price,
            changePercent: topLoser.price.changePercent
        },
        keyNews,
        actionItems
    };
    
    const usersToEmail = users.filter(u => u.receiveDailyDigest);
    console.log(`📬 Sending daily digest to ${usersToEmail.length} users...`);
    
    for (const user of usersToEmail) {
        await sendDigestEmail(user, digestData);
    }
    
    console.log('✅ Daily digest emails sent!');
}

// Generate and send weekly digests
async function generateAndSendWeeklyDigests() {
    console.log('📊 Generating weekly digests...');
    
    if (!serverPortfolio.length) {
        console.log('No portfolio to digest');
        return;
    }
    
    const stocksData = [];
    for (const ticker of serverPortfolio) {
        try {
            const today = new Date().toDateString();
            let data;
            
            if (cache[ticker] && cache[ticker].date === today) {
                data = cache[ticker].data;
            } else {
                data = await updateStock(ticker);
            }
            
            const history = await getWeeklyHistory(ticker);
            
            stocksData.push({
                ticker: ticker,
                currentPrice: data.price.price,
                todayChange: data.price.changePercent,
                weeklyChange: history.weeklyChange,
                weeklyHigh: history.high,
                weeklyLow: history.low,
                summary: data.summary
            });
        } catch (error) {
            console.error(`Error loading ${ticker}:`, error);
        }
    }
    
    const avgWeeklyChange = stocksData.reduce((sum, s) => sum + s.weeklyChange, 0) / stocksData.length;
    const sorted = [...stocksData].sort((a, b) => b.weeklyChange - a.weeklyChange);
    const topWeeklyGainer = sorted[0];
    const topWeeklyLoser = sorted[sorted.length - 1];
    
    const keyNews = stocksData
        .filter(s => s.summary && s.summary !== 'No significant news today.')
        .map(s => ({ ticker: s.ticker, summary: s.summary }));
    
    const newsText = keyNews.map(n => `${n.ticker}: ${n.summary}`).join('\n\n');
    
    const weeklyExecutiveSummary = await generateWeeklyExecutiveSummary(
        stocksData.length, 
        avgWeeklyChange, 
        topWeeklyGainer, 
        topWeeklyLoser, 
        newsText
    );
    
    const digestData = {
        weeklyExecutiveSummary,
        avgWeeklyChange,
        topWeeklyGainer: {
            ticker: topWeeklyGainer.ticker,
            weeklyChange: topWeeklyGainer.weeklyChange,
            currentPrice: topWeeklyGainer.currentPrice
        },
        topWeeklyLoser: {
            ticker: topWeeklyLoser.ticker,
            weeklyChange: topWeeklyLoser.weeklyChange,
            currentPrice: topWeeklyLoser.currentPrice
        },
        stocksData,
        keyNews
    };
    
    const usersToEmail = users.filter(u => u.receiveWeeklyDigest);
    console.log(`📬 Sending weekly digest to ${usersToEmail.length} users...`);
    
    for (const user of usersToEmail) {
        await sendWeeklyDigestEmail(user, digestData);
    }
    
    console.log('✅ Weekly digest emails sent!');
}

// Test digest email
app.post('/api/send-test-digest', isAuthenticated, async (req, res) => {
    try {
        console.log('🧪 Daily digest test requested...');
        await generateAndSendDigests();
        res.json({ success: true, message: 'Test digest sent!' });
    } catch (error) {
        console.error('❌ Error sending test digest:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test weekly digest email
app.post('/api/send-test-weekly', isAuthenticated, async (req, res) => {
    try {
        console.log('🧪 Weekly digest test requested...');
        await generateAndSendWeeklyDigests();
        res.json({ success: true, message: 'Test weekly digest sent!' });
    } catch (error) {
        console.error('❌ Error sending test weekly digest:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scheduled updates (daily)
if (settings.days.length > 0) {
    const cronDays = settings.days.join(',');
    const cronTime = `${settings.minute} ${settings.hour} * * ${cronDays}`;
    
    cron.schedule(cronTime, async () => {
        console.log('Running scheduled portfolio update...');
        
        if (!serverPortfolio.length) {
            console.log('No portfolio to update');
            return;
        }
        
        console.log(`Updating ${serverPortfolio.length} stocks...`);
        for (const ticker of serverPortfolio) {
            try {
                await updateStock(ticker);
                console.log(`Updated ${ticker}`);
            } catch (error) {
                console.error(`Failed to update ${ticker}:`, error.message);
            }
        }
        console.log('Scheduled update complete!');
        
        await generateAndSendDigests();
        
    }, {
        timezone: "Australia/Brisbane"
    });
    
    console.log(`Scheduled daily updates: ${cronTime} Brisbane time`);
}

// Weekly digest schedule (Saturdays at 11am Brisbane time)
cron.schedule('0 11 * * 6', async () => {
    console.log('Running weekly digest...');
    
    if (!serverPortfolio.length) {
        console.log('No portfolio for weekly digest');
        return;
    }
    
    console.log('Updating portfolio for weekly digest...');
    for (const ticker of serverPortfolio) {
        try {
            await updateStock(ticker);
        } catch (error) {
            console.error(`Failed to update ${ticker}:`, error.message);
        }
    }
    
    await generateAndSendWeeklyDigests();
    
}, {
    timezone: "Australia/Brisbane"
});

console.log('📅 Weekly digest scheduled: Saturdays at 11:00 AM Brisbane time');

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Server running on http://localhost:3000');
    console.log('Default login: username=admin, password=admin123');
    if (settings.days.length > 0) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const scheduledDays = settings.days.map(d => dayNames[d]).join(', ');
        console.log(`Scheduled: ${scheduledDays} at ${settings.hour}:${String(settings.minute).padStart(2, '0')} Brisbane time`);
    }
});
