const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const bodyParser = require('body-parser');
const cors       = require('cors');
const db         = require('./database');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(bodyParser.json());

// ─── LED QUEUE ────────────────────────────────────────────────────────────────
// Only one LED is ever lit at a time. When an action arrives it goes into the
// queue; the next item is activated automatically when the operator presses the
// physical button (or clicks "LED OFF" in the dashboard).
const ledQueue  = [];   // pending actions: [{ id, type }, ...]
let activeLedId = null; // slot ID currently displayed on hardware (-1 means none)

// Server-side mirror of the single active LED so we can re-sync after a reboot.
let ledSolidMask = 0;
let ledFlashMask = 0;

// ─── WEBSOCKET CLIENTS ────────────────────────────────────────────────────────
let esp32Client = null;
const browserClients = new Set();

function broadcastToBrowsers(payload) {
    const msg = JSON.stringify(payload);
    for (const ws of browserClients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
}

function sendToEsp32(payload) {
    if (esp32Client && esp32Client.readyState === WebSocket.OPEN) {
        esp32Client.send(JSON.stringify(payload));
        return true;
    }
    console.warn('[WS] ESP32 not connected — command not sent:', payload);
    return false;
}

// Notify all browser tabs of the current queue state so the UI stays in sync.
function broadcastQueueState() {
    broadcastToBrowsers({
        type:        'queue_update',
        queueLength: ledQueue.length,
        activeId:    activeLedId,
    });
}

// ─── QUEUE LOGIC ──────────────────────────────────────────────────────────────

// Activate the next item in the queue (if nothing is already active).
function sendNextFromQueue() {
    if (activeLedId !== null || ledQueue.length === 0) return;
    const next  = ledQueue.shift();
    activeLedId = next.id;
    // Update server-side LED mask to mirror what the ESP32 will show.
    const mask = (1 << next.id) >>> 0;
    if (next.type === 'PUT') {
        ledSolidMask = mask;
        ledFlashMask = 0;
    } else {
        ledFlashMask = mask;
        ledSolidMask = 0;
    }
    sendToEsp32({ mask, action: next.type });
    console.log(`[Queue] Showing LED ${next.id} (${next.type}). ${ledQueue.length} remaining in queue.`);
    broadcastQueueState();
}

// Clear the currently active LED, then activate the next one in queue.
function clearActiveAndAdvance() {
    if (activeLedId !== null) {
        const mask = (1 << activeLedId) >>> 0;
        ledSolidMask = (ledSolidMask & ~mask) >>> 0;
        ledFlashMask = (ledFlashMask & ~mask) >>> 0;
        sendToEsp32({ mask, action: 'OFF' });
        broadcastToBrowsers({ type: 'led_cleared', id: activeLedId });
        console.log(`[Queue] LED ${activeLedId} cleared. Advancing queue.`);
        activeLedId = null;
    }
    sendNextFromQueue();
}

// Add an action to the queue, then try to activate it immediately if idle.
function enqueue(id, type) {
    ledQueue.push({ id, type });
    console.log(`[Queue] Enqueued LED ${id} (${type}). Queue depth: ${ledQueue.length}`);
    broadcastQueueState();
    sendNextFromQueue();
}

// ─── WEBSOCKET CONNECTIONS ────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {

    if (req.url === '/esp32') {
        // ── ESP32 ─────────────────────────────────────────────────────────────
        if (esp32Client && esp32Client.readyState === WebSocket.OPEN) esp32Client.close();
        esp32Client = ws;
        console.log('[WS] ESP32 connected.');

        // Re-sync the single active LED so the hardware catches up after a reboot.
        ws.send(JSON.stringify({ type: 'sync', solid: ledSolidMask, flash: ledFlashMask }));
        console.log(`[WS] Sync sent → solid=0x${ledSolidMask.toString(16).padStart(8,'0')}  flash=0x${ledFlashMask.toString(16).padStart(8,'0')}`);

        broadcastToBrowsers({ type: 'esp32_status', connected: true });

        ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data); } catch { return; }

            // Physical button press — clear the active LED and advance the queue.
            if (msg.type === 'button_press') {
                console.log('[BTN] Physical button pressed.');
                clearActiveAndAdvance();
            }
        });

        ws.on('close', () => {
            if (esp32Client === ws) {
                esp32Client = null;
                console.log('[WS] ESP32 disconnected.');
                broadcastToBrowsers({ type: 'esp32_status', connected: false });
            }
        });

    } else {
        // ── Browser ───────────────────────────────────────────────────────────
        browserClients.add(ws);
        console.log(`[WS] Browser connected. (${browserClients.size} open tabs)`);

        // Send current state immediately so the UI is accurate on load.
        ws.send(JSON.stringify({
            type:      'esp32_status',
            connected: esp32Client !== null && esp32Client.readyState === WebSocket.OPEN,
        }));
        ws.send(JSON.stringify({
            type:        'queue_update',
            queueLength: ledQueue.length,
            activeId:    activeLedId,
        }));

        ws.on('close', () => {
            browserClients.delete(ws);
            console.log(`[WS] Browser disconnected. (${browserClients.size} remaining)`);
        });
    }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function logTransaction(inventoryId, type, quantityChange) {
    db.run(
        "INSERT INTO transactions (inventory_id, type, quantity_change) VALUES (?, ?, ?)",
        [inventoryId, type, quantityChange],
        (err) => { if (err) console.error('[DB] Transaction log error:', err.message); }
    );
}

function broadcastInventoryUpdate(id) {
    db.get("SELECT * FROM inventory WHERE id = ?", [id], (err, row) => {
        if (!err && row) broadcastToBrowsers({ type: 'inventory_update', slot: row });
    });
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// 1. GET Inventory
app.get('/api/inventory', (req, res) => {
    db.all("SELECT * FROM inventory ORDER BY id ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. PICK / PUT (single unit) — adds to queue instead of lighting immediately
app.post('/api/action', (req, res) => {
    const { id, type } = req.body;
    const parsedId    = Number(id);
    const validAction = type === 'PICK' || type === 'PUT';
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31 || !validAction)
        return res.status(400).json({ error: "Invalid action payload." });

    const change    = type === 'PICK' ? -1 : 1;
    const updateSql = `
        UPDATE inventory SET quantity = quantity + ?
        WHERE id = ? AND (? = 1 OR quantity > 0)
    `;

    db.run(updateSql, [change, parsedId, type === 'PUT' ? 1 : 0], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(400).json({ error: "Cannot PICK from an empty slot." });

        enqueue(parsedId, type);
        logTransaction(parsedId, type, change);
        broadcastInventoryUpdate(parsedId);
        res.json({ success: true, id: parsedId, type });
    });
});

// 3. UPDATE / ADD OBJECT
app.post('/api/slots/update', (req, res) => {
    const { id, name, sku, quantity } = req.body;
    const parsedId  = Number(id);
    const parsedQty = Number(quantity);
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedSku  = (typeof sku === 'string' && sku.trim()) ? sku.trim() : `SKU-${parsedId}`;

    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31)
        return res.status(400).json({ error: "Invalid slot ID." });
    if (!normalizedName)
        return res.status(400).json({ error: "Name is required." });
    if (!Number.isInteger(parsedQty) || parsedQty < 0)
        return res.status(400).json({ error: "Quantity must be a non-negative integer." });

    db.run(
        "UPDATE inventory SET name = ?, sku = ?, quantity = ? WHERE id = ?",
        [normalizedName, normalizedSku, parsedQty, parsedId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            broadcastInventoryUpdate(parsedId);
            res.json({ success: true });
        }
    );
});

// 4. REMOVE OBJECT
app.post('/api/slots/remove', (req, res) => {
    const { id }   = req.body;
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31)
        return res.status(400).json({ error: "Invalid slot ID." });

    db.run(
        "UPDATE inventory SET name = ?, sku = ?, quantity = 0 WHERE id = ?",
        [`Slot ${parsedId}`, `EMPTY-${parsedId}`, parsedId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            broadcastInventoryUpdate(parsedId);
            res.json({ success: true });
        }
    );
});

// 5. BULK PICK / PUT — also queued
app.post('/api/action/bulk', (req, res) => {
    const { id, type, quantity } = req.body;
    const parsedId  = Number(id);
    const parsedQty = Number(quantity);
    const validAction = type === 'PICK' || type === 'PUT';

    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31 || !validAction)
        return res.status(400).json({ error: "Invalid payload." });
    if (!Number.isInteger(parsedQty) || parsedQty <= 0)
        return res.status(400).json({ error: "Quantity must be a positive integer." });

    const sql    = type === 'PICK'
        ? "UPDATE inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?"
        : "UPDATE inventory SET quantity = quantity + ? WHERE id = ?";
    const params = type === 'PICK' ? [parsedQty, parsedId, parsedQty] : [parsedQty, parsedId];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(400).json({ error: "Insufficient stock for this pick." });

        enqueue(parsedId, type);
        logTransaction(parsedId, type, type === 'PICK' ? -parsedQty : parsedQty);
        broadcastInventoryUpdate(parsedId);
        res.json({ success: true, id: parsedId, type, quantity: parsedQty });
    });
});

// 6. SAVE FLOOR POSITION & ZONE
app.post('/api/slots/position', (req, res) => {
    const { id, x, y, zone } = req.body;
    const parsedId = Number(id);
    if (!Number.isInteger(parsedId) || parsedId < 0 || parsedId > 31)
        return res.status(400).json({ error: "Invalid slot ID." });

    db.run(
        "UPDATE inventory SET x = ?, y = ?, zone = ? WHERE id = ?",
        [x ?? null, y ?? null, zone || 'A', parsedId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// 7. CLEAR LED — dismiss current LED and advance the queue.
//    Called by the "LED OFF" button in the dashboard.
app.post('/api/action/clear', (req, res) => {
    console.log('[API] LED OFF requested via dashboard.');
    clearActiveAndAdvance();
    res.json({ success: true });
});

server.listen(5000, () => console.log('Backend active on port 5000'));
