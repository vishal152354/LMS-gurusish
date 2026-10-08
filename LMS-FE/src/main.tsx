import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { RouterProvider } from 'react-router'
import { store, persistor } from '@/store'
import { router } from '@/routes/router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { GuideProvider } from '@/features/guide/GuideProvider'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate loading={<FullPageSpinner />} persistor={persistor}>
        <TooltipProvider delayDuration={250}>
          <GuideProvider>
            <RouterProvider router={router} />
          </GuideProvider>
          <Toaster />
        </TooltipProvider>
      </PersistGate>
    </Provider>
  </StrictMode>,
)
