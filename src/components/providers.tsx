"use client";

import { Toaster as SonnerToaster } from "sonner";
import { PwaRegistrar } from "./pwa-registrar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PwaRegistrar />
      {children}
      <SonnerToaster
        position="bottom-right"
        toastOptions={{
          className: "glass-card",
          duration: 4000,
        }}
      />
    </>
  );
}
