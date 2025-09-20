// src/options/index.tsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import Options from './Options';

// Find the root element in options.html
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Render the main Options component
root.render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>
);
