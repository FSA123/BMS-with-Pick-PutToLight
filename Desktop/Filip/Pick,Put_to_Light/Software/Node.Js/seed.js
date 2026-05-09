/**
 * seed.js — Populate the warehouse database with 32 real electronics components.
 * Run once from the Node.Js directory:  node seed.js
 * The server does NOT need to be running; this script accesses the SQLite file directly.
 */

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const db = new sqlite3.Database(
    path.join(__dirname, 'warehouse_management.db'),
    (err) => { if (err) { console.error('Cannot open DB:', err.message); process.exit(1); } }
);

// ── COMPONENT DATA ────────────────────────────────────────────────────────────
// 6 zones × categories, 32 total slots (ids 0-31).
// x/y left NULL → frontend defaultPos() places them in a clean 4×8 grid.

const ITEMS = [
    // ── ZONE A  │  Resistors (Blue) ─────────────────────────────────────────
    {
        id: 0, zone: 'A', sku: 'RES-010R', name: 'Resistor 10Ω 0.25W',
        qty: 500, min_t: 50,
        desc: 'Carbon film, axial lead, ±5% tolerance. Common pull-down and current-sense resistor.',
    },
    {
        id: 1, zone: 'A', sku: 'RES-100R', name: 'Resistor 100Ω 0.25W',
        qty: 500, min_t: 50,
        desc: 'Carbon film, axial lead, ±5% tolerance. LED current limiting and base resistor applications.',
    },
    {
        id: 2, zone: 'A', sku: 'RES-1K0', name: 'Resistor 1kΩ 0.25W',
        qty: 500, min_t: 50,
        desc: 'Carbon film, axial lead, ±5% tolerance. Versatile pull-up, pull-down and biasing resistor.',
    },
    {
        id: 3, zone: 'A', sku: 'RES-10K', name: 'Resistor 10kΩ 0.25W',
        qty: 500, min_t: 50,
        desc: 'Carbon film, axial lead, ±5% tolerance. Most common pull-up resistor value for digital inputs.',
    },
    {
        id: 4, zone: 'A', sku: 'RES-100K', name: 'Resistor 100kΩ 0.25W',
        qty: 300, min_t: 30,
        desc: 'Carbon film, axial lead, ±5% tolerance. Voltage dividers, ADC input biasing and RC timing.',
    },
    {
        id: 5, zone: 'A', sku: 'RES-1M0', name: 'Resistor 1MΩ 0.25W',
        qty: 200, min_t: 20,
        desc: 'Carbon film, axial lead, ±5% tolerance. High-impedance input biasing and bleed resistors.',
    },

    // ── ZONE B  │  Capacitors (Green) ────────────────────────────────────────
    {
        id: 6, zone: 'B', sku: 'CAP-100N', name: 'Cap MLCC 100nF 50V',
        qty: 600, min_t: 80,
        desc: 'X7R ceramic, 0.1µF, 50V, ±10%, axial through-hole. Standard bypass/decoupling capacitor.',
    },
    {
        id: 7, zone: 'B', sku: 'CAP-10U16', name: 'Cap Electrolytic 10µF 16V',
        qty: 300, min_t: 30,
        desc: 'Aluminum electrolytic, radial, 10µF, 16V. General purpose bulk decoupling and filtering.',
    },
    {
        id: 8, zone: 'B', sku: 'CAP-100U25', name: 'Cap Electrolytic 100µF 25V',
        qty: 200, min_t: 20,
        desc: 'Aluminum electrolytic, radial, 100µF, 25V. Power supply input/output filtering.',
    },
    {
        id: 9, zone: 'B', sku: 'CAP-1U0', name: 'Cap MLCC 1µF 50V',
        qty: 400, min_t: 40,
        desc: 'X5R ceramic, 1µF, 50V, ±10%. Mid-frequency bypass and audio coupling applications.',
    },
    {
        id: 10, zone: 'B', sku: 'CAP-470U35', name: 'Cap Electrolytic 470µF 35V',
        qty: 120, min_t: 15,
        desc: 'Aluminum electrolytic, radial, 470µF, 35V. Main PSU reservoir and bulk energy storage.',
    },

    // ── ZONE C  │  Inductors & Passives (Amber) ───────────────────────────────
    {
        id: 11, zone: 'C', sku: 'IND-10U', name: 'Inductor 10µH Shielded',
        qty: 100, min_t: 10,
        desc: 'Shielded power inductor, 10µH, 1.5A Isat, 150mΩ DCR. DC-DC converter designs.',
    },
    {
        id: 12, zone: 'C', sku: 'IND-100U', name: 'Inductor 100µH Axial',
        qty: 80, min_t: 10,
        desc: 'Axial lead, 100µH, 500mA, ±10%. RF choke, filter coil and EMI suppression.',
    },
    {
        id: 13, zone: 'C', sku: 'XTAL-16M', name: 'Crystal 16MHz HC-49/S',
        qty: 50, min_t: 5,
        desc: '16MHz quartz crystal, HC-49/S package, 20pF load, ±30ppm. Standard AVR/Arduino clock source.',
    },
    {
        id: 14, zone: 'C', sku: 'FB-600R', name: 'Ferrite Bead 600Ω 0805',
        qty: 250, min_t: 25,
        desc: 'SMD 0805 ferrite bead, 600Ω @ 100MHz, 500mA rated. EMI suppression on power/signal lines.',
    },

    // ── ZONE D  │  Diodes & Transistors (Red) ──────────────────────────────────
    {
        id: 15, zone: 'D', sku: 'D-1N4148', name: 'Diode 1N4148 Signal',
        qty: 600, min_t: 60,
        desc: 'Silicon small-signal diode, 100V, 200mA, DO-35. Ultra-fast 4ns recovery. Switching, clamping.',
    },
    {
        id: 16, zone: 'D', sku: 'D-1N4007', name: 'Diode 1N4007 Rectifier',
        qty: 400, min_t: 40,
        desc: 'Silicon rectifier, 1000V, 1A, DO-41. Standard rectification and reverse-polarity protection.',
    },
    {
        id: 17, zone: 'D', sku: 'Z-5V1', name: 'Zener 5.1V 500mW',
        qty: 150, min_t: 15,
        desc: 'BZX55C5V1, 5.1V ±5%, 500mW, DO-35. Voltage reference and overvoltage clamping.',
    },
    {
        id: 18, zone: 'D', sku: 'T-2N2222', name: 'BJT NPN 2N2222A',
        qty: 250, min_t: 25,
        desc: 'NPN general-purpose transistor, 40V, 600mA, TO-92. Switching, amplification, relay/LED driver.',
    },
    {
        id: 19, zone: 'D', sku: 'MOSFET-540N', name: 'MOSFET N-Ch IRF540N',
        qty: 50, min_t: 5,
        desc: 'N-channel power MOSFET, 100V, 33A, 0.044Ω Rds(on), TO-220. Motor drive and high-current switching.',
    },

    // ── ZONE E  │  ICs & Microcontrollers (Purple) ─────────────────────────────
    {
        id: 20, zone: 'E', sku: 'IC-ATMEGA328', name: 'ATmega328P-PU MCU',
        qty: 20, min_t: 5,
        desc: '8-bit AVR MCU, 32KB flash, 2KB SRAM, DIP-28. Arduino Uno/Nano heart. 20MHz max, 1.8–5.5V.',
    },
    {
        id: 21, zone: 'E', sku: 'IC-ESP32', name: 'ESP-WROOM-32 Module',
        qty: 15, min_t: 3,
        desc: 'Wi-Fi + BT SoC module, dual-core 240MHz Xtensa, 4MB flash, 520KB SRAM. FCC/CE certified.',
    },
    {
        id: 22, zone: 'E', sku: 'IC-NE555', name: 'NE555 Timer IC',
        qty: 100, min_t: 10,
        desc: 'Precision timer, DIP-8, 5–15V. Astable/monostable oscillator. Sink/source 200mA output.',
    },
    {
        id: 23, zone: 'E', sku: 'IC-LM358', name: 'LM358N Dual Op-Amp',
        qty: 80, min_t: 10,
        desc: 'Dual op-amp, DIP-8, single-supply 3–32V, 1MHz GBW. Comparator, amplifier, filter circuits.',
    },
    {
        id: 24, zone: 'E', sku: 'IC-L298N', name: 'L298N Dual H-Bridge',
        qty: 30, min_t: 5,
        desc: 'Dual full H-bridge driver, 2×2A per channel, 46V max, MultiWatt-15. DC motor and stepper control.',
    },
    {
        id: 25, zone: 'E', sku: 'IC-AMS1117', name: 'AMS1117-3.3 LDO Reg',
        qty: 60, min_t: 10,
        desc: 'LDO voltage regulator, 3.3V fixed output, 1A max, SOT-223. Standard 5V→3.3V supply for IoT.',
    },

    // ── ZONE F  │  Connectors & Electromechanical (Pink) ──────────────────────
    {
        id: 26, zone: 'F', sku: 'LED-RED5', name: 'LED Red 5mm',
        qty: 400, min_t: 40,
        desc: 'Through-hole, 620nm red, 20mA, 2.1V Vf, 5mm diffused lens. Standard status indicator.',
    },
    {
        id: 27, zone: 'F', sku: 'LED-GRN5', name: 'LED Green 5mm',
        qty: 400, min_t: 40,
        desc: 'Through-hole, 525nm green, 20mA, 2.2V Vf, 5mm diffused lens. Power and status indicator.',
    },
    {
        id: 28, zone: 'F', sku: 'BTN-6X6', name: 'Tactile Button 6×6mm',
        qty: 300, min_t: 30,
        desc: 'SPST NO momentary push button, 6×6×4.3mm, PCB through-hole, 12V 50mA. Reset and user input.',
    },
    {
        id: 29, zone: 'F', sku: 'RLY-HE3621', name: 'Relay 5V SPDT 10A',
        qty: 50, min_t: 5,
        desc: 'Miniature power relay, 5V coil 70mA, SPDT 10A 250VAC contacts. AC load switching from logic.',
    },
    {
        id: 30, zone: 'F', sku: 'USB-C-SMD', name: 'USB Type-C SMD 16P',
        qty: 80, min_t: 10,
        desc: 'USB 2.0 Type-C receptacle, SMD mid-mount 0.8mm, 16 pins. Charging and data interface connector.',
    },
    {
        id: 31, zone: 'F', sku: 'DC-21MM', name: 'DC Barrel Jack 2.1mm',
        qty: 100, min_t: 10,
        desc: 'PCB mount DC power jack, 2.1mm ID / 5.5mm OD, through-hole. Standard 5V/12V power input.',
    },
];

// ── SEED ─────────────────────────────────────────────────────────────────────
db.serialize(() => {
    // Ensure tables and columns exist (idempotent — runs cleanly on first and repeat runs)
    db.run(`CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY,
        sku TEXT UNIQUE,
        name TEXT,
        quantity INTEGER DEFAULT 0,
        min_threshold INTEGER DEFAULT 5
    )`);

    [
        "ALTER TABLE inventory ADD COLUMN x REAL",
        "ALTER TABLE inventory ADD COLUMN y REAL",
        "ALTER TABLE inventory ADD COLUMN zone TEXT DEFAULT 'A'",
        "ALTER TABLE inventory ADD COLUMN description TEXT DEFAULT ''",
        "ALTER TABLE inventory ADD COLUMN datasheet_url TEXT DEFAULT ''",
        "ALTER TABLE inventory ADD COLUMN image_url TEXT DEFAULT ''",
        "ALTER TABLE inventory ADD COLUMN supplier_name TEXT DEFAULT ''",
        "ALTER TABLE inventory ADD COLUMN supplier_part TEXT DEFAULT ''",
        "ALTER TABLE inventory ADD COLUMN supplier_url TEXT DEFAULT ''",
    ].forEach(sql => db.run(sql, () => {}));

    // Ensure 32 slots exist (INSERT OR IGNORE creates missing ones)
    const init = db.prepare("INSERT OR IGNORE INTO inventory (id, sku, name, quantity) VALUES (?, ?, ?, 0)");
    for (let i = 0; i < 32; i++) init.run(i, `EMPTY-${i}`, `Slot ${i}`);
    init.finalize();

    // Reset ALL slots to empty so stale data is cleared
    db.run(
        `UPDATE inventory SET
            sku=('EMPTY-'||id), name=('Slot '||id),
            quantity=0, zone='A',
            x=NULL, y=NULL,
            description='', datasheet_url='', image_url='',
            supplier_name='', supplier_part='', supplier_url=''`
    );

    // Insert electronics components
    const stmt = db.prepare(
        `UPDATE inventory SET
            name=?, sku=?, quantity=?, zone=?,
            x=NULL, y=NULL,
            description=?, min_threshold=?,
            datasheet_url='', image_url='',
            supplier_name='', supplier_part='', supplier_url=''
         WHERE id=?`
    );

    for (const item of ITEMS) {
        stmt.run(item.name, item.sku, item.qty, item.zone, item.desc, item.min_t, item.id);
    }
    stmt.finalize(() => {
        console.log(`✓ Seeded ${ITEMS.length} electronics components across 6 zones.`);
        db.close();
    });
});
