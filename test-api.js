require('dotenv').config();

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

async function testAPI() {
    // Test with a US stock first to verify the API works
    console.log('Testing AAPL (US stock):');
    const priceUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${API_KEY}`;
    const priceResponse = await fetch(priceUrl);
    const priceData = await priceResponse.json();
    console.log('Price:', JSON.stringify(priceData, null, 2));

    console.log('\nTesting News for AAPL:');
    const newsUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=AAPL&limit=5&apikey=${API_KEY}`;
    const newsResponse = await fetch(newsUrl);
    const newsData = await newsResponse.json();
    console.log('News:', JSON.stringify(newsData, null, 2));
}

testAPI();