# BMS with Pick/Put-to-Light

A full-stack, IoT-enabled warehouse bin management system (BMS) that couples a custom-designed PCB — built around an Espressif ESP32 microcontroller and four **TPIC6B595N** high-current shift registers — with a Node.js back-end and a React dashboard. Physical bin locations are indicated in real time by 32 individually addressable LEDs: a **solid light** marks a PUT (restocking) bin and a **flashing light** marks a PICK (retrieval) bin, all driven wirelessly from a browser-based operator dashboard.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Structure](#2-repository-structure)
3. [Hardware Design](#3-hardware-design)
   - 3.1 [ESP32 Microcontroller](#31-esp32-microcontroller)
   - 3.2 [TPIC6B595N Power Logic Shift Registers](#32-tpic6b595n-power-logic-shift-registers)
   - 3.3 [Daisy-Chain SPI Topology](#33-daisy-chain-spi-topology)
   - 3.4 [LED Output Mapping](#34-led-output-mapping)
   - 3.5 [Pin Assignment](#35-pin-assignment)
4. [Firmware](#4-firmware)
   - 4.1 [Toolchain & Build System](#41-toolchain--build-system)
   - 4.2 [Dependencies](#42-dependencies)
   - 4.3 [Configuration](#43-configuration)
   - 4.4 [WiFi Connection](#44-wifi-connection)
   - 4.5 [WebSocket Client](#45-websocket-client)
   - 4.6 [Command Protocol](#46-command-protocol)
   - 4.7 [LED State Machine](#47-led-state-machine)
   - 4.8 [SPI Driver & Latch Sequence](#48-spi-driver--latch-sequence)
   - 4.9 [Non-Blocking Flash Timer](#49-non-blocking-flash-timer)
5. [Back-End (Node.js Server)](#5-back-end-nodejs-server)
   - 5.1 [Technology Stack](#51-technology-stack)
   - 5.2 [Database Schema](#52-database-schema)
   - 5.3 [REST API Reference](#53-rest-api-reference)
   - 5.4 [WebSocket Bridge](#54-websocket-bridge)
6. [Front-End (React Dashboard)](#6-front-end-react-dashboard)
   - 6.1 [Technology Stack](#61-technology-stack)
   - 6.2 [Application Architecture](#62-application-architecture)
   - 6.3 [Floor Map & Zone System](#63-floor-map--zone-system)
   - 6.4 [Operator Workflow](#64-operator-workflow)
   - 6.5 [Edit Mode](#65-edit-mode)
7. [Data & Signal Flow](#7-data--signal-flow)
8. [Development Setup](#8-development-setup)
   - 8.1 [Prerequisites](#81-prerequisites)
   - 8.2 [Back-End](#82-back-end)
   - 8.3 [Front-End Dashboard](#83-front-end-dashboard)
   - 8.4 [Firmware](#84-firmware)
   - 8.5 [Mock ESP32 (Hardware-Free Testing)](#85-mock-esp32-hardware-free-testing)
9. [Configuration Reference](#9-configuration-reference)
10. [Design Decisions & Trade-offs](#10-design-decisions--trade-offs)
11. [Glossary](#11-glossary)

---

## 1. System Overview

Pick-to-Light and Put-to-Light are well-established industrial techniques used in order-fulfilment, manufacturing, and warehousing to reduce picking errors and increase throughput by guiding operators with light signals rather than paper or screen-based lists. This project implements both paradigms in a self-contained, low-cost system.

```
 ┌─────────────────────────────────────────────────────┐
 │              Browser (React Dashboard)              │
 │   Operator clicks PICK or PUT on a slot card        │
 └────────────────────┬────────────────────────────────┘
                      │  HTTP POST  /api/action
                      ▼
 ┌─────────────────────────────────────────────────────┐
 │         Node.js Server  (Express + ws)              │
 │  • Updates SQLite inventory                         │
 │  • Sends JSON command to ESP32 via WebSocket        │
 └────────────────────┬────────────────────────────────┘
                      │  WebSocket  JSON { mask, action }
                      ▼  (TCP/IP over WiFi, same LAN)
 ┌─────────────────────────────────────────────────────┐
 │              Custom PCB — ESP32                     │
 │  • Parses command                                   │
 │  • Updates solid / flash bitmasks                   │
 │  • Clocks 4 bytes out over SPI                      │
 └────────────────────┬────────────────────────────────┘
                      │  SPI (SRCLK / MOSI)
                      ▼
 ┌─────────────────────────────────────────────────────┐
 │  4 × TPIC6B595N (daisy-chained shift registers)     │
 │  32 open-drain outputs → 32 LEDs                    │
 └─────────────────────────────────────────────────────┘
```

The entire control path — from operator click to LED change — takes place wirelessly over an ordinary 2.4 GHz Wi-Fi network with end-to-end latency typically below 50 ms on a local area network.

---

## 2. Repository Structure

```
Desktop/Filip/Pick,Put_to_Light/Software/
├── Firmware/                      # ESP32 firmware (PlatformIO / Arduino framework)
│   ├── src/
│   │   └── main.cpp               # All firmware logic (single compilation unit)
│   ├── include/                   # Header directory (currently empty placeholder)
│   ├── lib/                       # Local libraries (currently empty placeholder)
│   ├── platformio.ini             # PlatformIO project configuration
│   ├── CMakeLists.txt             # ESP-IDF CMake shim (alternative build)
│   └── sdkconfig.esp32dev         # ESP-IDF SDK config snapshot
└── Node.Js/                       # Server + dashboard
    ├── server.js                  # Express HTTP server + ws WebSocket server
    ├── database.js                # SQLite schema bootstrap and db module export
    ├── mock_esp32.js              # Development utility: simulates ESP32 WebSocket client
    ├── warehouse_management.db    # SQLite database file (auto-created on first run)
    ├── package.json               # Node.js project manifest and dependencies
    └── dashboard/                 # React single-page application
        ├── src/
        │   ├── App.js             # Root component — all UI and business logic
        │   ├── App.css            # Custom CSS (dark industrial theme)
        │   └── index.js           # React DOM entry point
        └── package.json           # React app dependencies and CRA scripts
```

---

## 3. Hardware Design

### 3.1 ESP32 Microcontroller

The ESP32 (Espressif Systems, dual-core Xtensa LX6, 240 MHz) was chosen for this application for the following reasons:

- **Integrated 802.11 b/g/n WiFi** — removes the need for an external network module.
- **Hardware SPI peripheral** — allows the four shift registers to be clocked at up to several MHz without bit-banging overhead.
- **Arduino-framework compatibility** — greatly accelerates firmware development while retaining access to the full ESP-IDF feature set when needed.
- **3.3 V logic levels** — compatible with the TPIC6B595N's logic inputs without level shifting.
- **Rich GPIO count** — five dedicated GPIOs are used for shift-register control, leaving ample headroom for future expansion.

The custom PCB integrates the ESP32 module directly, together with decoupling capacitors, a USB-to-UART bridge for programming and serial debug output, and the four shift-register ICs.

### 3.2 TPIC6B595N Power Logic Shift Registers

The **TPIC6B595N** (Texas Instruments) is an 8-bit serial-in, parallel-out power shift register with open-drain N-channel DMOS output transistors rated at 50 V / 150 mA per channel. Key characteristics relevant to this design:

| Parameter | Value |
|---|---|
| Output voltage (DRAIN) | up to 50 V |
| Output current (continuous) | 150 mA per channel |
| Logic supply (V<sub>CC</sub>) | 3.3 V – 5.5 V |
| Serial clock frequency (max) | 20 MHz |
| Propagation delay (shift → output) | < 30 ns |
| Output enable (G̅) | Active LOW |
| Shift-register clear (SRCLR̅) | Active LOW |
| Storage-register clock (RCK) | Rising-edge triggered |

Each chip has eight drain outputs (`O0`–`O7`). An output is pulled LOW (sinking current through the LED) when the corresponding bit in the storage register is HIGH and the output-enable pin (G̅) is held LOW. A current-limiting resistor in series with each LED sets the operating current to a safe value.

### 3.3 Daisy-Chain SPI Topology

The four chips are connected in a serial daisy chain:

```
ESP32 MOSI ──► Chip 1 SER_IN ──► Chip 1 SER_OUT
                                       │
                               Chip 2 SER_IN ──► Chip 2 SER_OUT
                                                       │
                                               Chip 3 SER_IN ──► Chip 3 SER_OUT
                                                                       │
                                                               Chip 4 SER_IN
```

All four chips share the same SRCLK (shift clock), RCK (storage-register latch clock), SRCLR̅ (shift-register clear), and G̅ (output enable) lines. The SPI MISO line is not connected; this is a write-only bus.

The daisy-chain topology implies that data clocked into Chip 1 eventually shifts through all four chips as more bytes arrive. Therefore, to populate all 32 output positions correctly in a single burst:

1. Transmit the byte for **Chip 4** first — it will be shifted through Chips 1, 2, and 3 before settling in Chip 4's shift register.
2. Transmit the byte for **Chip 3** second.
3. Transmit the byte for **Chip 2** third.
4. Transmit the byte for **Chip 1** last — it arrives directly in Chip 1's shift register.

After all four bytes have been clocked in, a rising edge on RCK simultaneously copies all four shift registers into the corresponding storage registers, making all 32 output changes appear atomically and glitch-free.

### 3.4 LED Output Mapping

| LED Indices | Chip | Bit Range (32-bit mask) |
|---|---|---|
| LED 0 – 7 | Chip 1 | bits 0–7 |
| LED 8 – 15 | Chip 2 | bits 8–15 |
| LED 16 – 23 | Chip 3 | bits 16–23 |
| LED 24 – 31 | Chip 4 | bits 24–31 |

Each slot in the inventory database has an `id` in the range 0–31, which maps directly to the LED index and therefore to a specific bit position in the 32-bit control mask.

### 3.5 Pin Assignment

| GPIO | Function | Connected to |
|---|---|---|
| 18 | SPI SCLK (`PIN_SRCLK`) | SRCLK on all 4 chips |
| 23 | SPI MOSI (`PIN_SER_IN`) | SER_IN of Chip 1 |
| 5 | Latch clock (`PIN_RCK`) | RCK on all 4 chips |
| 21 | Shift-register clear (`PIN_SRCLR`) | SRCLR̅ on all 4 chips (active LOW — held HIGH) |
| 19 | Output enable (`PIN_G`) | G̅ on all 4 chips (active LOW — held LOW) |
| 3 | SRCLR reinforcement | Secondary driver for SRCLR̅ line (GPIO3 freed from UART RX) |
| 2 | Onboard LED | Boot confirmation blink |
| 1 | UART TX | USB-serial debug output (115 200 baud) |

---

## 4. Firmware

### 4.1 Toolchain & Build System

The firmware is built with **PlatformIO** using the `espressif32` platform and the `arduino` framework. PlatformIO abstracts the ESP-IDF toolchain (Xtensa GCC cross-compiler, CMake, OpenOCD) behind a unified project model. The `platformio.ini` file at the firmware root is the single source of truth for:

- Target board (`esp32dev`)
- Upload port (`COM7` — change to match your system)
- Upload baud rate (`921600`) for fast flashing
- Monitor baud rate (`115200`) for serial debug
- Third-party library declarations

A `CMakeLists.txt` shim is also present, enabling the project to be opened and built directly with the ESP-IDF CMake system (`idf.py build`) as an alternative to PlatformIO.

### 4.2 Dependencies

| Library | Source | Purpose |
|---|---|---|
| `WebSocketsClient` v2.4+ | links2004/WebSockets | WebSocket client implementation (RFC 6455) |
| `ArduinoJson` v7+ | bblanchon/ArduinoJson | Zero-copy JSON deserialisation |
| `Arduino SPI` | Built-in (ESP-IDF) | Hardware SPI peripheral driver |
| `WiFi` | Built-in (ESP-IDF) | 802.11 station mode |

### 4.3 Configuration

Before flashing, edit the two compile-time constants at the top of `src/main.cpp`:

```cpp
#define WIFI_SSID   "YourNetworkName"
#define WIFI_PASS   "YourPassword"
#define SERVER_IP   "192.168.x.x"   // IPv4 address of the PC running server.js
#define SERVER_PORT  5000
```

Find the server IP by running `ipconfig` (Windows) or `ip a` / `hostname -I` (Linux/macOS) on the host machine.

### 4.4 WiFi Connection

On startup, the firmware calls `WiFi.begin()` and blocks in a polling loop until `WiFi.status() == WL_CONNECTED`. The ESP32 operates in **station (STA) mode**, associating with the existing access point specified by `WIFI_SSID`. Once connected, the assigned IP address is printed to the serial console.

### 4.5 WebSocket Client

The `WebSocketsClient` library (built on top of the ESP-IDF TCP socket API) manages the WebSocket handshake (HTTP Upgrade), message framing, ping/pong heartbeat, and automatic reconnection:

```cpp
ws.begin(SERVER_IP, SERVER_PORT, "/");
ws.onEvent(onWebSocketEvent);
ws.setReconnectInterval(3000);       // retry every 3 s if disconnected
ws.enableHeartbeat(15000, 3000, 2);  // ping every 15 s; drop after 2 missed pongs
```

`ws.loop()` is called every iteration of `loop()` to process incoming frames and drive the reconnection state machine without blocking.

### 4.6 Command Protocol

The server sends UTF-8 JSON text frames to the ESP32. The schema is:

```json
{ "mask": <int32>, "action": "PUT" | "PICK" | "CLEAR" }
```

- **`mask`** — a 32-bit integer with exactly one bit set. Bit *N* corresponds to LED *N* (slot ID *N*). Because JavaScript's bitwise left-shift operator (`<<`) returns a **signed 32-bit integer**, LED 31 arrives as `−2147483648` (i.e., `0x80000000` interpreted as signed). The firmware reads this field as `int32_t` and reinterprets the bit pattern as `uint32_t` to preserve the correct bit:

  ```cpp
  int32_t  rawMask = doc["mask"].as<int32_t>();
  uint32_t mask    = (uint32_t)rawMask;
  ```

- **`action`** — one of three string values:
  - `"PUT"` — assign the LED to the *solid-on* (restocking) mask.
  - `"PICK"` — assign the LED to the *flashing* (retrieval) mask.
  - `"CLEAR"` — remove the LED from both masks (turn it off).

### 4.7 LED State Machine

Two global 32-bit bitmasks represent the complete LED state:

| Mask | Meaning |
|---|---|
| `solidMask` | Each set bit indicates a permanently lit LED (PUT action) |
| `flashMask` | Each set bit indicates a flashing LED (PICK action) |

A given LED index can be in at most one mask at a time. Assigning an LED to one mask automatically clears it from the other:

```cpp
// PUT
solidMask |=  mask;
flashMask &= ~mask;

// PICK
flashMask |=  mask;
solidMask &= ~mask;

// CLEAR
solidMask &= ~mask;
flashMask &= ~mask;
```

### 4.8 SPI Driver & Latch Sequence

`applyLEDs(uint32_t activeMask)` decomposes the 32-bit mask into four bytes — one per chip — and calls `writeRegisters()`:

```cpp
void writeRegisters(const uint8_t* data, uint8_t count) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    for (int i = count - 1; i >= 0; i--) {
        SPI.transfer(data[i]);   // Chip 4 byte first, Chip 1 byte last
    }
    SPI.endTransaction();

    digitalWrite(PIN_RCK, HIGH);  // latch pulse: shift regs → output regs
    delayMicroseconds(1);         // 1 µs >> 20 ns minimum RCK pulse width
    digitalWrite(PIN_RCK, LOW);
}
```

The SPI clock is set to 1 MHz — well within the TPIC6B595N's 20 MHz maximum and well above the threshold where propagation delay matters on a PCB trace. `SPI_MODE0` (CPOL=0, CPHA=0) matches the TPIC6B595N's clocking requirements (data latched on rising edge of SRCLK).

A caching optimisation prevents redundant SPI transfers: `lastActiveMask` stores the value most recently written to hardware, and `applyLEDs()` is only called when `activeMask != lastActiveMask`.

### 4.9 Non-Blocking Flash Timer

The flashing behaviour is implemented without `delay()`, preserving the responsiveness of `ws.loop()`:

```cpp
unsigned long now = millis();
if (now - lastFlashTick >= FLASH_INTERVAL) {   // FLASH_INTERVAL = 350 ms
    lastFlashTick = now;
    flashPhase = !flashPhase;
}

uint32_t activeMask = solidMask | (flashPhase ? flashMask : 0);
```

`flashPhase` toggles between `true` (flashing LEDs ON) and `false` (flashing LEDs OFF) every 350 ms, producing a 1.43 Hz blink frequency that is visually conspicuous without being distracting.

---

## 5. Back-End (Node.js Server)

### 5.1 Technology Stack

| Package | Version | Role |
|---|---|---|
| `express` | ^5.2 | HTTP REST API framework |
| `ws` | ^8.20 | WebSocket server (RFC 6455) |
| `sqlite3` | ^6.0 | Embedded relational database |
| `body-parser` | ^2.2 | JSON request-body parsing middleware |
| `cors` | ^2.8 | Cross-Origin Resource Sharing headers (allows dashboard on port 3000 to call API on port 5000) |

The server is a single Node.js process (`server.js`) that exposes both an HTTP server (for the REST API) and a WebSocket server on the **same TCP port (5000)**. This is achieved by attaching `ws.Server` to the underlying `http.Server` instance rather than opening a separate port.

### 5.2 Database Schema

The SQLite database (`warehouse_management.db`) is auto-created and seeded on the first run by `database.js`. It contains two tables:

#### `inventory`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Slot index 0–31; directly maps to LED number |
| `sku` | TEXT UNIQUE | Stock-keeping unit identifier. Defaults to `EMPTY-{id}` for unassigned slots |
| `name` | TEXT | Human-readable object name. Defaults to `Slot {id}` |
| `quantity` | INTEGER | Current stock level. Defaults to 0 |
| `min_threshold` | INTEGER | Low-stock alert threshold (reserved for future use). Defaults to 5 |
| `x` | REAL | Horizontal position on the floor map (0–100, percentage of map width) |
| `y` | REAL | Vertical position on the floor map (0–100, percentage of map height) |
| `zone` | TEXT | Warehouse zone identifier (A–F). Defaults to 'A' |

On startup, the code checks whether columns `x`, `y`, and `zone` exist; if not, it adds them via `ALTER TABLE`. This migration pattern provides backward compatibility when the database was created by an older version of the software.

All 32 slot rows (id 0–31) are inserted if they do not already exist, ensuring the hardware always has a corresponding database record.

#### `transactions`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Auto-incrementing row ID |
| `inventory_id` | INTEGER | Foreign key → `inventory.id` |
| `type` | TEXT | `'PICK'` or `'PUT'` (enforced by CHECK constraint) |
| `quantity_change` | INTEGER | Signed quantity delta |
| `timestamp` | DATETIME | Defaults to `CURRENT_TIMESTAMP` |

The transactions table records an audit trail of all pick/put operations. (Note: the current version of `server.js` updates `inventory` quantities but does not yet insert rows into `transactions`; this table is reserved for a future audit-log feature.)

### 5.3 REST API Reference

Base URL: `http://<server-ip>:5000/api`

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/inventory` | — | Returns all 32 inventory rows ordered by `id ASC` |
| `POST` | `/action` | `{ id, type }` | Single pick or put. Updates quantity by ±1 and signals ESP32 |
| `POST` | `/action/bulk` | `{ id, type, quantity }` | Multi-unit pick or put. Updates quantity by ±N and signals ESP32 |
| `POST` | `/action/clear` | `{ id }` | Turns the LED off without changing inventory (sends `CLEAR` to ESP32) |
| `POST` | `/slots/update` | `{ id, name, sku, quantity }` | Upserts slot metadata (name, SKU, quantity) |
| `POST` | `/slots/remove` | `{ id }` | Resets a slot to its empty default state (`name="Slot N"`, `sku="EMPTY-N"`, `quantity=0`) |
| `POST` | `/slots/position` | `{ id, x, y, zone }` | Persists the slot's floor-map position and zone assignment |

**Validation rules applied server-side:**
- `id` must be an integer in [0, 31].
- `type` must be `"PICK"` or `"PUT"`.
- A PICK that would reduce quantity below zero is rejected with HTTP 400.
- `quantity` (for bulk operations) must be a positive integer.
- `name` is required and cannot be empty or whitespace-only.
- `quantity` (for slot update) must be a non-negative integer.

### 5.4 WebSocket Bridge

`server.js` maintains a single reference to the most recently connected WebSocket client:

```js
let esp32Client = null;
wss.on('connection', (ws) => {
    esp32Client = ws;
    console.log("ESP32/Mock Connected");
});
```

Whenever an action route needs to signal the hardware, it calls:

```js
esp32Client.send(JSON.stringify({ mask: (1 << parsedId), action: type }));
```

The server does not currently handle concurrent hardware clients or authentication. In a production deployment these concerns would need to be addressed.

---

## 6. Front-End (React Dashboard)

### 6.1 Technology Stack

| Package | Version | Role |
|---|---|---|
| `react` | ^19 | UI component framework |
| `react-dom` | ^19 | DOM renderer |
| `axios` | ^1.15 | HTTP client for REST API calls |
| `react-scripts` | 5.0.1 | Create React App build toolchain (webpack, Babel, ESLint, Jest) |

The dashboard is a React 19 single-page application bootstrapped with Create React App. All application logic is contained in a single root component (`App.js`) using React Hooks (`useState`, `useEffect`, `useRef`). There is no client-side routing or additional state management library; the component's local state is the single source of truth for the UI.

### 6.2 Application Architecture

```
App (root component)
├── State
│   ├── inventory[]         — 32-slot array fetched from /api/inventory
│   ├── selectedSlot        — currently focused slot (drives side panel)
│   ├── isEditMode          — toggles drag-and-drop layout editing
│   ├── activePickId        — tracks which slot's LED is currently flashing
│   └── customQtyOpen/Qty   — controls bulk-quantity input widget
├── Effects
│   ├── fetchInventory()    — initial load + after every mutating action
│   └── inventoryRef        — mutable ref kept in sync with inventory state
│                             (used inside mouse-event closures to avoid stale captures)
└── Render
    ├── <header> Top bar    — branding, search, system status, Edit Layout button
    ├── <div>  Floor map    — absolute-positioned slot cards + zone legend
    └── <aside> Side panel  — slot detail, PICK/PUT/LED-OFF controls, edit form
```

### 6.3 Floor Map & Zone System

The floor map is a relative-positioned `div` that renders each slot as an absolutely-positioned card at coordinates `(x%, y%)`. The coordinates are persisted in the database and loaded with the inventory data, allowing operators to arrange the virtual map to mirror the physical warehouse layout.

Six warehouse zones (A–F) are supported, each with a distinct accent colour:

| Zone | Colour |
|---|---|
| A | Blue `#3b82f6` |
| B | Green `#10b981` |
| C | Amber `#f59e0b` |
| D | Red `#ef4444` |
| E | Purple `#8b5cf6` |
| F: Pink `#ec4899` |

Zone colour is applied to the left-side accent bar of each slot card, the quantity value, and the zone badge in the side panel, providing a consistent at-a-glance visual grouping.

Slots whose SKU begins with `EMPTY-` are treated as unassigned. They are hidden from the floor map in normal operating mode and shown only when Edit Mode is active, preventing visual clutter while still allowing operators to assign new objects to any bin.

### 6.4 Operator Workflow

1. **Select a slot** — click any bin card on the floor map. The side panel opens showing the object name, SKU, and current quantity.
2. **PICK** — click the `PICK` button to decrement the quantity by 1. The server deducts 1 from the database and sends a `PICK` command to the ESP32. The corresponding LED begins flashing.
3. **Custom Pick** — click the `⋯` button to open the bulk-quantity widget. Enter a quantity and click `− PICK N` to pick multiple units in a single operation.
4. **PUT** — click `PUT` to increment quantity by 1 (or use the bulk widget for multiple units). The LED turns solid.
5. **LED OFF** — click `LED OFF` to send a `CLEAR` command to the ESP32 (e.g., after the operator has completed the task at that bin). The LED turns off; inventory is not changed.

Optimistic UI updates — the component updates local state immediately before awaiting the server response — ensure the interface feels instantaneous. If the server returns an error, the inventory is re-fetched to restore consistency.

### 6.5 Edit Mode

Clicking **Edit Layout** enters Edit Mode. In this mode:

- All slots (including empty ones) are visible.
- Slots can be dragged to new positions. A displacement of less than 5 pixels is interpreted as a click (opening the edit form) rather than a drag. Positions are saved to the server on mouse-up.
- Zone colour pips appear on each card. Clicking a pip assigns the slot to that zone.
- The operator side panel PICK/PUT actions are disabled.

---

## 7. Data & Signal Flow

The following sequence describes a complete single-unit PICK operation from dashboard to LED:

```
1. Operator clicks PICK on Slot 7 in the browser.

2. App.js calls:
   axios.post('http://localhost:5000/api/action', { id: 7, type: 'PICK' })

3. server.js receives POST /api/action.
   • Validates id=7, type='PICK'.
   • Executes SQL:
       UPDATE inventory
       SET quantity = quantity - 1
       WHERE id = 7 AND quantity > 0
   • Checks this.changes > 0 (ensures stock was available).
   • Calls:
       esp32Client.send(JSON.stringify({ mask: 1 << 7, action: 'PICK' }))
     → mask = 128 = 0x00000080

4. ESP32 WebSocket client receives the JSON frame.
   • Deserialises: mask=128, action="PICK"
   • Resolves ledIndex = 7 (bit 7 of mask)
   • Sets:  flashMask |= 0x00000080
            solidMask &= ~0x00000080

5. In loop():
   • flashPhase toggles every 350 ms.
   • When flashPhase==true:
       activeMask = solidMask | flashMask = 0x00000080
   • When flashPhase==false:
       activeMask = solidMask | 0 = 0x00000000 (assuming no other LEDs solid)
   • applyLEDs() decomposes activeMask into 4 bytes:
       data[0] = (activeMask >>  0) & 0xFF = 0x80  → Chip 1 (LED 7 = bit 7)
       data[1] = (activeMask >>  8) & 0xFF = 0x00
       data[2] = (activeMask >> 16) & 0xFF = 0x00
       data[3] = (activeMask >> 24) & 0xFF = 0x00
   • SPI transmits: 0x00, 0x00, 0x00, 0x80
     (Chip 4 byte first → Chip 1 byte last in the chain)
   • RCK pulse latches data into output registers.
   • LED 7 on Chip 1 turns ON / OFF at 350 ms intervals.
```

---

## 8. Development Setup

### 8.1 Prerequisites

- [Node.js](https://nodejs.org/) 18 LTS or later
- [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (CLI) or [VS Code with PlatformIO extension](https://platformio.org/install/ide?install=vscode)
- Git

### 8.2 Back-End

```bash
cd Desktop/Filip/Pick\,Put_to_Light/Software/Node.Js

# Install dependencies
npm install

# Start the server (listens on http://localhost:5000)
node server.js
```

The SQLite database file (`warehouse_management.db`) and all 32 empty slot records are created automatically on the first run. The server is ready when the console shows:

```
Connected to SQLite.
Schema ready.
Backend active on port 5000
```

### 8.3 Front-End Dashboard

```bash
cd Desktop/Filip/Pick\,Put_to_Light/Software/Node.Js/dashboard

# Install dependencies
npm install

# Start the development server (http://localhost:3000)
npm start
```

The dashboard communicates with the back-end at `http://localhost:5000/api`. Ensure the Node.js server is running before starting the dashboard.

To build a production bundle:

```bash
npm run build
```

The output in `build/` can be served by any static file host, or by adding `express.static('dashboard/build')` to `server.js`.

### 8.4 Firmware

1. Open the `Firmware/` directory as a PlatformIO project in VS Code, or run `pio run` from the command line.
2. Edit `src/main.cpp`: set `WIFI_SSID`, `WIFI_PASS`, `SERVER_IP`, `SERVER_PORT`.
3. Connect the ESP32 PCB via USB. Verify the COM port in `platformio.ini` (`upload_port = COM7`).
4. Flash the firmware:
   ```bash
   pio run --target upload
   ```
5. Open the serial monitor:
   ```bash
   pio device monitor --baud 115200
   ```
   On successful connection you should see:
   ```
   [WiFi] Connected! Local IP: 192.168.x.x
   [WS] Connected to server!
   [WS] Waiting for PUT / PICK commands...
   ```

### 8.5 Mock ESP32 (Hardware-Free Testing)

If the physical PCB is unavailable, `mock_esp32.js` simulates the ESP32 WebSocket client. It connects to the server, receives LED commands, and prints the decoded bitmask to the console — allowing the full software stack to be exercised without hardware.

```bash
cd Desktop/Filip/Pick\,Put_to_Light/Software/Node.Js
node mock_esp32.js
```

Sample output when a PICK on slot 3 is triggered:

```
Mock ESP32: Connected to Server.
--- HARDWARE SIGNAL RECEIVED ---
Action: PICK
Raw Bitmask (Decimal): 8
Binary Representation: 00000000000000000000000000001000
-------------------------------
```

---

## 9. Configuration Reference

### Firmware (`src/main.cpp`)

| Constant | Default | Description |
|---|---|---|
| `WIFI_SSID` | `"SMARTTRANS"` | SSID of the access point |
| `WIFI_PASS` | — | WiFi password |
| `SERVER_IP` | `"192.168.100.173"` | IP address of the Node.js server |
| `SERVER_PORT` | `5000` | TCP port of the server |
| `PIN_SRCLK` | `18` | SPI clock GPIO |
| `PIN_SER_IN` | `23` | SPI MOSI GPIO |
| `PIN_RCK` | `5` | Storage-register latch GPIO |
| `PIN_SRCLR` | `21` | Shift-register clear GPIO (held HIGH) |
| `PIN_G` | `19` | Output-enable GPIO (held LOW) |
| `NUM_CHIPS` | `4` | Number of TPIC6B595N chips |
| `FLASH_INTERVAL` | `350` | LED flash period in milliseconds |

### Server (`server.js`)

| Constant | Default | Description |
|---|---|---|
| Port | `5000` | HTTP and WebSocket listen port |
| DB file | `./warehouse_management.db` | SQLite database path |

### Dashboard (`src/App.js`)

| Constant | Default | Description |
|---|---|---|
| `API` | `http://localhost:5000/api` | Base URL for all REST calls |

---

## 10. Design Decisions & Trade-offs

**Single WebSocket connection to hardware.** The server holds only the last-connected WebSocket client in `esp32Client`. This is intentional for a single-PCB deployment: there is exactly one piece of hardware, so multi-client management would add complexity without benefit. A `null` guard prevents crashes when no hardware is connected.

**32-bit bitmask as the LED control primitive.** Using a bitmask allows the server to address any subset of the 32 LEDs in a single message. While the current REST API triggers one LED per call, the protocol is forward-compatible with group operations (e.g., lighting all LEDs in a zone simultaneously) without any firmware changes.

**JavaScript signed-integer overflow for LED 31.** JavaScript's `<<` operator works on signed 32-bit integers. `1 << 31` equals `−2147483648`. Rather than working around this in the server (e.g., using BigInt or unsigned right-shift `>>>`), the firmware handles it by casting to `uint32_t`, keeping the server code simple.

**Optimistic UI updates.** The dashboard updates component state before the HTTP response arrives, making the interface feel instantaneous on a LAN. If the server returns an error (e.g., insufficient stock), the inventory is re-fetched to restore ground truth. This is the standard pattern for high-responsiveness web UIs.

**SQLite over a full RDBMS.** SQLite is embedded, requires no server process, and has zero configuration. For a small-scale warehouse installation with 32 slots and modest transaction volume, SQLite is the appropriate choice. The schema is easily migrated to PostgreSQL or MySQL if multi-server or multi-user concurrency becomes a requirement.

**PlatformIO over bare ESP-IDF.** The Arduino framework within PlatformIO provides a battle-tested abstraction over the hardware peripherals (SPI, WiFi, Serial), substantially reducing boilerplate and development time, while the `platformio.ini` and `CMakeLists.txt` files together ensure the project can also be built with the native ESP-IDF toolchain if deeper hardware access is needed.

---

## 11. Glossary

| Term | Definition |
|---|---|
| **BMS** | Bin Management System — software for tracking the contents and locations of storage bins |
| **Pick-to-Light** | An operator guidance system where an LED signals which bin to retrieve items from |
| **Put-to-Light** | An operator guidance system where an LED signals which bin to place items into |
| **TPIC6B595N** | Texas Instruments 8-bit power shift register with open-drain DMOS outputs |
| **SPI** | Serial Peripheral Interface — synchronous serial communication bus (MOSI, MISO, SCLK, CS) |
| **Daisy chain** | A wiring topology in which the serial output of one chip feeds the serial input of the next |
| **Bitmask** | An integer in which individual bits represent Boolean flags; here, bit N = LED N |
| **Open-drain** | Output transistor topology where the output is either pulled low (sinking current) or floating (high-impedance); external pull-up or LED + resistor to supply completes the circuit |
| **RCK** | Register Clock — the TPIC6B595N pin whose rising edge transfers data from the shift register to the output (storage) register |
| **SRCLR** | Shift Register Clear — active-LOW pin that resets the TPIC6B595N shift register to all zeros |
| **G̅** | Output Enable — active-LOW pin that enables or tri-states the TPIC6B595N output drains |
| **WebSocket** | Full-duplex TCP-based application-layer protocol (RFC 6455) enabling bidirectional real-time messaging between a server and a client |
| **SQLite** | A self-contained, serverless, zero-configuration relational database engine embedded in the application process |
| **SKU** | Stock-Keeping Unit — a unique alphanumeric code identifying a specific item |
| **CRA** | Create React App — the official React scaffolding and build toolchain |
| **PlatformIO** | Cross-platform build system and library manager for embedded development |
| **ESP-IDF** | Espressif IoT Development Framework — the official low-level SDK for ESP32 |
