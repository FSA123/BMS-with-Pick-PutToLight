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
    const parsedId = Number(id);
    const validAction = type === 'PICK' || type === 'PUT';
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31 || !validAction) {
        return res.status(400).json({ error: "Invalid action payload." });
    }

    const change = (type === 'PICK') ? -1 : 1;
    const updateSql = `
        UPDATE inventory
        SET quantity = quantity + ?
        WHERE id = ?
          AND (? = 1 OR quantity > 0)
    `;

    db.run(updateSql, [change, parsedId, type === 'PUT' ? 1 : 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(400).json({ error: "Cannot PICK from an empty slot." });
        }
        if (esp32Client) {
            esp32Client.send(JSON.stringify({ mask: (1 << parsedId), action: type }));
        }
        res.json({ success: true, id: parsedId, type });
    });
});

// 3. UPDATE/ADD OBJECT (The missing route causing the 404)
app.post('/api/slots/update', (req, res) => {
    const { id, name, sku, quantity } = req.body;
    const parsedId = Number(id);
    const parsedQty = Number(quantity);
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedSkuInput = typeof sku === 'string' ? sku.trim() : '';
    const normalizedSku = normalizedSkuInput || `SKU-${parsedId}`;
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31) {
        return res.status(400).json({ error: "Invalid slot ID." });
    }
    if (!normalizedName) {
        return res.status(400).json({ error: "Name is required." });
    }
    if (!Number.isInteger(parsedQty) || parsedQty < 0) {
        return res.status(400).json({ error: "Quantity must be a non-negative integer." });
    }

    db.run(
        "UPDATE inventory SET name = ?, sku = ?, quantity = ? WHERE id = ?",
        [normalizedName, normalizedSku, parsedQty, parsedId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// 4. REMOVE OBJECT (Reset to default)
app.post('/api/slots/remove', (req, res) => {
    const { id } = req.body;
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31) {
        return res.status(400).json({ error: "Invalid slot ID." });
    }

    db.run(
        "UPDATE inventory SET name = ?, sku = ?, quantity = 0 WHERE id = ?",
        [`Slot ${parsedId}`, `EMPTY-${parsedId}`, parsedId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// 5. BULK PICK / PUT
app.post('/api/action/bulk', (req, res) => {
    const { id, type, quantity } = req.body;
    const parsedId  = Number(id);
    const parsedQty = Number(quantity);
    const validAction = type === 'PICK' || type === 'PUT';
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31 || !validAction) {
        return res.status(400).json({ error: "Invalid payload." });
    }
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
        return res.status(400).json({ error: "Quantity must be a positive integer." });
    }

    const sql = type === 'PICK'
        ? "UPDATE inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?"
        : "UPDATE inventory SET quantity = quantity + ? WHERE id = ?";
    const params = type === 'PICK' ? [parsedQty, parsedId, parsedQty] : [parsedQty, parsedId];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(400).json({ error: "Insufficient stock for this pick." });
        }
        if (esp32Client) {
            esp32Client.send(JSON.stringify({ mask: (1 << parsedId), action: type, quantity: parsedQty }));
        }
        res.json({ success: true, id: parsedId, type, quantity: parsedQty });
    });
});

// 6. SAVE FLOOR POSITION & ZONE
app.post('/api/slots/position', (req, res) => {
    const { id, x, y, zone } = req.body;
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31) {
        return res.status(400).json({ error: "Invalid slot ID." });
    }
    db.run(
        "UPDATE inventory SET x = ?, y = ?, zone = ? WHERE id = ?",
        [x ?? null, y ?? null, zone || 'A', parsedId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

server.listen(5000, () => console.log("Backend active on port 5000"));
