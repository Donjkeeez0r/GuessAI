import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initTelegram } from './lib/telegram';
import './styles/global.css';

// Telegram поднимается до первого рендера: тема разворачивается в CSS-переменные,
// иначе первый кадр отрисуется с фолбэками и мигнёт.
initTelegram();

const container = document.getElementById('root');

if (!container) throw new Error('Не найден корневой элемент #root');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
