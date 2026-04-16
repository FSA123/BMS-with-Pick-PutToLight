const sqlite3 = require('sqlite3').verbose();

// 1. Establish connection to the database file. 
// If the file does not exist, SQLite will create it automatically.
const db = new sqlite3.Database('./warehouse_management.db', (err) => {
    if (err) {
        console.error("Engineering Error: Could not connect to database.", err.message);
    } else {
        console.log("Connected to the SQLite persistence layer.");
    }
});

db.serialize(() => {
    // 2. Define the Inventory Table
    // We use INTEGER for 'id' to map directly to our 32-bit shift register logic.
    db.run(`CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY,
        sku TEXT UNIQUE,
        name TEXT,
        quantity INTEGER DEFAULT 0,
        min_threshold INTEGER DEFAULT 5
    )`);

    // 3. Define the Transaction Log
    // This allows for historical auditing of all "Pick" and "Put" events.
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_id INTEGER,
        type TEXT CHECK(type IN ('PICK', 'PUT')),
        quantity_change INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (inventory_id) REFERENCES inventory(id)
    )`);

    // 4. Seed the Database
    // We pre-allocate 32 rows (0-31) to mirror the physical hardware constraints.
    const checkStmt = db.prepare("SELECT id FROM inventory WHERE id = ?");
    const insertStmt = db.prepare("INSERT INTO inventory (id, sku, name, quantity) VALUES (?, ?, ?, ?)");

    for (let i = 0; i < 32; i++) {
        const currentId = i;
        checkStmt.get(currentId, (err, row) => {
            if (!row) {
                insertStmt.run(currentId, `EMPTY-${currentId}`, `Slot ${currentId}`, 0);
            }
        });
    }

    console.log("Database Schema Initialized and 32-node mapping verified.");
});

module.exports = db;