import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.rtl.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.css';
import App from './App.jsx';
import { AppErrorBoundary } from './components/shared.jsx';

try {
  document.documentElement.dataset.theme =
    JSON.parse(localStorage.getItem('smart-attendance:theme')) === 'dark'
      ? 'dark'
      : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
