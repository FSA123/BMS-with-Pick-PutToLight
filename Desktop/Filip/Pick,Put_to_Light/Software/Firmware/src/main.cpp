/*
 * Pick/Put-to-Light Firmware
 * ESP32 + 4x TPIC6B595 daisy-chained shift registers = 32 LED outputs
 *
 * Daisy-chain order: ESP32 SPI -> Chip1.SER_IN -> Chip1.SER_OUT -> Chip2.SER_IN -> ... -> Chip4
 * LED mapping: LED 0-7 = Chip1, LED 8-15 = Chip2, LED 16-23 = Chip3, LED 24-31 = Chip4
 *
 * LED behaviour:
 *   PUT action  -> LED turns ON solid
 *   PICK action -> LED flashes at 350 ms interval
 *
 * Communication: ESP32 connects to the Node.js server as a WebSocket client.
 * Server sends JSON:  { "mask": <uint32_bitmask>, "action": "PUT" | "PICK" }
 * where bit N of mask = LED N.
 */

#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ─── USER CONFIGURATION ──────────────────────────────────────────────────────
// TODO: Replace with your actual WiFi network name and password.
#define WIFI_SSID    "Filip"
#define WIFI_PASS    "12345678"

// TODO: Replace with the IP address of the PC running the Node.js server.
//       Open a terminal on that PC and run "ipconfig" (Windows) or "ip a" (Linux)
//       to find the IPv4 address on your local network (e.g. 192.168.1.100).
#define SERVER_IP    "172.20.10.2"
#define SERVER_PORT  5000
// ─────────────────────────────────────────────────────────────────────────────

// ─── TPIC6B595 SHIFT REGISTER PINS ───────────────────────────────────────────
#define PIN_SRCLK   18   // SPI clock (SRCLK on chip)
#define PIN_SER_IN  23   // SPI MOSI data (SER IN on chip 1)
#define PIN_RCK      5   // Storage/latch clock: rising edge copies shift reg → output reg
#define PIN_SRCLR   21   // Shift register clear, active LOW — keep HIGH to hold data
#define PIN_G       19   // Output enable, active LOW — keep LOW to enable drain outputs
// ─────────────────────────────────────────────────────────────────────────────

#define NUM_CHIPS        4          // 4 TPIC6B595 chips in the daisy chain
#define NUM_LEDS         (NUM_CHIPS * 8)  // 32 LEDs total (8 drains per chip)
#define FLASH_INTERVAL   350        // milliseconds between flash ON/OFF toggles

// ─── PHYSICAL BUTTON ─────────────────────────────────────────────────────────
// One button for all bins. Wired between GPIO 4 and GND.
// INPUT_PULLUP: pin reads HIGH at rest, LOW when pressed.
// Pressing it tells the server to clear the active LED and advance the queue.
#define PIN_BUTTON   4
#define DEBOUNCE_MS  50

bool          lastBtnState  = HIGH;
unsigned long lastBtnChange = 0;
// ─────────────────────────────────────────────────────────────────────────────

// ─── LED STATE ────────────────────────────────────────────────────────────────
// We track two independent bitmasks across the 32 LEDs.
// A given LED should only be in one mask at a time.
uint32_t solidMask = 0;   // bit N set → LED N is permanently ON  (PUT)
uint32_t flashMask = 0;   // bit N set → LED N is flashing         (PICK)

// Flash timing — uses millis() so the main loop is never blocked.
bool          flashPhase    = false;  // true = flash LEDs currently ON, false = OFF
unsigned long lastFlashTick = 0;

// Cache of the last value written to hardware; avoids redundant SPI transfers.
uint32_t lastActiveMask = 0xFFFFFFFF;  // impossible init value forces a write on first loop
// ─────────────────────────────────────────────────────────────────────────────

WebSocketsClient ws;

// ─── HARDWARE FUNCTIONS ───────────────────────────────────────────────────────

/*
 * Sends `count` bytes to the shift-register chain over SPI, then pulses the
 * latch (RCK) so the new data appears on the output drains.
 *
 * Shift-register physics: the FIRST byte clocked in shifts all the way to the
 * LAST chip in the chain. So we send data[NUM_CHIPS-1] first (→ Chip4) and
 * data[0] last (→ Chip1), which keeps the array indexed as chip 1..N = [0..N-1].
 */
void writeRegisters(const uint8_t* data, uint8_t count) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    for (int i = count - 1; i >= 0; i--) {
        SPI.transfer(data[i]);  // data[3] → Chip4, data[0] → Chip1
    }
    SPI.endTransaction();

    // Rising edge on RCK latches the shift registers into the output registers.
    // 1 µs pulse is well above the TPIC6B595's 20 ns minimum requirement.
    digitalWrite(PIN_RCK, HIGH);
    delayMicroseconds(1);
    digitalWrite(PIN_RCK, LOW);
}

/*
 * Converts a 32-bit LED bitmask into 4 bytes (one per chip) and drives the
 * shift registers. Called only when the mask actually changes to avoid
 * unnecessary SPI traffic.
 *
 * Bit layout:  bits  0- 7 → data[0] → Chip1 (LEDs  0- 7)
 *              bits  8-15 → data[1] → Chip2 (LEDs  8-15)
 *              bits 16-23 → data[2] → Chip3 (LEDs 16-23)
 *              bits 24-31 → data[3] → Chip4 (LEDs 24-31)
 */
void applyLEDs(uint32_t activeMask) {
    uint8_t data[NUM_CHIPS];
    for (int i = 0; i < NUM_CHIPS; i++) {
        data[i] = (uint8_t)((activeMask >> (i * 8)) & 0xFF);
    }
    writeRegisters(data, NUM_CHIPS);
}

// ─── WEBSOCKET EVENT HANDLER ──────────────────────────────────────────────────

/*
 * Called by the WebSocketsClient library for every connection event or
 * incoming message. Runs in the same task as loop() — no RTOS concerns.
 */
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {

        case WStype_DISCONNECTED:
            Serial.println("[WS] Disconnected from server — will retry every 3 s...");
            break;

        case WStype_CONNECTED:
            Serial.println("[WS] Connected to server!");
            Serial.println("[WS] Waiting for PUT / PICK commands...");
            break;

        case WStype_TEXT: {
            /*
             * Two message types arrive from the server:
             *
             * 1. LED command:  { "mask": <uint32>, "action": "PUT" | "PICK" | "OFF" }
             *    mask has exactly one bit set (bit N = LED N).
             *    Server normalises mask with >>> 0, so it is always a positive uint32 in JSON.
             *
             * 2. State sync:   { "type": "sync", "solid": <uint32>, "flash": <uint32> }
             *    Sent immediately after connect/reconnect so LED state is restored
             *    after a reboot without any operator intervention.
             */
            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, payload, length);
            if (err) {
                Serial.printf("[WS] JSON parse error: %s\n", err.c_str());
                break;
            }

            // ── State sync message ──────────────────────────────────────────
            const char* msgType = doc["type"] | "";
            if (strcmp(msgType, "sync") == 0) {
                solidMask = doc["solid"].as<uint32_t>();
                flashMask = doc["flash"].as<uint32_t>();
                Serial.printf("[WS] State sync → solidMask=0x%08X  flashMask=0x%08X\n",
                              solidMask, flashMask);
                break;
            }

            // ── LED command message ─────────────────────────────────────────
            // Server normalises mask with >>> 0 so it arrives as a positive uint32.
            uint32_t    mask   = doc["mask"].as<uint32_t>();
            const char* action = doc["action"] | "";

            if (mask == 0 || strlen(action) == 0) {
                Serial.println("[WS] Received invalid payload (mask=0 or missing action).");
                break;
            }

            // Resolve the LED index from the single-bit mask for the debug log.
            int ledIndex = -1;
            for (int i = 0; i < NUM_LEDS; i++) {
                if (mask == (1UL << i)) { ledIndex = i; break; }
            }
            if (ledIndex < 0) {
                Serial.printf("[WS] Unknown mask value: 0x%08X — ignoring.\n", mask);
                break;
            }

            if (strcmp(action, "PUT") == 0) {
                // PUT: LED goes solid ON; remove from flash mode if it was flashing.
                solidMask |=  mask;
                flashMask &= ~mask;
                Serial.printf("[WS] PUT  → LED %2d solid ON   "
                              "(solidMask=0x%08X  flashMask=0x%08X)\n",
                              ledIndex, solidMask, flashMask);

            } else if (strcmp(action, "PICK") == 0) {
                // PICK: LED starts flashing; remove from solid mode if it was solid.
                flashMask |=  mask;
                solidMask &= ~mask;
                Serial.printf("[WS] PICK → LED %2d flashing   "
                              "(solidMask=0x%08X  flashMask=0x%08X)\n",
                              ledIndex, solidMask, flashMask);

            } else if (strcmp(action, "OFF") == 0) {
                // OFF: LED turns off completely — sent by "LED OFF" button or physical button.
                solidMask &= ~mask;
                flashMask &= ~mask;
                Serial.printf("[WS] OFF  → LED %2d off        "
                              "(solidMask=0x%08X  flashMask=0x%08X)\n",
                              ledIndex, solidMask, flashMask);

            } else {
                Serial.printf("[WS] Unknown action '%s' — ignoring.\n", action);
            }
            break;
        }

        case WStype_ERROR:
            Serial.println("[WS] WebSocket error.");
            break;

        default:
            break;
    }
}

// ─── SETUP ────────────────────────────────────────────────────────────────────

void setup() {
    // RX disabled (-1) so GPIO3 is freed from UART; TX still works for debug output.
    Serial.begin(115200, SERIAL_8N1, -1, 1);
    delay(500);
    Serial.println("\n===========================================");
    Serial.println("  Pick/Put-to-Light — Firmware Starting");
    Serial.println("===========================================");

    // Blink the onboard LED 3 times to confirm the firmware is running.
    pinMode(2, OUTPUT);
    for (int i = 0; i < 3; i++) {
        digitalWrite(2, HIGH); delay(200);
        digitalWrite(2, LOW);  delay(200);
    }

    // ── Shift register GPIO init ──
    pinMode(PIN_RCK,   OUTPUT);
    pinMode(PIN_SRCLR, OUTPUT);
    pinMode(PIN_G,     OUTPUT);
    pinMode(3,         OUTPUT);  // GPIO3 freed from UART RX; driven HIGH to reinforce SRCLR

    digitalWrite(PIN_RCK,   LOW);
    digitalWrite(PIN_SRCLR, HIGH);  // HIGH = do NOT clear shift registers
    digitalWrite(3,         HIGH);  // extra driver for SRCLR line
    digitalWrite(PIN_G,     LOW);   // LOW = outputs enabled (active-LOW pin)

    SPI.begin(PIN_SRCLK, /*MISO=*/-1, PIN_SER_IN, /*CS=*/-1);

    // ── Button GPIO init ──
    pinMode(PIN_BUTTON, INPUT_PULLUP);  // internal pull-up; button connects pin to GND
    Serial.printf("[HW] Button configured on GPIO %d.\n", PIN_BUTTON);

    // Turn all 32 LEDs off on startup.
    applyLEDs(0x00000000);
    lastActiveMask = 0x00000000;
    Serial.println("[HW] Shift registers initialised — all LEDs OFF.");
    Serial.printf("[HW] %d chips / %d LEDs configured.\n", NUM_CHIPS, NUM_LEDS);

    // ── Connect to WiFi ──
    Serial.printf("[WiFi] Connecting to SSID '%s'", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.printf("\n[WiFi] Connected! Local IP: %s\n", WiFi.localIP().toString().c_str());

    // ── Connect to WebSocket server ──
    Serial.printf("[WS] Connecting to ws://%s:%d ...\n", SERVER_IP, SERVER_PORT);
    // /esp32 path lets the server distinguish ESP32 from browser WebSocket clients.
    ws.begin(SERVER_IP, SERVER_PORT, "/esp32");
    ws.onEvent(onWebSocketEvent);
    ws.setReconnectInterval(3000);      // auto-reconnect after 3 s if disconnected
    ws.enableHeartbeat(15000, 3000, 2); // ping every 15 s; drop after 2 missed pongs

    Serial.println("[Setup] Done — entering main loop.");
}

// ─── LOOP ─────────────────────────────────────────────────────────────────────

void loop() {
    // Must be called every iteration to receive WebSocket messages and keep
    // the connection alive (handles pings, reconnects, etc.).
    ws.loop();

    // ── Physical button ──────────────────────────────────────────────────────
    // Detect a falling edge (HIGH → LOW) with software debounce.
    // On press: tell the server to clear the current LED and advance the queue.
    {
        bool btnNow = digitalRead(PIN_BUTTON);
        unsigned long now = millis();
        if (btnNow != lastBtnState && (now - lastBtnChange) > DEBOUNCE_MS) {
            lastBtnChange = now;
            lastBtnState  = btnNow;
            if (btnNow == LOW) {  // falling edge = button pressed
                ws.sendTXT("{\"type\":\"button_press\"}");
                Serial.println("[BTN] Pressed — sent to server.");
            }
        }
    }

    // ── Non-blocking flash timer ──
    // Every FLASH_INTERVAL ms, toggle the flash phase. flashPhase==true means
    // the flashing LEDs are currently in their ON half-cycle.
    unsigned long now = millis();
    if (now - lastFlashTick >= FLASH_INTERVAL) {
        lastFlashTick = now;
        flashPhase = !flashPhase;

        if (flashMask != 0) {
            Serial.printf("[Flash] %s  (flashMask=0x%08X)\n",
                flashPhase ? "ON " : "OFF", flashMask);
        }
    }

    // ── Compute which LEDs should be physically ON right now ──
    //   Solid LEDs:   always ON
    //   Flashing LEDs: ON only during the flashPhase==true half-cycle
    uint32_t activeMask = solidMask | (flashPhase ? flashMask : 0);

    // Only push data to the shift registers when the output actually changes.
    // This prevents constant SPI traffic and avoids any risk of visible flicker.
    if (activeMask != lastActiveMask) {
        lastActiveMask = activeMask;
        applyLEDs(activeMask);
    }
}
