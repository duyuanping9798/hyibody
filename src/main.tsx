import { registerSW } from 'virtual:pwa-register';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

registerSW({ immediate: true });

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root element');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
