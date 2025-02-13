"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

interface ReaderContextValue {
  currentPage: number;
  setCurrentPage: (pageOrUpdater: number | ((prev: number) => number)) => void;
}

const ReaderContext = createContext<ReaderContextValue | undefined>(undefined);

export function useReader() {
  const context = useContext(ReaderContext);
  if (context === undefined) {
    throw new Error("useReader must be used within a ReaderProvider");
  }
  return context;
}

interface ReaderProviderProps {
  children: ReactNode;
}

export function ReaderProvider({ children }: ReaderProviderProps) {
  const [currentPage, setCurrentPage] = useState(1);

  return (
    <ReaderContext.Provider value={{ currentPage, setCurrentPage }}>
      {children}
    </ReaderContext.Provider>
  );
}
