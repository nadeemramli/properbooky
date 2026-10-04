import { createContext, useContext } from "react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type FolderStatus = "available" | "missing" | "inaccessible" | "not_folder";

export interface KnownLibrary {
  id: string;
  name: string;
  path: string;
  status: FolderStatus;
  /** Why the folder cannot be opened right now, in words for the user. */
  problem: string | null;
  /** Rows in this library's own index; null until it is first indexed. */
  book_count: number | null;
  active: boolean;
}

export interface LibrariesView {
  libraries: KnownLibrary[];
  active_id: string | null;
  notices: string[];
  error: string | null;
}

export type LibraryInvoke = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** The open library. Everything rendered inside a workspace talks to the
 * backend through `invoke`, which is bound to this library's id: a call that
 * outlives the workspace (e.g. after a switch) is refused by the backend
 * instead of reaching the newly opened library. */
export interface LibraryHandle {
  id: string;
  name: string;
  path: string;
  invoke: LibraryInvoke;
}

const LibraryContext = createContext<LibraryHandle | null>(null);
export const LibraryProvider = LibraryContext.Provider;

export function useLibrary(): LibraryHandle {
  const library = useContext(LibraryContext);
  if (!library) throw new Error("useLibrary used outside an open library");
  return library;
}

/** `invoke` with the library id attached; calls still in flight are tracked
 * so a switch can let them finish against the library that issued them. */
export function boundInvoke(id: string, inFlight: Set<Promise<unknown>>): LibraryInvoke {
  return <T,>(command: string, args?: Record<string, unknown>) => {
    const call = tauriInvoke<T>(command, { ...args, libraryId: id });
    inFlight.add(call);
    call.then(
      () => inFlight.delete(call),
      () => inFlight.delete(call),
    );
    return call;
  };
}

export function countLabel(library: KnownLibrary): string {
  if (library.book_count === null) return "Not indexed yet";
  return `${library.book_count} ${library.book_count === 1 ? "book" : "books"} indexed`;
}
