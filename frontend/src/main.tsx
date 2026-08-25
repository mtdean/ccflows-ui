import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DealDraftProvider } from './lib/useDealDraft';
import { RunsProvider } from './lib/useRuns';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DealDraftProvider>
          <RunsProvider>
            <App />
          </RunsProvider>
        </DealDraftProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
