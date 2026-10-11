import { createRoot } from 'react-dom/client';
import { Provider, getDefaultStore } from 'jotai';
import ProjectLoader from './ProjectLoader';
import './styles/globals.css';
import { subscribeBuilderTheme } from './editor/builder-theme';

// Restore the saved builder accent BEFORE the first paint (so a non-default
// theme doesn't flash the stock brass on reload) and keep it in sync with both
// the atom and the light/dark switch thereafter.
subscribeBuilderTheme();

// Circuit-breaker: stop runaway unhandledrejection / error cascades from
// looping indefinitely and freezing the browser or leaking memory.
if (typeof window !== 'undefined') {
  let cascadeCount = 0;
  let lastCascadeTime = 0;
  window.addEventListener(
    'unhandledrejection',
    (e) => {
      const now = Date.now();
      if (now - lastCascadeTime < 1000) {
        cascadeCount++;
        if (cascadeCount > 30) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      } else {
        cascadeCount = 1;
        lastCascadeTime = now;
      }
    },
    true
  );
}

// Bind <Provider> to the global default store so non-React code paths
// (e.g. the dev-only `__e2e` hook in ProjectLoader, mutation queue
// callbacks) can read/write the same atoms React subscribes to. Without
// `store=`, <Provider> creates a fresh scoped store and any
// `getDefaultStore()` call lands on a different instance — atom writes
// from one path become invisible to readers on the other.
createRoot(document.getElementById('root')!).render(
  <Provider store={getDefaultStore()}>
    <ProjectLoader />
  </Provider>
);
