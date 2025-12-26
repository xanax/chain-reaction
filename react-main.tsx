import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ChainReactionApp } from './ChainReactionApp';

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root');

createRoot(el).render(
  <React.StrictMode>
    <ChainReactionApp />
  </React.StrictMode>,
);
