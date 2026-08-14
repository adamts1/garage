import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, useStore } from 'react-redux';
import busy from './busySlice';
import modal from './modalSlice';
import toast from './toastSlice';

/* The store holds UI state only — which toasts are up, which modals are open,
   what the app is busy doing. Tickets, the catalog, customers and workers stay
   where they are: in hooks over Supabase, with realtime subscriptions keeping
   them fresh. Copying that into Redux would mean maintaining a second source of
   truth for data the server already pushes at us. */
export const store = configureStore({
  reducer: { toast, modal, busy },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppStore = useStore.withTypes<typeof store>();

export * from './busySlice';
export * from './modalSlice';
export * from './toastSlice';
export * from './useBusy';
export * from './useConfirm';
export * from './useModalResult';
export * from './usePrompt';
