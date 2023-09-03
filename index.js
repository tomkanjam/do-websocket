const http = require('http');
const WebSocket = require('ws');
const { Logtail } = require("@logtail/node");  // Import Logtail

const logtail = new Logtail("18xop9j1pyTCRwcyPLDAe7Gb");

let data = [];

// A helper function to round numbers to 2 decimal places
function roundTwoDecimals(number) {
    return parseFloat(number.toFixed(2));
}

function updateBucket(trade) {
    try {
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

        // If there's no existing cluster for the price, initialize it
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
            // If the cluster exists, update the values based on the trade data
            cluster.sell = roundTwoDecimals(cluster.sell + (trade.m ? tradeQuantity : 0));
            cluster.buy = roundTwoDecimals(cluster.buy + (trade.m ? 0 : tradeQuantity));
            cluster.delta = roundTwoDecimals(cluster.buy - cluster.sell);
            cluster.volume = roundTwoDecimals(cluster.volume + tradeQuantity); 
        }

        // Sort clusters from higher price to lower price
        // console.log("Values before sorting: ", minuteData.clusters.map(c => c.price));
        minuteData.clusters.sort((a, b) => b.price - a.price);
        // console.log("Values after sorting: ", minuteData.clusters.map(c => c.price));


        minuteData.delta = roundTwoDecimals(minuteData.delta + delta);
        minuteData.volume = roundTwoDecimals(minuteData.volume + tradeQuantity);
        minuteData.open = minuteData.clusters[0].price;
        minuteData.high = roundTwoDecimals(Math.max(minuteData.high, tradePrice));
        minuteData.low = roundTwoDecimals(Math.min(minuteData.low, tradePrice));
        minuteData.close = tradePrice;

        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        data = data.filter(d => new Date(d.date).getTime() >= oneHourAgo);
        
        logtail.info("Final sorting:", {
            sortedClusterPrices: minuteData.clusters.map(c => c.price)
        });        
    } catch (error) {
        logtail.error("Error in updateBucket", { error: error.message, stack: error.stack });
    }
}


const binanceWS = new WebSocket('wss://fstream.binance.com/stream?streams=btcbusd@aggTrade/btcusdt@aggTrade');

binanceWS.on('message', (message) => {
    try {
        const msg = JSON.parse(message);
        const trade = msg.data;
        updateBucket(trade);
    } catch (error) {
        logtail.error("Error in WebSocket message handler", { error: error.message, stack: error.stack });
    }
});

// Create an HTTP server
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('WebSocket Server Running!');
});

// WebSocket Server Setup
const wss = new WebSocket.Server({ server });

wss.broadcast = function broadcast(dataToSend) {
    try {
        wss.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(dataToSend);
            }
        });
    } catch (error) {
        logtail.error("Error in WebSocket broadcast", { error: error.message, stack: error.stack });
    }
};

setInterval(() => {
    try {
        wss.broadcast(JSON.stringify(data));
    } catch (error) {
        logtail.error("Error in setInterval broadcast", { error: error.message, stack: error.stack });
    }
}, 500);

// Use the environment variable for the port or default to 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
