import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/tokens.css';
import './index.css';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import App from './App';
import { unregister } from './registerServiceWorker';

import { ShowArchProvider } from './context/ShowArchContext';
import { CommandProvider } from './context/CommandContext';
import { RelValProvider } from './Stores/RelValStore';
import './dashboard.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <HashRouter>
      <RelValProvider>
        <ShowArchProvider>
          <CommandProvider>
            <App />
          </CommandProvider>
        </ShowArchProvider>
      </RelValProvider>
    </HashRouter>
  </React.StrictMode>
);

unregister();
