import type { Server as IOServer } from "socket.io";

let _io: IOServer | null = null;

export function setIO(io: IOServer) {
  _io = io;
}

export function getIO(): IOServer | null {
  return _io;
}

export function broadcastPhaseUpdated(data: {
  phaseId: string;
  jobId: string;
  phase: Record<string, unknown>;
}) {
  _io?.emit("phase-updated", data);
}
