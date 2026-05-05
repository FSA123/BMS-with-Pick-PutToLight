import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

// REACT_APP_SERVER_URL is set in dashboard/.env (or .env.local for per-machine overrides).
// Default to localhost so the app works out-of-the-box without any config.
const SERVER = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
const API    = `${SERVER}/api`;
// Derive WebSocket URL from the server URL: http→ws, https→wss, append /browser path.
const WS_URL = SERVER.replace(/^http/, 'ws') + '/browser';

const ZONES = {
  A: { label: 'Zone A', color: '#3b82f6' },
  B: { label: 'Zone B', color: '#10b981' },
  C: { label: 'Zone C', color: '#f59e0b' },
  D: { label: 'Zone D', color: '#ef4444' },
  E: { label: 'Zone E', color: '#8b5cf6' },
  F: { label: 'Zone F', color: '#ec4899' },
};

const isSlotEmpty = (item) => item.sku?.startsWith('EMPTY-');

const defaultPos = (id) => ({
  x: 3 + (id % 8) * 12,
  y: 8 + Math.floor(id / 8) * 22,
});

const getPos = (item) =>
  item.x != null && item.y != null ? { x: item.x, y: item.y } : defaultPos(item.id);

function App() {
  const [inventory, setInventory]         = useState([]);
  const [isEditMode, setIsEditMode]       = useState(false);
  const [selectedSlot, setSelectedSlot]   = useState(null);
  const [isEditing, setIsEditing]         = useState(false);
  const [formData, setFormData]           = useState({ name: '', sku: '', quantity: 0 });
  const [activePickId, setActivePickId]   = useState(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [esp32Online, setEsp32Online]     = useState(false); // real hardware status from server
  const [queueLength, setQueueLength]    = useState(0);     // pending LED actions waiting in queue
  const [activeId,    setActiveId]       = useState(null);  // slot currently lit on hardware

  // custom quantity state
  const [customQtyOpen, setCustomQtyOpen] = useState(false);
  const [customQty,     setCustomQty]     = useState('');
  const [pickError,     setPickError]     = useState('');

  const inventoryRef = useRef([]);
  const mapRef       = useRef(null);
  const customQtyRef = useRef(null);
  const wsRef        = useRef(null);  // persistent WebSocket reference

  // ── WebSocket connection to server ──────────────────────────────────────────
  // Opened once on mount; server pushes inventory updates and ESP32 status.
  // Reconnects automatically if the tab loses the connection.
  useEffect(() => {
    let reconnectTimer = null;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => console.log('[WS] Connected to server.');

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'inventory_update') {
          // A slot changed — update just that row without re-fetching everything.
          setInventory(prev => prev.map(s => s.id === msg.slot.id ? msg.slot : s));
          setSelectedSlot(prev => prev?.id === msg.slot.id ? msg.slot : prev);

        } else if (msg.type === 'esp32_status') {
          setEsp32Online(msg.connected);
          console.log(`[WS] ESP32 ${msg.connected ? 'ONLINE' : 'OFFLINE'}`);

        } else if (msg.type === 'queue_update') {
          // Server queue changed — update the counter and highlight the active slot.
          setQueueLength(msg.queueLength);
          setActiveId(msg.activeId ?? null);

        } else if (msg.type === 'led_cleared') {
          // A physical button was pressed on the hardware, clearing a LED.
          console.log(`[WS] LED ${msg.id} cleared by physical button.`);
          if (activePickId === msg.id) setActivePickId(null);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected — retrying in 3 s...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();  // triggers onclose which handles retry
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchInventory(); }, []);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);

  // reset custom qty state whenever the selected slot changes
  useEffect(() => {
    setCustomQtyOpen(false);
    setCustomQty('');
    setPickError('');
  }, [selectedSlot?.id]);

  // focus the custom qty input when it opens
  useEffect(() => {
    if (customQtyOpen && customQtyRef.current) customQtyRef.current.focus();
  }, [customQtyOpen]);

  const fetchInventory = async () => {
    try {
      const res = await axios.get(`${API}/inventory`);
      setInventory(res.data);
      setSelectedSlot(prev =>
        prev ? res.data.find(s => s.id === prev.id) ?? prev : null
      );
    } catch {
      console.error('Failed to reach backend.');
    }
  };

  // ── DRAG ──────────────────────────────────────────────────────────────────
  const handleSlotMouseDown = (e, item) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();

    const map = mapRef.current;
    if (!map) return;
    const rect = map.getBoundingClientRect();
    const orig = getPos(item);

    const state = {
      id: item.id,
      startX: e.clientX, startY: e.clientY,
      origX: orig.x,     origY: orig.y,
      mapW: rect.width,  mapH: rect.height,
      curX: orig.x,      curY: orig.y,
    };

    const onMove = (ev) => {
      const dx = ((ev.clientX - state.startX) / state.mapW) * 100;
      const dy = ((ev.clientY - state.startY) / state.mapH) * 100;
      state.curX = Math.max(0, Math.min(91, state.origX + dx));
      state.curY = Math.max(0, Math.min(88, state.origY + dy));
      setInventory(prev =>
        prev.map(s => s.id === state.id ? { ...s, x: state.curX, y: state.curY } : s)
      );
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const movedPx = Math.hypot(
        (state.curX - state.origX) * state.mapW / 100,
        (state.curY - state.origY) * state.mapH / 100
      );

      if (movedPx < 5) {
        const latest = inventoryRef.current.find(s => s.id === state.id) ?? item;
        setSelectedSlot(latest);
        setFormData({ name: latest.name, sku: latest.sku, quantity: latest.quantity });
        setIsEditing(isSlotEmpty(latest));
      } else {
        const latest = inventoryRef.current.find(s => s.id === state.id);
        axios.post(`${API}/slots/position`, {
          id: state.id, x: state.curX, y: state.curY, zone: latest?.zone || 'A',
        }).catch(console.error);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── ZONE ──────────────────────────────────────────────────────────────────
  const handleZoneChange = (id, zone) => {
    const item = inventoryRef.current.find(s => s.id === id);
    const pos  = getPos(item);
    setInventory(prev => prev.map(s => s.id === id ? { ...s, zone } : s));
    axios.post(`${API}/slots/position`, { id, x: pos.x, y: pos.y, zone }).catch(console.error);
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleSaveObject = async (e) => {
    e.preventDefault();
    const name = formData.name.trim();
    if (!name) { alert('Name is required.'); return; }
    const sku = formData.sku.trim() || `SKU-${selectedSlot.id}`;
    try {
      await axios.post(`${API}/slots/update`, {
        id: selectedSlot.id, name, sku, quantity: Number(formData.quantity),
      });
      setIsEditing(false);
      await fetchInventory();
    } catch (err) {
      alert(err?.response?.data?.error || 'Save failed.');
    }
  };

  const handleRemoveObject = async (id) => {
    if (!window.confirm(`Reset Slot ${id} to empty?`)) return;
    try {
      await axios.post(`${API}/slots/remove`, { id });
      await fetchInventory();
      setSelectedSlot(null);
    } catch {
      alert('Remove failed.');
    }
  };

  // ── SINGLE PICK / PUT ─────────────────────────────────────────────────────
  const handleAction = async (id, type) => {
    const target = inventoryRef.current.find(s => s.id === id);
    if (!target) return;
    if (type === 'PICK' && target.quantity <= 0) { alert('Slot is empty.'); return; }
    const next = target.quantity + (type === 'PICK' ? -1 : 1);
    setInventory(prev => prev.map(s => s.id === id ? { ...s, quantity: next } : s));
    setSelectedSlot(prev => prev?.id === id ? { ...prev, quantity: next } : prev);
    try {
      await axios.post(`${API}/action`, { id, type });
      if (type === 'PICK') {
        setActivePickId(id);
        setTimeout(() => setActivePickId(null), 4000);
      }
    } catch {
      await fetchInventory();
      alert('Action failed. Inventory refreshed.');
    }
  };

  // ── CLEAR LED ────────────────────────────────────────────────────────────
  const handleClearLed = async (id) => {
    setActivePickId(null);
    try {
      await axios.post(`${API}/action/clear`, { id });
    } catch {
      console.error('Clear LED failed.');
    }
  };

  // ── BULK PICK / PUT ───────────────────────────────────────────────────────
  const handleBulkAction = async (type) => {
    const qty    = parseInt(customQty, 10);
    const target = inventoryRef.current.find(s => s.id === selectedSlot?.id);
    if (!target) return;
    if (!qty || qty <= 0) {
      setPickError('Enter a quantity greater than 0.');
      return;
    }
    if (type === 'PICK' && qty > target.quantity) {
      setPickError(`Only ${target.quantity} in stock — cannot pick ${qty}.`);
      return;
    }
    setPickError('');
    const change = type === 'PICK' ? -qty : qty;
    const next   = target.quantity + change;
    setInventory(prev => prev.map(s => s.id === target.id ? { ...s, quantity: next } : s));
    setSelectedSlot(prev => prev?.id === target.id ? { ...prev, quantity: next } : prev);
    try {
      await axios.post(`${API}/action/bulk`, { id: target.id, type, quantity: qty });
      if (type === 'PICK') {
        setActivePickId(target.id);
        setTimeout(() => setActivePickId(null), 4000);
      }
      setCustomQtyOpen(false);
      setCustomQty('');
    } catch (err) {
      await fetchInventory();
      setPickError(err?.response?.data?.error || 'Action failed.');
    }
  };

  const enterEditMode = () => { setIsEditMode(true);  setSelectedSlot(null); setIsEditing(false); };
  const exitEditMode  = () => { setIsEditMode(false); setSelectedSlot(null); };

  // ── FILTER ─────────────────────────────────────────────────────────────────
  const q = searchQuery.toLowerCase();
  const filteredIds = q
    ? new Set(inventory.filter(s =>
        s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)
      ).map(s => s.id))
    : null;

  return (
    <div className="app">

      {/* ── TOP BAR ── */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <svg className="brand-icon" viewBox="0 0 24 24" fill="none">
              <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <circle cx="12" cy="12" r="3" fill="currentColor"/>
            </svg>
            PICK·LIGHT
          </div>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input
              className="search-input"
              type="text"
              placeholder="Search name or SKU…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>
        </div>

        <div className="topbar-right">
          {/* Real-time ESP32 connection status — green when hardware is live, red when not */}
          <div className={`sys-status ${esp32Online ? '' : 'sys-status--offline'}`}>
            <span className="pulse-dot" />
            {esp32Online ? 'ESP32 ONLINE' : 'ESP32 OFFLINE'}
          </div>

          {/* Queue counter — only visible when there are pending or active actions */}
          {(queueLength > 0 || activeId !== null) && (
            <div className="queue-badge" title="LED actions pending">
              <span className="queue-badge__icon">▶</span>
              {activeId !== null ? `Slot #${activeId} active` : ''}
              {queueLength > 0 ? `  +${queueLength} in queue` : ''}
            </div>
          )}
          <button
            className={`mode-btn ${isEditMode ? 'mode-btn--active' : ''}`}
            onClick={isEditMode ? exitEditMode : enterEditMode}
          >
            {isEditMode
              ? <><span className="mode-btn-icon">✓</span> Done Editing</>
              : <><span className="mode-btn-icon">⊹</span> Edit Layout</>}
          </button>
        </div>
      </header>

      {/* ── WORKSPACE ── */}
      <div className="workspace">

        {/* ── FLOOR MAP ── */}
        <div
          className={`floor-map ${isEditMode ? 'floor-map--edit' : ''}`}
          ref={mapRef}
        >
          <div className="zone-legend">
            {Object.entries(ZONES).map(([key, z]) => (
              <div key={key} className="zone-legend-item">
                <span className="zone-dot" style={{ background: z.color }} />
                {z.label}
              </div>
            ))}
          </div>

          {isEditMode && (
            <div className="edit-hint">
              Drag bins to reposition · tap colour pips to assign zones
            </div>
          )}

          {inventory.map(item => {
            const pos      = getPos(item);
            const empty    = isSlotEmpty(item);
            const zone     = item.zone || 'A';
            const zColor   = ZONES[zone]?.color ?? ZONES.A.color;
            const isPick   = activePickId === item.id;
            const isSel    = selectedSlot?.id === item.id;
            const isDimmed = filteredIds && !filteredIds.has(item.id);
            const isHidden = empty && !isEditMode;

            // Low stock: quantity is low but not zero. Out of stock: quantity is 0 on an assigned slot.
            const threshold  = item.min_threshold ?? 5;
            const isLowStock = !empty && item.quantity > 0 && item.quantity <= threshold;
            const isOutStock = !empty && item.quantity === 0;

            return (
              <div
                key={item.id}
                className={[
                  'slot-card',
                  empty      ? 'slot-card--empty'    : 'slot-card--occupied',
                  isPick     ? 'slot-card--pick'     : '',
                  isSel      ? 'slot-card--selected' : '',
                  isDimmed   ? 'slot-card--dimmed'   : '',
                  isEditMode ? 'slot-card--drag'     : '',
                  isHidden   ? 'slot-card--hidden'   : '',
                  isLowStock ? 'slot-card--lowstock' : '',
                  isOutStock ? 'slot-card--outstock' : '',
                ].join(' ')}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, '--zc': zColor, '--zc40': zColor + '40' }}
                onMouseDown={e => handleSlotMouseDown(e, item)}
                onClick={() => {
                  if (isEditMode) return;
                  setSelectedSlot(item);
                  setFormData({ name: item.name, sku: item.sku, quantity: item.quantity });
                  setIsEditing(false);
                }}
              >
                <div className="slot-accent" style={{ background: zColor }} />
                <div className="slot-id">#{item.id}</div>
                <div className="slot-name">{empty ? 'EMPTY' : item.name}</div>
                {!empty && <div className="slot-qty" style={{ color: zColor }}>{item.quantity}</div>}

                {/* Low stock / out of stock badge — shown in ops mode only */}
                {!isEditMode && isLowStock && (
                  <div className="stock-badge stock-badge--low" title={`Low stock (min: ${threshold})`}>!</div>
                )}
                {!isEditMode && isOutStock && (
                  <div className="stock-badge stock-badge--out" title="Out of stock">0</div>
                )}

                {isEditMode && (
                  <div className="zone-picker" onClick={e => e.stopPropagation()}>
                    {Object.entries(ZONES).map(([key, z]) => (
                      <button
                        key={key}
                        className={`zpip ${zone === key ? 'zpip--on' : ''}`}
                        style={{ background: z.color }}
                        title={z.label}
                        onClick={() => handleZoneChange(item.id, key)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── SIDE PANEL ── */}
        {selectedSlot && (() => {
          const slot   = selectedSlot;
          const zone   = slot.zone || 'A';
          const zColor = ZONES[zone]?.color ?? ZONES.A.color;
          const empty  = isSlotEmpty(slot);
          const threshold  = slot.min_threshold ?? 5;
          const isLowStock = !empty && slot.quantity > 0 && slot.quantity <= threshold;
          const isOutStock = !empty && slot.quantity === 0;
          return (
            <aside className="side-panel" key={slot.id}>
              <div className="panel-top">
                <div>
                  <div className="panel-id">Slot #{slot.id}</div>
                  <div className="panel-zone" style={{ background: zColor + '28', color: zColor, border: `1px solid ${zColor}55` }}>
                    {ZONES[zone]?.label}
                  </div>
                </div>
                <button className="panel-close" onClick={() => { setSelectedSlot(null); setIsEditing(false); }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                  </svg>
                </button>
              </div>

              {!isEditing ? (
                <>
                  <div className="pstat">
                    <div className="pstat-label">OBJECT</div>
                    <div className="pstat-val">{slot.name}</div>
                  </div>
                  <div className="pstat">
                    <div className="pstat-label">SKU</div>
                    <div className="pstat-val pstat-val--mono">{slot.sku}</div>
                  </div>
                  <div className="pstat">
                    <div className="pstat-label">QUANTITY</div>
                    <div className="pstat-val pstat-val--big" style={{ color: zColor }}>{slot.quantity}</div>
                    {/* Low / out-of-stock warning inline in the panel */}
                    {isLowStock && (
                      <div className="panel-stock-warn panel-stock-warn--low">
                        Low stock — below minimum threshold of {threshold}
                      </div>
                    )}
                    {isOutStock && (
                      <div className="panel-stock-warn panel-stock-warn--out">
                        Out of stock
                      </div>
                    )}
                  </div>

                  {/* PICK / PUT + custom pick — ops mode only */}
                  {!isEditMode && (
                    <>
                      <div className="panel-actions">
                        <button className="act-btn act-btn--pick" onClick={() => handleAction(slot.id, 'PICK')}>
                          <svg viewBox="0 0 20 20" fill="currentColor" width="13"><path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/></svg>
                          PICK
                        </button>

                        <button
                          className={`custom-pick-btn ${customQtyOpen ? 'custom-pick-btn--open' : ''}`}
                          title="Pick custom quantity"
                          onClick={() => { setCustomQtyOpen(o => !o); setPickError(''); setCustomQty(''); }}
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z"/>
                          </svg>
                        </button>

                        <button className="act-btn act-btn--put" onClick={() => handleAction(slot.id, 'PUT')}>
                          <svg viewBox="0 0 20 20" fill="currentColor" width="13"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
                          PUT
                        </button>
                      </div>

                      <button className="act-btn act-btn--off" onClick={() => handleClearLed(slot.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                          <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
                        </svg>
                        LED OFF
                      </button>

                      {customQtyOpen && (
                        <div className="custom-pick-form">
                          <div className="cpf-label">Custom quantity</div>
                          <div className="cpf-row">
                            <input
                              ref={customQtyRef}
                              className="cpf-input"
                              type="number"
                              min="1"
                              placeholder="0"
                              value={customQty}
                              onChange={e => { setCustomQty(e.target.value); setPickError(''); }}
                              onKeyDown={e => e.key === 'Enter' && handleBulkAction('PICK')}
                            />
                            <button className="cpf-cancel" onClick={() => { setCustomQtyOpen(false); setPickError(''); }}>
                              ✕
                            </button>
                          </div>
                          <div className="cpf-actions">
                            <button className="cpf-pick" onClick={() => handleBulkAction('PICK')}>
                              − PICK {customQty || 'N'}
                            </button>
                            <button className="cpf-put" onClick={() => handleBulkAction('PUT')}>
                              + PUT {customQty || 'N'}
                            </button>
                          </div>
                          {pickError && (
                            <div className="pick-error">
                              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                              </svg>
                              {pickError}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <div className="panel-divider" />

                  <div className="panel-mgmt">
                    <button className="mgmt-btn" onClick={() => setIsEditing(true)}>
                      {empty ? 'Add Object' : 'Edit Object'}
                    </button>
                    {!empty && (
                      <button className="mgmt-btn mgmt-btn--danger" onClick={() => handleRemoveObject(slot.id)}>
                        Remove Object
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <form className="edit-form" onSubmit={handleSaveObject}>
                  <div className="fgroup">
                    <label>Object Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. M8 Bolts"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="fgroup">
                    <label>SKU <span className="flabel-hint">— optional</span></label>
                    <input
                      type="text"
                      value={formData.sku}
                      onChange={e => setFormData({ ...formData, sku: e.target.value })}
                      placeholder={`SKU-${slot.id}`}
                    />
                  </div>
                  <div className="fgroup">
                    <label>Quantity</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.quantity}
                      onChange={e => setFormData({ ...formData, quantity: Math.max(0, parseInt(e.target.value) || 0) })}
                      required
                    />
                  </div>
                  <div className="form-btns">
                    <button type="submit" className="act-btn act-btn--save" style={{ '--zc': zColor }}>Save</button>
                    <button type="button" className="mgmt-btn" onClick={() => setIsEditing(false)}>Cancel</button>
                  </div>
                </form>
              )}
            </aside>
          );
        })()}
      </div>
    </div>
  );
}

export default App;
