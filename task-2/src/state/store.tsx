"use client";

import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { createStore, useStore } from "zustand";
import type { BoardState, Snapshot } from "@/src/lib/types";
import { applyEvent, stateFromSnapshot, type BoardEvent } from "./reducer";

export type BoardStore = BoardState & {
  dispatch: (event: BoardEvent) => void;
};

export type BoardStoreApi = ReturnType<typeof createBoardStore>;

export function createBoardStore(initial: Snapshot) {
  return createStore<BoardStore>((set) => ({
    ...stateFromSnapshot(initial),
    dispatch: (event) => {
      set((state) => {
        const { dispatch, ...board } = state;
        const next = applyEvent(board, event);
        return { ...next, dispatch };
      });
    },
  }));
}

const BoardStoreContext = createContext<BoardStoreApi | null>(null);

export function BoardStoreProvider({
  initialSnapshot,
  children,
}: {
  initialSnapshot: Snapshot;
  children: ReactNode;
}) {
  const storeRef = useRef<BoardStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createBoardStore(initialSnapshot);
  }
  return (
    <BoardStoreContext.Provider value={storeRef.current}>
      {children}
    </BoardStoreContext.Provider>
  );
}

export function useBoardStoreApi(): BoardStoreApi {
  const store = useContext(BoardStoreContext);
  if (!store) {
    throw new Error("useBoardStoreApi must be used within BoardStoreProvider");
  }
  return store;
}

export function useBoardStore<T>(selector: (state: BoardStore) => T): T {
  const store = useBoardStoreApi();
  return useStore(store, selector);
}
