import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

/**
 * @file App.js
 * @description WMS Dashboard for 32-node Pick-to-Light System.
 * Architecture: RESTful state management with a side-panel HMI.
 */

const API_BASE = 'http://localhost:5000/api';

function App() {
  // --- SYSTEM STATE ---
  const [inventory, setInventory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [activePickId, setActivePickId] = useState(null);
  
  // --- FORM STATE ---
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({ name: '', sku: '', quantity: 0 });

  // --- INITIALIZATION ---
  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      const response = await axios.get(`${API_BASE}/inventory`);
      setInventory(response.data);
    } catch (err) {
      console.error("Communication failure with persistence layer.");
    }
  };

  // --- CRUD OPERATIONS ---

  // Adds or Updates object metadata for a specific physical ID
  const handleSaveObject = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/slots/update`, { 
        ...formData, 
        id: selectedSlot.id 
      });
      setIsEditing(false);
      await fetchInventory();
      // Sync local panel state
      setSelectedSlot({ ...selectedSlot, ...formData });
    } catch (err) {
      alert("Error updating database record.");
    }
  };

  // Clears metadata from a slot (Removing an object)
  const handleRemoveObject = async (id) => {
    if (window.confirm(`Warning: Purge metadata for Slot ${id}?`)) {
      try {
        await axios.post(`${API_BASE}/slots/remove`, { id });
        await fetchInventory();
        setSelectedSlot(null);
      } catch (err) {
        alert("Error during object removal.");
      }
    }
  };

  // --- HARDWARE ACTUATION ---

  // Triggers the physical LED and updates database count
  const handleAction = async (id, type) => {
    try {
      await axios.post(`${API_BASE}/action`, { id, type });
      if (type === 'PICK') {
        setActivePickId(id);
        // Visual timeout for the "Glow" effect
        setTimeout(() => setActivePickId(null), 4000);
      }
      fetchInventory();
    } catch (err) {
      console.error("Hardware trigger failed.");
    }
  };

  // --- FILTERING LOGIC ---
  const filteredInventory = inventory.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app-container">
      {/* 1. TOP NAVIGATION BAR */}
      <header className="top-bar">
        <div className="brand">BMS | 32-NODE ARCHITECT</div>
        <div className="search-box">
          <input 
            type="text" 
            placeholder="Search by Object Name or SKU..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="status-badge">
          <span className="dot"></span> SYSTEM ONLINE
        </div>
      </header>

      <main className="main-content">
        {/* 2. PHYSICAL 32-NODE GRID */}
        <section className="grid-area">
          <div className="grid-32">
            {filteredInventory.map(item => {
              const isEmpty = item.name === 'Empty Slot' || item.sku === 'N/A';
              return (
                <div 
                  key={item.id} 
                  className={`slot-rect 
                    ${activePickId === item.id ? 'glow-pick' : ''} 
                    ${selectedSlot?.id === item.id ? 'selected' : ''} 
                    ${isEmpty ? 'is-empty' : 'is-occupied'}`
                  }
                  onClick={() => {
                    setSelectedSlot(item);
                    setFormData({ name: item.name, sku: item.sku, quantity: item.quantity });
                    setIsEditing(false);
                  }}
                >
                  <div className="slot-id-label">{item.id}</div>
                  <div className="slot-name-label">{isEmpty ? "FREE" : item.name}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. INTERACTIVE DETAIL PANEL */}
        {selectedSlot && (
          <aside className="side-panel">
            <button className="close-panel" onClick={() => setSelectedSlot(null)}>×</button>
            <div className="panel-header">
              <h2>Node Configuration</h2>
              <p>Physical Address: 0x{selectedSlot.id.toString(16).toUpperCase()}</p>
            </div>

            {!isEditing ? (
              <div className="view-mode">
                <div className="data-field">
                  <label>Object Identity</label>
                  <p className="primary-text">{selectedSlot.name}</p>
                </div>
                <div className="data-field">
                  <label>SKU (Stock Keeping Unit)</label>
                  <p className="secondary-text">{selectedSlot.sku}</p>
                </div>
                <div className="data-field">
                  <label>Inventory Level</label>
                  <p className="qty-highlight">{selectedSlot.quantity}</p>
                </div>

                <div className="action-stack">
                  <button className="btn-act pick" onClick={() => handleAction(selectedSlot.id, 'PICK')}>TRIGGER PICK</button>
                  <button className="btn-act put" onClick={() => handleAction(selectedSlot.id, 'PUT')}>TRIGGER PUT</button>
                  <div className="divider"></div>
                  <button className="btn-mgmt edit" onClick={() => setIsEditing(true)}>EDIT / ADD OBJECT</button>
                  <button className="btn-mgmt delete" onClick={() => handleRemoveObject(selectedSlot.id)}>REMOVE OBJECT</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveObject} className="edit-form">
                <div className="form-field">
                  <label>Object Name</label>
                  <input 
                    type="text" 
                    value={formData.name} 
                      
                    required 
                  />
                </div>
                <div className="form-field">
                  <label>SKU</label>
                  <input 
                    type="text" 
                    value={formData.sku} 
                    onChange={(e) => setFormData({...formData, sku: e.target.value})} 
                    required 
                  />
                </div>
                <div className="form-field">
                  <label>Quantity</label>
                  <input 
                    type="number" 
                    value={formData.quantity} 
                    onChange={(e) => {
  const val = parseInt(e.target.value);
  setFormData({ ...formData, quantity: isNaN(val) ? 0 : val });
}}
                    required 
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn-act save">SAVE RECORD</button>
                  <button type="button" className="btn-mgmt" onClick={() => setIsEditing(false)}>CANCEL</button>
                </div>
              </form>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

export default App;