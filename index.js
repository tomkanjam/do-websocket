const express = require('express');
const path = require('path');
const { createServer } = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, '/public')));

// Health check route
app.get('/health', (req, res) => res.status(200).send('OK'));

let data = [];

// A helper function to round numbers to 2 decimal places
function roundTwoDecimals(number) {
    return parseFloat(number.toFixed(2));
}

function updateBucket(trade) {
    const minuteTimestamp = new Date(trade.T);
    minuteTimestamp.setSeconds(0, 0);

    const priceCluster = roundTwoDecimals(Math.floor(parseFloat(trade.p) / 2) * 2);
    const dateString = minuteTimestamp.toISOString().substring(0, 16);

    let minuteData = data.find(d => d.date === dateString);
    const tradePrice = roundTwoDecimals(parseFloat(trade.p));
    if (!minuteData) {
        minuteData = {
            open: tradePrice,
            close: tradePrice,
            low: tradePrice,
            high: tradePrice,
            date: dateString,
            volume: 0,
            delta: 0,
            clusters: []
        };
        data.push(minuteData);
    }

    let cluster = minuteData.clusters.find(c => c.price === priceCluster);
    const tradeQuantity = roundTwoDecimals(parseFloat(trade.q));
    const delta = trade.m ? -tradeQuantity : tradeQuantity;

    if (!cluster) {
        cluster = {
            sell: trade.m ? tradeQuantity : 0,
            buy: trade.m ? 0 : tradeQuantity,
            delta: delta,
            volume: tradeQuantity,
            price: priceCluster
        };
        minuteData.clusters.push(cluster);
    } else {
        cluster.sell = roundTwoDecimals(cluster.sell + (trade.m ? tradeQuantity : 0));
        cluster.buy = roundTwoDecimals(cluster.buy + (trade.m ? 0 : tradeQuantity));
        cluster.delta = roundTwoDecimals(cluster.buy - cluster.sell);
        cluster.volume = roundTwoDecimals(cluster.volume + tradeQuantity); 
    }

    minuteData.delta = roundTwoDecimals(minuteData.delta + delta);
    minuteData.volume = roundTwoDecimals(minuteData.volume + tradeQuantity);
    minuteData.open = minuteData.clusters[0].price;
    minuteData.high = roundTwoDecimals(Math.max(minuteData.high, tradePrice));
    minuteData.low = roundTwoDecimals(Math.min(minuteData.low, tradePrice));
    minuteData.close = tradePrice;

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    data = data.filter(d => new Date(d.date).getTime() >= oneHourAgo);
}


const binanceWS = new WebSocket('wss://fstream.binance.com/stream?streams=btcbusd@aggTrade/btcusdt@aggTrade');

binanceWS.on('message', (message) => {
    const msg = JSON.parse(message);
    const trade = msg.data;
    updateBucket(trade);
});

// Create an HTTP server and bind both Express and WebSocket to it
const server = createServer(app);
const wss = new WebSocket.Server({ server });

wss.broadcast = function broadcast(data) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

// Send processed data to all connected clients every 500 milliseconds
setInterval(() => {
    wss.broadcast(JSON.stringify(data));
}, 500);

// Instead of binding only WebSocket to the port, bind the entire server
server.listen(8080, function () {
    console.log('Listening on http://0.0.0.0:8080');
  });
