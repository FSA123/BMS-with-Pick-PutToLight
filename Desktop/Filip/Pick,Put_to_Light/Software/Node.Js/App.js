import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [inventory, setInventory] = useState([]);

  // Hook to fetch inventory data on component mount
  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      // Ensure your Node.js server is running on port 5000
      const response = await axios.get('http://localhost:5000/api/inventory');
      setInventory(response.data);
    } catch (err) {
      console.error("Data acquisition error: Ensure the Node.js server is active.", err);
    }
  };

  const handleAction = async (id, type) => {
    try {
      await axios.post('http://localhost:5000/api/action', { id, type });
      // Re-fetch data to synchronize the UI state with the database
      fetchInventory(); 
    } catch (err) {
      console.error("Action transmission failed.");
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>BMS: 32-Node Pick-to-Light Control</h1>
      </header>
      <main className="grid-container">
        {inventory.map((item) => (
          <div key={item.id} className="slot-card">
            <h3>{item.name}</h3>
            <p>SKU: {item.sku}</p>
            <p className="qty-display">Quantity: <strong>{item.quantity}</strong></p>
            <div className="actions">
              <button onClick={() => handleAction(item.id, 'PICK')} className="pick-btn">PICK</button>
              <button onClick={() => handleAction(item.id, 'PUT')} className="put-btn">PUT</button>
            </div>
            <div className="index-label">Address: 0x{item.id.toString(16).toUpperCase()} (Bit {item.id})</div>
          </div>
        ))}
      </main>
    </div>
  );
}

export default App;