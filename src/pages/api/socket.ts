import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { setIO } from "@/lib/socket";

type SocketServer = HttpServer & { io?: IOServer };

type NextApiResponseWithSocket = NextApiResponse & {
  socket: { server: SocketServer };
};

export const config = { api: { bodyParser: false } };

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new IOServer(res.socket.server as HttpServer, {
      path: "/api/socket",
      addTrailingSlash: false,
    });
    res.socket.server.io = io;
    setIO(io);

    io.on("connection", (socket) => {
      socket.on("disconnect", () => {});
    });
  } else {
    setIO(res.socket.server.io);
  }

  res.end();
}
