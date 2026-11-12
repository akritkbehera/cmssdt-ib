import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/tokens.css';
import './index.css';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import App from './App';
import { unregister } from './registerServiceWorker';

import './dashboard.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

unregister();
