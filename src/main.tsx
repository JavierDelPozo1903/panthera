import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/300.css';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Sin StrictMode: el juego gestiona recursos imperativos (WebGL, Rapier, workers) que no
// deben crearse dos veces en desarrollo.
createRoot(document.getElementById('root')!).render(<App />);
