import '@telegram-apps/telegram-ui/dist/styles.css';
import './app.css';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { setupViewport } from './telegram.ts';

void setupViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot className="app-root">
      <App />
    </AppRoot>
  </StrictMode>,
);
