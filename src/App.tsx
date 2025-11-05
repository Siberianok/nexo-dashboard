import React from 'react';
import { ErrorBoundary } from './components/SimuladorPrestamos';
import SimuladorPrestamos from './components/SimuladorPrestamos';

const App: React.FC = () => (
  <ErrorBoundary>
    <SimuladorPrestamos />
  </ErrorBoundary>
);

export default App;
