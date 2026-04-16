const WebSocket = require('ws');

// Connect to your local Node.js server
const ws = new WebSocket('ws://localhost:5000');

ws.on('open', () => {
    console.log("Mock ESP32: Connected to Server.");
});

ws.on('message', (data) => {
    const payload = JSON.parse(data);
    console.log("--- HARDWARE SIGNAL RECEIVED ---");
    console.log(`Action: ${payload.action}`);
    console.log(`Raw Bitmask (Decimal): ${payload.mask}`);
    console.log(`Binary Representation: ${payload.mask.toString(2).padStart(32, '0')}`);
    console.log("-------------------------------");
});