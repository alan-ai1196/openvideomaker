import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
