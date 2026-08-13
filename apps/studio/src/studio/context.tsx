import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { StudioController } from './controller';

interface StudioContextValue {
  controller: StudioController;
  replace: (next: StudioController) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const initialRef = useRef<StudioController | null>(null);
  if (initialRef.current === null) {
    initialRef.current = StudioController.welcome();
  }
  const [controller, setController] = useState<StudioController>(initialRef.current);
  if (import.meta.env.DEV) {
    (window as unknown as { __ovmStudio?: StudioController }).__ovmStudio = controller;
  }
  return (
    <StudioContext.Provider value={{ controller, replace: setController }}>
      {children}
    </StudioContext.Provider>
  );
}

/** Bind a component to the controller; re-renders on every state change. */
export function useStudio(): StudioController {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  useSyncExternalStore(value.controller.subscribe, value.controller.getSnapshot);
  return value.controller;
}

/** Replace the whole session (opening a project file). */
export function useStudioReplace(): (next: StudioController) => void {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value.replace;
}
