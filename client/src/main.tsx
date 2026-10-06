import '@telegram-apps/telegram-ui/dist/styles.css';
import './app.css';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot style={{ minHeight: '100vh', background: 'var(--tgui--secondary_bg_color)' }}>
      <App />
    </AppRoot>
  </StrictMode>,
);
