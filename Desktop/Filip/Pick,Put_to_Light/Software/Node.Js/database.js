const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./warehouse_management.db', (err) => {
    if (err) {
        console.error("Could not connect to database.", err.message);
    } else {
        console.log("Connected to SQLite.");
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY,
        sku TEXT UNIQUE,
        name TEXT,
        quantity INTEGER DEFAULT 0,
        min_threshold INTEGER DEFAULT 5
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_id INTEGER,
        type TEXT CHECK(type IN ('PICK', 'PUT')),
        quantity_change INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (inventory_id) REFERENCES inventory(id)
    )`);

    // Add layout columns to existing databases (ignored silently if already present)
    ['ALTER TABLE inventory ADD COLUMN x REAL',
     'ALTER TABLE inventory ADD COLUMN y REAL',
     'ALTER TABLE inventory ADD COLUMN zone TEXT DEFAULT \'A\'']
        .forEach(sql => db.run(sql, err => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Migration error:', err.message);
            }
        }));

    const checkStmt = db.prepare("SELECT id FROM inventory WHERE id = ?");
    const insertStmt = db.prepare("INSERT INTO inventory (id, sku, name, quantity) VALUES (?, ?, ?, ?)");

    for (let i = 0; i < 32; i++) {
        checkStmt.get(i, (err, row) => {
            if (!row) insertStmt.run(i, `EMPTY-${i}`, `Slot ${i}`, 0);
        });
    }

    console.log("Schema ready.");
});

module.exports = db;
