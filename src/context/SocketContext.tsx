"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io as createSocket, Socket } from "socket.io-client";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, isConnected: false });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const init = async () => {
      await fetch("/api/socket");
      const s = createSocket({ path: "/api/socket", addTrailingSlash: false });
      socketRef.current = s;

      s.on("connect", () => setIsConnected(true));
      s.on("disconnect", () => setIsConnected(false));

      setSocket(s);
    };

    init();

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
