const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(bodyParser.json());

// --- WEBSOCKET STATE ---
let esp32Client = null;
wss.on('connection', (ws) => {
    esp32Client = ws;
    console.log("ESP32/Mock Connected");
});

// --- API ROUTES ---

// 1. GET Inventory
app.get('/api/inventory', (req, res) => {
    db.all("SELECT * FROM inventory ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. TRIGGER PICK/PUT (Hardware)
app.post('/api/action', (req, res) => {
    const { id, type } = req.body;
    const change = (type === 'PICK') ? -1 : 1;
    db.run("UPDATE inventory SET quantity = quantity + ? WHERE id = ?", [change, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (esp32Client) {
            esp32Client.send(JSON.stringify({ mask: (1 << id), action: type }));
        }
        res.json({ success: true });
    });
});

// 3. UPDATE/ADD OBJECT (The missing route causing the 404)
app.post('/api/slots/update', (req, res) => {
    const { id, name, sku, quantity } = req.body;
    db.run(
        "UPDATE inventory SET name = ?, sku = ?, quantity = ? WHERE id = ?",
        [name, sku, quantity, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// 4. REMOVE OBJECT (Reset to default)
app.post('/api/slots/remove', (req, res) => {
    const { id } = req.body;
    db.run(
        "UPDATE inventory SET name = 'Empty Slot', sku = 'N/A', quantity = 0 WHERE id = ?",
        [id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

server.listen(5000, () => console.log("Backend Protocol Active on Port 5000"));