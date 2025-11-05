import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

declare global {
  interface Window {
    __nexoSim?: any;
  }
}

describe('App', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const script = document.createElement('script');
    script.id = 'sim-model-config';
    script.type = 'application/json';
    script.textContent = JSON.stringify({ forceOn: true, refreshMs: 60000 }, null, 2);
    document.body.appendChild(script);

    window.__nexoSim = {
      getStatus: () => ({ hasCache: false, ageMs: null, cacheTs: null, source: 'test', snapshot: null }),
      computePairNetAPR: () => null,
    };
  });

  it('renderiza el encabezado principal del simulador', async () => {
    render(<App />);

    expect(await screen.findByText(/Simulador de Préstamos/i)).toBeInTheDocument();
  });
});
