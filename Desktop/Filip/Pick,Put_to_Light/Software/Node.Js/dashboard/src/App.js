import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

const SERVER = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
const API    = `${SERVER}/api`;
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
const defaultPos  = (id)   => ({ x: 3 + (id % 8) * 12, y: 8 + Math.floor(id / 8) * 22 });
const getPos      = (item) => item.x != null && item.y != null ? { x: item.x, y: item.y } : defaultPos(item.id);

// ── PRODUCTS & MOCK DATA ──────────────────────────────────────────────────────
const INITIAL_PRODUCTS = [
  {
    id: 'P001', name: 'Arduino Nano Clone', sku: 'PROD-001',
    bom: [
      { sku: 'IC-ATMEGA328', name: 'ATmega328P-PU MCU',        qty: 1 },
      { sku: 'XTAL-16M',     name: 'Crystal 16MHz HC-49/S',    qty: 1 },
      { sku: 'CAP-100N',     name: 'Cap MLCC 100nF 50V',       qty: 6 },
      { sku: 'CAP-10U16',    name: 'Cap Electrolytic 10µF 16V',qty: 2 },
      { sku: 'RES-10K',      name: 'Resistor 10kΩ 0.25W',      qty: 1 },
      { sku: 'RES-100R',     name: 'Resistor 100Ω 0.25W',      qty: 3 },
      { sku: 'D-1N4007',     name: 'Diode 1N4007 Rectifier',   qty: 1 },
      { sku: 'USB-C-SMD',    name: 'USB Type-C SMD 16P',        qty: 1 },
    ],
  },
  {
    id: 'P002', name: 'Motor Driver Board', sku: 'PROD-002',
    bom: [
      { sku: 'IC-L298N',     name: 'L298N Dual H-Bridge',        qty: 1 },
      { sku: 'CAP-100N',     name: 'Cap MLCC 100nF 50V',         qty: 4 },
      { sku: 'CAP-470U35',   name: 'Cap Electrolytic 470µF 35V', qty: 2 },
      { sku: 'D-1N4007',     name: 'Diode 1N4007 Rectifier',     qty: 4 },
      { sku: 'RES-010R',     name: 'Resistor 10Ω 0.25W',         qty: 2 },
      { sku: 'LED-RED5',     name: 'LED Red 5mm',                qty: 2 },
    ],
  },
  {
    id: 'P003', name: 'ESP32 IoT Node', sku: 'PROD-003',
    bom: [
      { sku: 'IC-ESP32',     name: 'ESP-WROOM-32 Module',        qty: 1 },
      { sku: 'CAP-100N',     name: 'Cap MLCC 100nF 50V',         qty: 4 },
      { sku: 'CAP-10U16',    name: 'Cap Electrolytic 10µF 16V',  qty: 2 },
      { sku: 'FB-600R',      name: 'Ferrite Bead 600Ω 0805',     qty: 4 },
      { sku: 'IC-AMS1117',   name: 'AMS1117-3.3 LDO Reg',        qty: 1 },
      { sku: 'USB-C-SMD',    name: 'USB Type-C SMD 16P',          qty: 1 },
    ],
  },
  {
    id: 'P004', name: 'Relay Control Board', sku: 'PROD-004',
    bom: [
      { sku: 'RLY-HE3621',   name: 'Relay 5V SPDT 10A',         qty: 1 },
      { sku: 'T-2N2222',     name: 'BJT NPN 2N2222A',            qty: 1 },
      { sku: 'RES-1K0',      name: 'Resistor 1kΩ 0.25W',         qty: 1 },
      { sku: 'D-1N4148',     name: 'Diode 1N4148 Signal',        qty: 1 },
      { sku: 'LED-RED5',     name: 'LED Red 5mm',                qty: 1 },
      { sku: 'BTN-6X6',      name: 'Tactile Button 6×6mm',       qty: 2 },
    ],
  },
  {
    id: 'P005', name: '5V Linear Power Supply', sku: 'PROD-005',
    bom: [
      { sku: 'D-1N4007',     name: 'Diode 1N4007 Rectifier',     qty: 4 },
      { sku: 'CAP-470U35',   name: 'Cap Electrolytic 470µF 35V', qty: 2 },
      { sku: 'CAP-100U25',   name: 'Cap Electrolytic 100µF 25V', qty: 2 },
      { sku: 'IC-AMS1117',   name: 'AMS1117-3.3 LDO Reg',        qty: 1 },
      { sku: 'RES-10K',      name: 'Resistor 10kΩ 0.25W',        qty: 2 },
      { sku: 'DC-21MM',      name: 'DC Barrel Jack 2.1mm',        qty: 1 },
    ],
  },
];

const MOCK_DETECTED = [
  { id: 1, name: 'Resistor 10kΩ 0.25W', sku: 'RES-10K',   qty: 5, confidence: 96 },
  { id: 2, name: 'Cap MLCC 100nF 50V',  sku: 'CAP-100N',  qty: 8, confidence: 91 },
  { id: 3, name: 'Diode 1N4148 Signal', sku: 'D-1N4148',  qty: 3, confidence: 88 },
];

// ── ICONS ─────────────────────────────────────────────────────────────────────
const IconPick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
    <path d="M9 11V6a3 3 0 0 1 6 0v5"/>
    <path d="M5 11h14l-1.5 8.5a2 2 0 0 1-2 1.5h-7a2 2 0 0 1-2-1.5Z"/>
    <path d="M9 11h6"/>
  </svg>
);

const IconPut = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const IconScan = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
    <path d="M3 9V6a3 3 0 0 1 3-3h3"/>
    <path d="M15 3h3a3 3 0 0 1 3 3v3"/>
    <path d="M21 15v3a3 3 0 0 1-3 3h-3"/>
    <path d="M9 21H6a3 3 0 0 1-3-3v-3"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const IconKitting = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/>
    <line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
);

const IconProducts = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

const IconActivity = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);

const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button className={`nav-btn${active ? ' nav-btn--active' : ''}`} onClick={onClick} title={label}>
      <Icon />
      <span className="nav-btn-label">{label}</span>
    </button>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
function App() {
  // existing state
  const [inventory, setInventory]         = useState([]);
  const [isEditMode, setIsEditMode]       = useState(false);
  const [selectedSlot, setSelectedSlot]   = useState(null);
  const [isEditing, setIsEditing]         = useState(false);
  const [formData, setFormData]           = useState({ name: '', sku: '', quantity: 0, description: '', datasheet_url: '', image_url: '', supplier_name: '', supplier_part: '', supplier_url: '' });
  const [activePickId, setActivePickId]   = useState(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [esp32Online, setEsp32Online]     = useState(false);
  const [queueLength, setQueueLength]     = useState(0);
  const [activeId, setActiveId]           = useState(null);
  const [customQtyOpen, setCustomQtyOpen] = useState(false);
  const [customQty, setCustomQty]         = useState('');
  const [pickError, setPickError]         = useState('');
  const [toasts, setToasts]               = useState([]);
  const toastIdRef                        = useRef(0);
  const [isDark, setIsDark]               = useState(true);

  // nav + feature panel state
  const [activePage, setActivePage]               = useState(null);
  const [pickSearch, setPickSearch]               = useState('');
  const [pickCart, setPickCart]                   = useState([]);
  const [putSearch, setPutSearch]                 = useState('');
  const [putCart, setPutCart]                     = useState([]);
  const [isScanning, setIsScanning]               = useState(false);
  const [detectedItems, setDetectedItems]         = useState([]);
  const [selectedKitProduct, setSelectedKitProduct] = useState(null);
  const [products, setProducts]                   = useState(INITIAL_PRODUCTS);
  const [editingProduct, setEditingProduct]       = useState(null);
  const [productForm, setProductForm]             = useState({ name: '', sku: '', bom: [] });
  const [activityLog, setActivityLog]             = useState([]);

  const inventoryRef = useRef([]);
  const mapRef       = useRef(null);
  const customQtyRef = useRef(null);
  const wsRef        = useRef(null);

  // ── WEBSOCKET ──────────────────────────────────────────────────────────────
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
          setInventory(prev => prev.map(s => s.id === msg.slot.id ? msg.slot : s));
          setSelectedSlot(prev => prev?.id === msg.slot.id ? msg.slot : prev);
        } else if (msg.type === 'esp32_status') {
          setEsp32Online(msg.connected);
          console.log(`[WS] ESP32 ${msg.connected ? 'ONLINE' : 'OFFLINE'}`);
        } else if (msg.type === 'queue_update') {
          setQueueLength(msg.queueLength);
          setActiveId(msg.activeId ?? null);
        } else if (msg.type === 'led_cleared') {
          console.log(`[WS] LED ${msg.id} cleared by physical button.`);
          if (activePickId === msg.id) setActivePickId(null);
        }
      };
      ws.onclose = () => {
        console.log('[WS] Disconnected — retrying in 3 s...');
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => { clearTimeout(reconnectTimer); wsRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchInventory(); }, []);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => { setCustomQtyOpen(false); setCustomQty(''); setPickError(''); }, [selectedSlot?.id]);
  useEffect(() => { if (customQtyOpen && customQtyRef.current) customQtyRef.current.focus(); }, [customQtyOpen]);

  // ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────
  // Store mutable values in refs so the handler never goes stale without re-subscribing
  const kbStateRef = useRef({});
  kbStateRef.current = { selectedSlot, activePage, isEditMode, isEditing };

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName.toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
      const { selectedSlot: sel, activePage: page, isEditMode: editMode, isEditing: editing } = kbStateRef.current;

      if (e.key === 'Escape') {
        if (editing) { setIsEditing(false); return; }
        if (sel)     { setSelectedSlot(null); return; }
        if (page)    { setActivePage(null); return; }
        if (editMode){ setIsEditMode(false); setSelectedSlot(null); return; }
        return;
      }
      if (inInput) return;
      if (e.key === '/' && !inInput) {
        e.preventDefault();
        document.querySelector('.search-input')?.focus();
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && sel && !editing && !editMode) {
        handleAction(sel.id, 'PICK');
      }
      if ((e.key === 'u' || e.key === 'U') && sel && !editing && !editMode) {
        handleAction(sel.id, 'PUT');
      }
      if ((e.key === 'e' || e.key === 'E') && !sel && !editing && !editMode) {
        enterEditMode();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FETCH ──────────────────────────────────────────────────────────────────
  const fetchInventory = async () => {
    try {
      const res = await axios.get(`${API}/inventory`);
      setInventory(res.data);
      setSelectedSlot(prev => prev ? res.data.find(s => s.id === prev.id) ?? prev : null);
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
      setInventory(prev => prev.map(s => s.id === state.id ? { ...s, x: state.curX, y: state.curY } : s));
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
        setFormData({ name: latest.name, sku: latest.sku, quantity: latest.quantity, description: latest.description || '', datasheet_url: latest.datasheet_url || '', image_url: latest.image_url || '', supplier_name: latest.supplier_name || '', supplier_part: latest.supplier_part || '', supplier_url: latest.supplier_url || '' });
        setIsEditing(isSlotEmpty(latest));
      } else {
        const latest = inventoryRef.current.find(s => s.id === state.id);
        axios.post(`${API}/slots/position`, { id: state.id, x: state.curX, y: state.curY, zone: latest?.zone || 'A' }).catch(console.error);
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
  const saveSlot = async () => {
    const name = formData.name.trim();
    if (!name) { addToast('Name is required.', 'error'); return false; }
    const sku = formData.sku.trim() || `SKU-${selectedSlot.id}`;
    try {
      await axios.post(`${API}/slots/update`, { id: selectedSlot.id, name, sku, quantity: Number(formData.quantity), description: formData.description.trim(), datasheet_url: formData.datasheet_url.trim(), image_url: formData.image_url.trim(), supplier_name: formData.supplier_name.trim(), supplier_part: formData.supplier_part.trim(), supplier_url: formData.supplier_url.trim() });
      setIsEditing(false);
      await fetchInventory();
      addToast(`Slot #${selectedSlot.id} saved.`);
      return true;
    } catch (err) {
      addToast(err?.response?.data?.error || 'Save failed.', 'error');
      return false;
    }
  };

  const handleSaveObject = async (e) => { e.preventDefault(); await saveSlot(); };

  const handleRemoveObject = async (id) => {
    if (!window.confirm(`Reset Slot ${id} to empty?`)) return;
    try {
      await axios.post(`${API}/slots/remove`, { id });
      await fetchInventory();
      setSelectedSlot(null);
      addToast(`Slot #${id} cleared.`);
    } catch { addToast('Remove failed.', 'error'); }
  };

  // ── SINGLE PICK / PUT ─────────────────────────────────────────────────────
  const handleAction = async (id, type) => {
    const target = inventoryRef.current.find(s => s.id === id);
    if (!target) return;
    if (type === 'PICK' && target.quantity <= 0) { addToast('Slot is empty — nothing to pick.', 'error'); return; }
    const next = target.quantity + (type === 'PICK' ? -1 : 1);
    setInventory(prev => prev.map(s => s.id === id ? { ...s, quantity: next } : s));
    setSelectedSlot(prev => prev?.id === id ? { ...prev, quantity: next } : prev);
    try {
      await axios.post(`${API}/action`, { id, type });
      logActivity(type, target, 1);
      if (type === 'PICK') { setActivePickId(id); setTimeout(() => setActivePickId(null), 4000); }
    } catch { await fetchInventory(); addToast('Action failed — inventory refreshed.', 'error'); }
  };

  const handleClearLed = async (id) => {
    setActivePickId(null);
    try { await axios.post(`${API}/action/clear`, { id }); } catch { console.error('Clear LED failed.'); }
  };

  // ── BULK PICK / PUT ───────────────────────────────────────────────────────
  const handleBulkAction = async (type) => {
    const qty    = parseInt(customQty, 10);
    const target = inventoryRef.current.find(s => s.id === selectedSlot?.id);
    if (!target) return;
    if (!qty || qty <= 0) { setPickError('Enter a quantity greater than 0.'); return; }
    if (type === 'PICK' && qty > target.quantity) { setPickError(`Only ${target.quantity} in stock — cannot pick ${qty}.`); return; }
    setPickError('');
    const next = target.quantity + (type === 'PICK' ? -qty : qty);
    setInventory(prev => prev.map(s => s.id === target.id ? { ...s, quantity: next } : s));
    setSelectedSlot(prev => prev?.id === target.id ? { ...prev, quantity: next } : prev);
    try {
      await axios.post(`${API}/action/bulk`, { id: target.id, type, quantity: qty });
      logActivity(type, target, qty);
      if (type === 'PICK') { setActivePickId(target.id); setTimeout(() => setActivePickId(null), 4000); }
      setCustomQtyOpen(false);
      setCustomQty('');
    } catch (err) { await fetchInventory(); setPickError(err?.response?.data?.error || 'Action failed.'); }
  };

  const enterEditMode = () => { setIsEditMode(true); setSelectedSlot(null); setIsEditing(false); };
  const exitEditMode  = async () => {
    if (isEditing) {
      if (formData.name.trim()) { const saved = await saveSlot(); if (!saved) return; }
      else { setIsEditing(false); }
    }
    setIsEditMode(false);
    setSelectedSlot(null);
  };

  // ── TOASTS ────────────────────────────────────────────────────────────────
  const addToast = (msg, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };

  // ── CSV ───────────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const cols = ['id','name','sku','quantity','zone','description','datasheet_url','image_url','supplier_name','supplier_part','supplier_url'];
    const esc  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = inventory
      .filter(s => !isSlotEmpty(s))
      .map(s => cols.map(c => esc(s[c])).join(','));
    const csv  = [cols.join(','), ...rows].join('\n');
    const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `inventory-${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
    addToast(`Exported ${rows.length} items to CSV`);
  };

  const importCSVRef = useRef(null);
  const handleImportCSV = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].match(/(".*?"|[^,]+)(?=,|$)/g) ?? [];
      const row  = Object.fromEntries(headers.map((h, j) => [h, (vals[j] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"')]));
      if (!row.name || !row.sku) continue;
      try {
        await axios.post(`${API}/slots/update`, { id: Number(row.id), name: row.name, sku: row.sku, quantity: Number(row.quantity) || 0, description: row.description || '', datasheet_url: row.datasheet_url || '', image_url: row.image_url || '', supplier_name: row.supplier_name || '', supplier_part: row.supplier_part || '', supplier_url: row.supplier_url || '' });
        count++;
      } catch { /* skip invalid rows */ }
    }
    await fetchInventory();
    addToast(`Imported ${count} item${count !== 1 ? 's' : ''} from CSV`);
  };

  const logActivity = (type, slot, qty) => {
    setActivityLog(prev => [{
      id: Date.now() + Math.random(),
      type, slotId: slot.id, name: slot.name, sku: slot.sku, qty,
      time: new Date(),
    }, ...prev].slice(0, 200));
  };

  // ── NAV HELPERS ───────────────────────────────────────────────────────────
  const togglePage = (page) => setActivePage(prev => prev === page ? null : page);

  const addToCart = (item, setCart) =>
    setCart(prev => prev.find(c => c.id === item.id)
      ? prev
      : [...prev, { id: item.id, name: item.name, sku: item.sku, qty: 1 }]);

  const removeFromCart = (id, setCart) => setCart(prev => prev.filter(c => c.id !== id));

  const updateCartQty = (id, delta, setCart) =>
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty: Math.max(1, c.qty + delta) } : c));

  const handleScan = () => {
    setIsScanning(true);
    setDetectedItems([]);
    setTimeout(() => { setIsScanning(false); setDetectedItems(MOCK_DETECTED); }, 2200);
  };

  // ── PRODUCT CRUD ──────────────────────────────────────────────────────────
  const handleNewProduct    = () => { setEditingProduct('new'); setProductForm({ name: '', sku: '', bom: [] }); };
  const handleEditProduct   = (p)  => { setEditingProduct(p.id); setProductForm({ name: p.name, sku: p.sku, bom: p.bom.map(b => ({ ...b })) }); };
  const handleDeleteProduct = (id) => setProducts(prev => prev.filter(p => p.id !== id));
  const handleSaveProduct   = () => {
    if (!productForm.name.trim()) return;
    if (editingProduct === 'new') setProducts(prev => [...prev, { id: `P${Date.now()}`, ...productForm }]);
    else setProducts(prev => prev.map(p => p.id === editingProduct ? { id: p.id, ...productForm } : p));
    setEditingProduct(null);
  };
  const addBomLine    = () => setProductForm(f => ({ ...f, bom: [...f.bom, { sku: '', name: '', qty: 1 }] }));
  const removeBomLine = (i) => setProductForm(f => ({ ...f, bom: f.bom.filter((_, idx) => idx !== i) }));
  const updateBomLine = (i, field, val) =>
    setProductForm(f => ({
      ...f,
      bom: f.bom.map((b, idx) => idx === i ? { ...b, [field]: field === 'qty' ? Math.max(1, parseInt(val) || 1) : val } : b),
    }));

  // ── FILTERS ───────────────────────────────────────────────────────────────
  const q           = searchQuery.toLowerCase();
  const filteredIds = q ? new Set(inventory.filter(s =>
    s.name.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q)
  ).map(s => s.id)) : null;

  const pickFiltered = inventory.filter(s => !isSlotEmpty(s) && (!pickSearch ||
    s.name.toLowerCase().includes(pickSearch.toLowerCase()) ||
    s.sku.toLowerCase().includes(pickSearch.toLowerCase())));
  const putFiltered  = inventory.filter(s => !isSlotEmpty(s) && (!putSearch ||
    s.name.toLowerCase().includes(putSearch.toLowerCase()) ||
    s.sku.toLowerCase().includes(putSearch.toLowerCase())));

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className={`app${isDark ? '' : ' theme-light'}`}>

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
            {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
          </div>
        </div>

        <div className="topbar-right">
          <div className={`sys-status ${esp32Online ? '' : 'sys-status--offline'}`}>
            <span className="pulse-dot" />
            {esp32Online ? 'ESP32 ONLINE' : 'ESP32 OFFLINE'}
          </div>
          {(queueLength > 0 || activeId !== null) && (
            <div className="queue-badge" title="LED actions pending">
              <span className="queue-badge__icon">▶</span>
              {activeId !== null ? `Slot #${activeId} active` : ''}
              {queueLength > 0 ? `  +${queueLength} in queue` : ''}
            </div>
          )}
          <button
            className="topbar-icon-btn theme-toggle-btn"
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setIsDark(d => !d)}
          >
            {isDark ? <IconSun /> : <IconMoon />}
          </button>
          <button className="topbar-icon-btn" title="Export inventory CSV" onClick={exportCSV}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
          <button className="topbar-icon-btn" title="Import inventory CSV" onClick={() => importCSVRef.current?.click()}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
            </svg>
          </button>
          <input ref={importCSVRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImportCSV} />
          <div className="kb-hint" title="Keyboard shortcuts: / search · P pick · U put · E edit layout · Esc close">
            <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/></svg>
            <kbd>/</kbd><kbd>P</kbd><kbd>U</kbd><kbd>E</kbd><kbd>Esc</kbd>
          </div>
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

      {/* ── BODY ── */}
      <div className="body-layout">

        {/* ── SIDENAV ── */}
        <nav className="sidenav">
          <NavBtn icon={IconPick}     label="PICK"        active={activePage === 'pick'}       onClick={() => togglePage('pick')} />
          <NavBtn icon={IconPut}      label="PUT"         active={activePage === 'put'}        onClick={() => togglePage('put')} />
          <NavBtn icon={IconScan}     label="Auto Detect" active={activePage === 'autodetect'} onClick={() => togglePage('autodetect')} />
          <NavBtn icon={IconKitting}  label="Kitting"     active={activePage === 'kitting'}    onClick={() => togglePage('kitting')} />
          <NavBtn icon={IconProducts} label="Products"    active={activePage === 'products'}   onClick={() => togglePage('products')} />
          <NavBtn icon={IconActivity} label="Log"         active={activePage === 'log'}         onClick={() => togglePage('log')} />
        </nav>

        {/* ── FEATURE PANEL ── */}
        {activePage && (
          <div className="nav-panel">

            {/* ── PICK ── */}
            {activePage === 'pick' && (
              <div className="fp">
                <div className="fp-head">
                  <div className="fp-title"><IconPick /> PICK Items</div>
                  <p className="fp-sub">Select items and quantities to pick</p>
                </div>
                <div className="fp-search-wrap">
                  <svg className="fp-search-icon" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  <input className="fp-search" placeholder="Search items…" value={pickSearch} onChange={e => setPickSearch(e.target.value)} />
                </div>
                <div className="fp-list">
                  {pickFiltered.length === 0 && <div className="fp-empty">No items found</div>}
                  {pickFiltered.map(item => {
                    const inCart = pickCart.some(c => c.id === item.id);
                    return (
                      <div key={item.id} className={`fp-item${inCart ? ' fp-item--in-cart' : ''}`}>
                        <div className="fp-item-info">
                          <div className="fp-item-name">{item.name}</div>
                          <div className="fp-item-sku">{item.sku} · Stock: {item.quantity}</div>
                        </div>
                        <button className="fp-add-btn" disabled={inCart} onClick={() => addToCart(item, setPickCart)}>
                          {inCart ? '✓' : '+'}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {pickCart.length > 0 && (
                  <div className="fp-cart">
                    <div className="fp-cart-title">Selected ({pickCart.length})</div>
                    {pickCart.map(c => (
                      <div key={c.id} className="fp-cart-row">
                        <div className="fp-cart-name">{c.name}</div>
                        <div className="fp-cart-ctrl">
                          <button onClick={() => updateCartQty(c.id, -1, setPickCart)}>−</button>
                          <span>{c.qty}</span>
                          <button onClick={() => updateCartQty(c.id, 1, setPickCart)}>+</button>
                        </div>
                        <button className="fp-cart-remove" onClick={() => removeFromCart(c.id, setPickCart)}>✕</button>
                      </div>
                    ))}
                    <button className="fp-send-btn fp-send-pick" onClick={() => { addToast(`PICK command sent — ${pickCart.reduce((s,c)=>s+c.qty,0)} items`); setPickCart([]); }}>
                      ↓ Send PICK Command&nbsp;({pickCart.reduce((s, c) => s + c.qty, 0)} items)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── PUT ── */}
            {activePage === 'put' && (
              <div className="fp">
                <div className="fp-head">
                  <div className="fp-title"><IconPut /> PUT Items</div>
                  <p className="fp-sub">Select items and quantities to put back</p>
                </div>
                <div className="fp-search-wrap">
                  <svg className="fp-search-icon" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  <input className="fp-search" placeholder="Search items…" value={putSearch} onChange={e => setPutSearch(e.target.value)} />
                </div>
                <div className="fp-list">
                  {putFiltered.length === 0 && <div className="fp-empty">No items found</div>}
                  {putFiltered.map(item => {
                    const inCart = putCart.some(c => c.id === item.id);
                    return (
                      <div key={item.id} className={`fp-item${inCart ? ' fp-item--in-cart' : ''}`}>
                        <div className="fp-item-info">
                          <div className="fp-item-name">{item.name}</div>
                          <div className="fp-item-sku">{item.sku} · Stock: {item.quantity}</div>
                        </div>
                        <button className="fp-add-btn" disabled={inCart} onClick={() => addToCart(item, setPutCart)}>
                          {inCart ? '✓' : '+'}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {putCart.length > 0 && (
                  <div className="fp-cart">
                    <div className="fp-cart-title">Selected ({putCart.length})</div>
                    {putCart.map(c => (
                      <div key={c.id} className="fp-cart-row">
                        <div className="fp-cart-name">{c.name}</div>
                        <div className="fp-cart-ctrl">
                          <button onClick={() => updateCartQty(c.id, -1, setPutCart)}>−</button>
                          <span>{c.qty}</span>
                          <button onClick={() => updateCartQty(c.id, 1, setPutCart)}>+</button>
                        </div>
                        <button className="fp-cart-remove" onClick={() => removeFromCart(c.id, setPutCart)}>✕</button>
                      </div>
                    ))}
                    <button className="fp-send-btn fp-send-put" onClick={() => { addToast(`PUT command sent — ${putCart.reduce((s,c)=>s+c.qty,0)} items`); setPutCart([]); }}>
                      ↑ Send PUT Command&nbsp;({putCart.reduce((s, c) => s + c.qty, 0)} items)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── AUTO DETECT ── */}
            {activePage === 'autodetect' && (
              <div className="fp">
                <div className="fp-head">
                  <div className="fp-title"><IconScan /> Auto Detect</div>
                  <p className="fp-sub">Computer vision item identification for PUT</p>
                </div>
                <div className="fp-camera-view">
                  {isScanning ? (
                    <div className="fp-camera-scanning">
                      <div className="fp-scan-ring" />
                      <span>Scanning…</span>
                    </div>
                  ) : detectedItems.length > 0 ? (
                    <div className="fp-camera-done">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" width="30" height="30"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>{detectedItems.length} items detected</span>
                    </div>
                  ) : (
                    <div className="fp-camera-idle">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                      <span>Camera feed</span>
                      <span className="fp-camera-hint">Press scan to detect items</span>
                    </div>
                  )}
                </div>
                <button className="fp-scan-btn" onClick={handleScan} disabled={isScanning}>
                  {isScanning ? 'Scanning…' : detectedItems.length > 0 ? 'Re-scan' : 'Start Scan'}
                </button>
                {detectedItems.length > 0 && (
                  <>
                    <div className="fp-section-label">Detected Items</div>
                    <div className="fp-list">
                      {detectedItems.map(item => (
                        <div key={item.id} className="fp-item">
                          <div className="fp-item-info">
                            <div className="fp-item-name">{item.name}</div>
                            <div className="fp-item-sku">{item.sku} · Qty: {item.qty}</div>
                          </div>
                          <div className="fp-confidence" style={{ '--conf': item.confidence >= 90 ? '#10b981' : '#f59e0b' }}>
                            {item.confidence}%
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="fp-send-btn fp-send-put" onClick={() => { addToast(`PUT command sent — ${detectedItems.reduce((s,i)=>s+i.qty,0)} items detected`); setDetectedItems([]); }}>
                      ↑ Send PUT Command&nbsp;({detectedItems.reduce((s, i) => s + i.qty, 0)} items)
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── KITTING ── */}
            {activePage === 'kitting' && (
              <div className="fp">
                <div className="fp-head">
                  <div className="fp-title"><IconKitting /> Kitting</div>
                  <p className="fp-sub">Generate a pick list from a product's BOM</p>
                </div>
                {!selectedKitProduct ? (
                  <>
                    <div className="fp-section-label">Select a product</div>
                    <div className="fp-kit-list">
                      {products.length === 0 && <div className="fp-empty">No products defined yet</div>}
                      {products.map(p => (
                        <button key={p.id} className="fp-kit-product-btn" onClick={() => setSelectedKitProduct(p)}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="fp-kit-product-name">{p.name}</div>
                            <div className="fp-item-sku">{p.sku} · {p.bom.length} components</div>
                          </div>
                          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{ flexShrink: 0, color: '#475569' }}>
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                          </svg>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <button className="fp-back-btn" onClick={() => setSelectedKitProduct(null)}>← Back to products</button>
                    <div style={{ marginBottom: 14 }}>
                      <div className="fp-kit-product-name" style={{ fontSize: '0.9rem', color: '#f1f5f9', marginBottom: 3 }}>{selectedKitProduct.name}</div>
                      <div className="fp-item-sku">{selectedKitProduct.sku}</div>
                    </div>
                    <div className="fp-section-label">Bill of Materials</div>
                    <div className="fp-bom-list">
                      {selectedKitProduct.bom.map((line, i) => (
                        <div key={i} className="fp-bom-row">
                          <div className="fp-bom-qty">{line.qty}×</div>
                          <div className="fp-item-info">
                            <div className="fp-item-name">{line.name}</div>
                            <div className="fp-item-sku">{line.sku}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      className="fp-send-btn fp-send-pick"
                      onClick={() => addToast(`PICK sent for ${selectedKitProduct.name} — ${selectedKitProduct.bom.reduce((s,b)=>s+b.qty,0)} items`)}
                    >
                      ↓ PICK All Components&nbsp;({selectedKitProduct.bom.reduce((s, b) => s + b.qty, 0)} items)
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── PRODUCTS ── */}
            {activePage === 'products' && (
              <div className="fp">
                <div className="fp-head">
                  <div className="fp-title"><IconProducts /> Products</div>
                  <p className="fp-sub">Create and edit products with their BOM</p>
                </div>
                {editingProduct === null ? (
                  <>
                    <button className="fp-new-product-btn" onClick={handleNewProduct}>+ New Product</button>
                    <div className="fp-list" style={{ maxHeight: 'none' }}>
                      {products.length === 0 && <div className="fp-empty">No products yet</div>}
                      {products.map(p => (
                        <div key={p.id} className="fp-product-row">
                          <div className="fp-item-info">
                            <div className="fp-item-name">{p.name}</div>
                            <div className="fp-item-sku">{p.sku} · {p.bom.length} components</div>
                          </div>
                          <div className="fp-product-actions">
                            <button className="fp-icon-btn" title="Edit" onClick={() => handleEditProduct(p)}>
                              <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
                              </svg>
                            </button>
                            <button className="fp-icon-btn fp-icon-btn--danger" title="Delete" onClick={() => handleDeleteProduct(p.id)}>
                              <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="fp-product-form">
                    <button className="fp-back-btn" style={{ marginBottom: 14 }} onClick={() => setEditingProduct(null)}>← Cancel</button>
                    <div className="fp-fgroup">
                      <label>Product Name</label>
                      <input value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Widget Assembly A" autoFocus />
                    </div>
                    <div className="fp-fgroup">
                      <label>SKU</label>
                      <input value={productForm.sku} onChange={e => setProductForm(f => ({ ...f, sku: e.target.value }))} placeholder="e.g. PROD-001" />
                    </div>
                    <div className="fp-bom-editor">
                      <div className="fp-bom-editor-header">
                        <span className="fp-section-label" style={{ margin: 0 }}>Bill of Materials</span>
                        <button className="fp-add-bom-line" onClick={addBomLine}>+ Add Line</button>
                      </div>
                      {productForm.bom.length === 0 && <div className="fp-empty" style={{ paddingTop: 10 }}>No components yet</div>}
                      {productForm.bom.map((line, i) => (
                        <div key={i} className="fp-bom-edit-row">
                          <input
                            className="fp-bom-input fp-bom-qty-input"
                            type="number" min="1"
                            value={line.qty}
                            onChange={e => updateBomLine(i, 'qty', e.target.value)}
                            placeholder="Qty"
                          />
                          <input
                            className="fp-bom-input fp-bom-name-input"
                            value={line.name}
                            onChange={e => updateBomLine(i, 'name', e.target.value)}
                            placeholder="Item name"
                          />
                          <input
                            className="fp-bom-input fp-bom-sku-input"
                            value={line.sku}
                            onChange={e => updateBomLine(i, 'sku', e.target.value)}
                            placeholder="SKU"
                          />
                          <button className="fp-icon-btn fp-icon-btn--danger" onClick={() => removeBomLine(i)}>✕</button>
                        </div>
                      ))}
                    </div>
                    <button className="fp-send-btn" style={{ background: '#2563eb', marginTop: 14 }} onClick={handleSaveProduct}>
                      Save Product
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── ACTIVITY LOG ── */}
            {activePage === 'log' && (
              <div className="fp">
                <div className="fp-head">
                  <div className="fp-title"><IconActivity /> Activity Log</div>
                  <p className="fp-sub">Real-time record of all PICK / PUT operations</p>
                </div>
                {activityLog.length === 0 ? (
                  <div className="fp-empty" style={{ paddingTop: 30 }}>
                    No activity yet — perform a PICK or PUT to see entries here.
                  </div>
                ) : (
                  <>
                    <button
                      className="fp-scan-btn"
                      style={{ marginBottom: 8 }}
                      onClick={() => setActivityLog([])}
                    >
                      Clear log
                    </button>
                    <div className="fp-log-list">
                      {activityLog.map(e => (
                        <div key={e.id} className={`fp-log-row fp-log-row--${e.type.toLowerCase()}`}>
                          <div className={`fp-log-badge fp-log-badge--${e.type.toLowerCase()}`}>
                            {e.type}
                          </div>
                          <div className="fp-log-info">
                            <div className="fp-log-name">{e.name}</div>
                            <div className="fp-log-meta">Slot #{e.slotId} · {e.sku} · qty {e.qty}</div>
                          </div>
                          <div className="fp-log-time">
                            {e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        )}

        {/* ── WORKSPACE ── */}
        <div className="workspace">

          {/* FLOOR MAP */}
          <div className={`floor-map ${isEditMode ? 'floor-map--edit' : ''}`} ref={mapRef}>
            <div className="zone-legend">
              {Object.entries(ZONES).map(([key, z]) => (
                <div key={key} className="zone-legend-item">
                  <span className="zone-dot" style={{ background: z.color }} />
                  {z.label}
                </div>
              ))}
            </div>

            {isEditMode && <div className="edit-hint">Drag bins to reposition · tap colour pips to assign zones</div>}

            {inventory.map(item => {
              const pos      = getPos(item);
              const empty    = isSlotEmpty(item);
              const zone     = item.zone || 'A';
              const zColor   = ZONES[zone]?.color ?? ZONES.A.color;
              const isPick   = activePickId === item.id;
              const isSel    = selectedSlot?.id === item.id;
              const isDimmed = filteredIds && !filteredIds.has(item.id);
              const isHidden = empty && !isEditMode;
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
                    item.image_url ? 'slot-card--has-image' : '',
                  ].join(' ')}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, '--zc': zColor, '--zc40': zColor + '40', ...(item.image_url ? { '--card-img': `url(${item.image_url})` } : {}) }}
                  onMouseDown={e => handleSlotMouseDown(e, item)}
                  onClick={() => {
                    if (isEditMode) return;
                    setSelectedSlot(item);
                    setFormData({ name: item.name, sku: item.sku, quantity: item.quantity, description: item.description || '', datasheet_url: item.datasheet_url || '', image_url: item.image_url || '', supplier_name: item.supplier_name || '', supplier_part: item.supplier_part || '', supplier_url: item.supplier_url || '' });
                    setIsEditing(false);
                  }}
                >
                  <div className="slot-accent" style={{ background: zColor }} />
                  <div className="slot-id">#{item.id}</div>
                  <div className="slot-name">{empty ? 'EMPTY' : item.name}</div>
                  {!empty && (
                    <div className="slot-qty" style={{ color: isOutStock ? 'var(--red)' : isLowStock ? '#f59e0b' : zColor }}>
                      {item.quantity}
                    </div>
                  )}
                  {!empty && !isEditMode && item.description && (
                    <div className="slot-desc-tip">{item.description}</div>
                  )}

                  {!isEditMode && isLowStock && <div className="stock-badge stock-badge--low" title={`Low stock (min: ${threshold})`}>!</div>}
                  {!isEditMode && isOutStock && <div className="stock-badge stock-badge--out" title="Out of stock">0</div>}
                  {!empty && !isEditMode && item.datasheet_url && (
                    <div className="slot-ds-dot" title="Datasheet available">
                      <svg viewBox="0 0 12 12" fill="currentColor" width="8" height="8">
                        <path d="M2 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5H7V1H2zm5.5 0v3H10L7.5 1z"/>
                      </svg>
                    </div>
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

          {/* SLOT DETAIL PANEL */}
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
                      <div className="pstat-val pstat-val--big" style={{ color: isOutStock ? 'var(--red)' : isLowStock ? '#f59e0b' : zColor }}>{slot.quantity}</div>
                      {isLowStock && <div className="panel-stock-warn panel-stock-warn--low">Low stock — below minimum threshold of {threshold}</div>}
                      {isOutStock && <div className="panel-stock-warn panel-stock-warn--out">Out of stock</div>}
                    </div>

                    {slot.description && (
                      <div className="pstat">
                        <div className="pstat-label">DESCRIPTION</div>
                        <div className="pstat-val pstat-desc">{slot.description}</div>
                      </div>
                    )}

                    {slot.image_url && (
                      <div className="panel-img-wrap">
                        <img src={slot.image_url} alt={slot.name} className="panel-img" onError={e => { e.target.style.display = 'none'; }} />
                      </div>
                    )}

                    {(slot.supplier_name || slot.supplier_part) && (
                      <div className="pstat">
                        <div className="pstat-label">SUPPLIER</div>
                        {slot.supplier_name && <div className="pstat-val" style={{ fontSize: '0.88rem' }}>{slot.supplier_name}</div>}
                        {slot.supplier_part && <div className="pstat-val pstat-val--mono" style={{ marginTop: 3 }}>{slot.supplier_part}</div>}
                        {slot.supplier_url && (
                          <a className="supplier-link" href={slot.supplier_url} target="_blank" rel="noopener noreferrer">
                            Open supplier page ↗
                          </a>
                        )}
                      </div>
                    )}

                    {slot.datasheet_url && (
                      <a
                        className="datasheet-btn"
                        href={slot.datasheet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10 9 9 9 8 9"/>
                        </svg>
                        Open Datasheet
                        <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11" style={{ marginLeft: 'auto', opacity: 0.6 }}>
                          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/>
                          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/>
                        </svg>
                      </a>
                    )}

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
                                type="number" min="1" placeholder="0"
                                value={customQty}
                                onChange={e => { setCustomQty(e.target.value); setPickError(''); }}
                                onKeyDown={e => e.key === 'Enter' && handleBulkAction('PICK')}
                              />
                              <button className="cpf-cancel" onClick={() => { setCustomQtyOpen(false); setPickError(''); }}>✕</button>
                            </div>
                            <div className="cpf-actions">
                              <button className="cpf-pick" onClick={() => handleBulkAction('PICK')}>− PICK {customQty || 'N'}</button>
                              <button className="cpf-put"  onClick={() => handleBulkAction('PUT')}>+ PUT {customQty || 'N'}</button>
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
                      <button className="mgmt-btn" onClick={() => setIsEditing(true)}>{empty ? 'Add Object' : 'Edit Object'}</button>
                      {!empty && <button className="mgmt-btn mgmt-btn--danger" onClick={() => handleRemoveObject(slot.id)}>Remove Object</button>}
                    </div>
                  </>
                ) : (
                  <form className="edit-form" onSubmit={handleSaveObject}>
                    <div className="fgroup">
                      <label>Object Name</label>
                      <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. M8 Bolts" autoFocus required />
                    </div>
                    <div className="fgroup">
                      <label>SKU <span className="flabel-hint">— optional</span></label>
                      <input type="text" value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder={`SKU-${slot.id}`} />
                    </div>
                    <div className="fgroup">
                      <label>Quantity</label>
                      <input type="number" min="0" value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: Math.max(0, parseInt(e.target.value) || 0) })} required />
                    </div>
                    <div className="fgroup">
                      <label>Description <span className="flabel-hint">— optional</span></label>
                      <textarea
                        className="fgroup-textarea"
                        value={formData.description}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        placeholder="e.g. Stainless steel hex bolt, fully threaded, grade 8.8"
                        rows={3}
                      />
                    </div>
                    <div className="fgroup">
                      <label>Datasheet URL <span className="flabel-hint">— optional</span></label>
                      <div className="fgroup-url-wrap">
                        <svg className="fgroup-url-icon" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/>
                          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/>
                        </svg>
                        <input
                          type="url"
                          className="fgroup-url-input"
                          value={formData.datasheet_url}
                          onChange={e => setFormData({ ...formData, datasheet_url: e.target.value })}
                          placeholder="https://…/datasheet.pdf"
                        />
                      </div>
                    </div>
                    <div className="fgroup">
                      <label>Image URL <span className="flabel-hint">— optional</span></label>
                      <div className="fgroup-url-wrap">
                        <svg className="fgroup-url-icon" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd"/>
                        </svg>
                        <input type="url" className="fgroup-url-input" value={formData.image_url} onChange={e => setFormData({ ...formData, image_url: e.target.value })} placeholder="https://…/photo.jpg" />
                      </div>
                    </div>
                    <div className="fgroup-separator">Supplier</div>
                    <div className="fgroup">
                      <label>Supplier Name <span className="flabel-hint">— optional</span></label>
                      <input type="text" value={formData.supplier_name} onChange={e => setFormData({ ...formData, supplier_name: e.target.value })} placeholder="e.g. Mouser Electronics" />
                    </div>
                    <div className="fgroup">
                      <label>Supplier Part No. <span className="flabel-hint">— optional</span></label>
                      <input type="text" value={formData.supplier_part} onChange={e => setFormData({ ...formData, supplier_part: e.target.value })} placeholder="e.g. 534-5000-ND" />
                    </div>
                    <div className="fgroup">
                      <label>Supplier URL <span className="flabel-hint">— optional</span></label>
                      <div className="fgroup-url-wrap">
                        <svg className="fgroup-url-icon" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/>
                          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/>
                        </svg>
                        <input type="url" className="fgroup-url-input" value={formData.supplier_url} onChange={e => setFormData({ ...formData, supplier_url: e.target.value })} placeholder="https://…/product" />
                      </div>
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

      {/* ── TOAST OVERLAY ── */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            {t.type === 'success' && (
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{flexShrink:0}}>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
            )}
            {t.type === 'error' && (
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{flexShrink:0}}>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
              </svg>
            )}
            {t.type === 'info' && (
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{flexShrink:0}}>
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
              </svg>
            )}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
