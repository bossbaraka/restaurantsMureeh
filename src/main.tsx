import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { prepareGuestRouteIdentity } from './hooks/useTenantDocumentIdentity'

// A guest arriving through a table QR lands on `/r/{slug}`: strip the platform
// name and mark out of the tab before React mounts, so the restaurant's own
// identity is the only one the browser chrome ever shows. Runs synchronously
// here (not in an effect) because the very first paint of the tab is what a
// guest sees while the tenant record is still loading.
prepareGuestRouteIdentity()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
