import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface ParticipantState {
  id: string;
  name: string;
  color: string;
  deviceProfile: string;
  headPos: Vec3;
  headQuat: Quat;
  handPos: Vec3 | null;
  voiceEnabled: boolean;
  muted: boolean;
  lastSeen: number;
}

interface PartSyncState {
  id: string;
  pos: Vec3;
  quat: Quat;
  snapped: boolean;
  lockedBy: string | null;
}

interface AnnotationState {
  id: string;
  author: string;
  text: string;
  pos: Vec3;
  color: string;
  createdAt: number;
}

interface RoomState {
  roomCode: string;
  moduleId: string;
  explodedAmount: number;
  participants: Map<string, ParticipantState>;
  parts: Map<string, PartSyncState>;
  annotations: AnnotationState[];
  updatedAt: number;
}

interface ClientMeta {
  clientId: string;
  roomCode: string | null;
}

const AVATAR_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa', '#fb7185', '#22d3ee'];

const rooms = new Map<string, RoomState>();
const clientMeta = new WeakMap<WebSocket, ClientMeta>();
const roomSockets = new Map<string, Set<WebSocket>>();
const clientSockets = new Map<string, WebSocket>();

function getOrCreateRoom(roomCode: string, defaultModule = 'turbine'): RoomState {
  const cleanCode = roomCode.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'LAB-01';
  let room = rooms.get(cleanCode);
  if (!room) {
    room = {
      roomCode: cleanCode,
      moduleId: defaultModule,
      explodedAmount: 0,
      participants: new Map(),
      parts: new Map(),
      annotations: [],
      updatedAt: Date.now(),
    };
    rooms.set(cleanCode, room);
    roomSockets.set(cleanCode, new Set());
  }
  return room;
}

function serializeRoom(room: RoomState) {
  return {
    roomCode: room.roomCode,
    moduleId: room.moduleId,
    explodedAmount: room.explodedAmount,
    participants: Array.from(room.participants.values()),
    parts: Array.from(room.parts.values()),
    annotations: room.annotations,
    updatedAt: room.updatedAt,
  };
}

function broadcastToRoom(roomCode: string, payload: unknown, exclude?: WebSocket) {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  const serialized = JSON.stringify(payload);
  for (const sock of sockets) {
    if (sock !== exclude && sock.readyState === WebSocket.OPEN) {
      sock.send(serialized);
    }
  }
}

function removeClientFromRoom(ws: WebSocket) {
  const meta = clientMeta.get(ws);
  if (!meta || !meta.roomCode) return;
  const room = rooms.get(meta.roomCode);
  const sockets = roomSockets.get(meta.roomCode);
  if (sockets) {
    sockets.delete(ws);
  }
  if (room) {
    room.participants.delete(meta.clientId);
    // Release any parts locked by this client
    for (const part of room.parts.values()) {
      if (part.lockedBy === meta.clientId) {
        part.lockedBy = null;
        broadcastToRoom(meta.roomCode, {
          type: 'part:release',
          partId: part.id,
          clientId: meta.clientId,
        });
      }
    }
    broadcastToRoom(meta.roomCode, {
      type: 'user:left',
      clientId: meta.clientId,
      participants: Array.from(room.participants.values()),
    });
    if (room.participants.size === 0 && sockets && sockets.size === 0) {
      // Keep room state briefly or clean up empty default rooms if stale
      room.updatedAt = Date.now();
    }
  }
  meta.roomCode = null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeRooms: rooms.size,
      timestamp: Date.now(),
    });
  });

  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(rooms.values()).map((r) => ({
      roomCode: r.roomCode,
      moduleId: r.moduleId,
      participantCount: r.participants.size,
      updatedAt: r.updatedAt,
    }));
    res.json({ rooms: list });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const clientId = `peer_${Math.random().toString(36).slice(2, 10)}`;
    clientMeta.set(ws, { clientId, roomCode: null });
    clientSockets.set(clientId, ws);

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const meta = clientMeta.get(ws);
      if (!meta) return;
      const type = String(msg.type || '');

      if (type === 'room:join') {
        removeClientFromRoom(ws);
        const roomCode = String(msg.roomCode || 'LAB-01').slice(0, 16);
        const moduleId = String(msg.moduleId || 'turbine').slice(0, 40);
        const room = getOrCreateRoom(roomCode, moduleId);
        meta.roomCode = room.roomCode;

        const colorIndex = room.participants.size % AVATAR_COLORS.length;
        const participant: ParticipantState = {
          id: meta.clientId,
          name: String(msg.name || `Engineer ${room.participants.size + 1}`).slice(0, 32),
          color: AVATAR_COLORS[colorIndex],
          deviceProfile: String(msg.deviceProfile || 'desktop').slice(0, 24),
          headPos: { x: 0, y: 1.6, z: 0.5 },
          headQuat: { x: 0, y: 0, z: 0, w: 1 },
          handPos: null,
          voiceEnabled: Boolean(msg.voiceEnabled),
          muted: Boolean(msg.muted),
          lastSeen: Date.now(),
        };
        room.participants.set(meta.clientId, participant);
        room.updatedAt = Date.now();
        roomSockets.get(room.roomCode)?.add(ws);

        ws.send(
          JSON.stringify({
            type: 'room:state',
            selfId: meta.clientId,
            room: serializeRoom(room),
          }),
        );

        broadcastToRoom(
          room.roomCode,
          {
            type: 'user:joined',
            participant,
            participants: Array.from(room.participants.values()),
          },
          ws,
        );
        return;
      }

      if (!meta.roomCode) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;

      if (type === 'avatar:pose') {
        const p = room.participants.get(meta.clientId);
        if (p && msg.headPos && msg.headQuat) {
          p.headPos = msg.headPos as Vec3;
          p.headQuat = msg.headQuat as Quat;
          p.handPos = (msg.handPos as Vec3 | null) ?? null;
          p.lastSeen = Date.now();
          broadcastToRoom(
            room.roomCode,
            {
              type: 'avatar:pose',
              clientId: meta.clientId,
              headPos: p.headPos,
              headQuat: p.headQuat,
              handPos: p.handPos,
            },
            ws,
          );
        }
      } else if (type === 'part:grab') {
        const partId = String(msg.partId || '');
        if (!partId) return;
        const existing = room.parts.get(partId) || {
          id: partId,
          pos: { x: 0, y: 1, z: -1 },
          quat: { x: 0, y: 0, z: 0, w: 1 },
          snapped: false,
          lockedBy: null,
        };
        if (existing.lockedBy && existing.lockedBy !== meta.clientId) return;
        existing.lockedBy = meta.clientId;
        room.parts.set(partId, existing);
        broadcastToRoom(room.roomCode, { type: 'part:grab', partId, clientId: meta.clientId }, ws);
      } else if (type === 'part:move') {
        const partId = String(msg.partId || '');
        if (!partId || !msg.pos || !msg.quat) return;
        const part: PartSyncState = {
          id: partId,
          pos: msg.pos as Vec3,
          quat: msg.quat as Quat,
          snapped: Boolean(msg.snapped),
          lockedBy: meta.clientId,
        };
        room.parts.set(partId, part);
        room.updatedAt = Date.now();
        broadcastToRoom(
          room.roomCode,
          {
            type: 'part:move',
            partId,
            pos: part.pos,
            quat: part.quat,
            snapped: part.snapped,
            clientId: meta.clientId,
          },
          ws,
        );
      } else if (type === 'part:snap') {
        const partId = String(msg.partId || '');
        if (!partId || !msg.pos || !msg.quat) return;
        const part: PartSyncState = {
          id: partId,
          pos: msg.pos as Vec3,
          quat: msg.quat as Quat,
          snapped: true,
          lockedBy: null,
        };
        room.parts.set(partId, part);
        room.updatedAt = Date.now();
        broadcastToRoom(room.roomCode, {
          type: 'part:snap',
          partId,
          pos: part.pos,
          quat: part.quat,
          clientId: meta.clientId,
        });
      } else if (type === 'part:release') {
        const partId = String(msg.partId || '');
        const existing = room.parts.get(partId);
        if (existing && existing.lockedBy === meta.clientId) {
          existing.lockedBy = null;
          if (msg.pos) existing.pos = msg.pos as Vec3;
          if (msg.quat) existing.quat = msg.quat as Quat;
          broadcastToRoom(
            room.roomCode,
            {
              type: 'part:release',
              partId,
              pos: existing.pos,
              quat: existing.quat,
              clientId: meta.clientId,
            },
            ws,
          );
        }
      } else if (type === 'module:switch') {
        const moduleId = String(msg.moduleId || 'turbine').slice(0, 40);
        room.moduleId = moduleId;
        room.explodedAmount = 0;
        room.parts.clear();
        room.updatedAt = Date.now();
        broadcastToRoom(room.roomCode, {
          type: 'module:switch',
          moduleId,
          clientId: meta.clientId,
        });
      } else if (type === 'exploded:change') {
        const amount = Math.max(0, Math.min(1, Number(msg.amount ?? 0)));
        room.explodedAmount = amount;
        broadcastToRoom(
          room.roomCode,
          {
            type: 'exploded:change',
            amount,
            clientId: meta.clientId,
          },
          ws,
        );
      } else if (type === 'room:reset') {
        room.parts.clear();
        room.explodedAmount = 0;
        room.updatedAt = Date.now();
        broadcastToRoom(room.roomCode, {
          type: 'room:reset',
          clientId: meta.clientId,
        });
      } else if (type === 'annotation:add') {
        const text = String(msg.text || '').trim().slice(0, 80);
        if (!text || !msg.pos) return;
        const p = room.participants.get(meta.clientId);
        const annotation: AnnotationState = {
          id: `ann_${Date.now().toString(36)}`,
          author: p?.name || 'Peer',
          text,
          pos: msg.pos as Vec3,
          color: p?.color || '#38bdf8',
          createdAt: Date.now(),
        };
        room.annotations = [...room.annotations.slice(-11), annotation];
        broadcastToRoom(room.roomCode, {
          type: 'annotation:add',
          annotation,
        });
      } else if (type === 'voice:state') {
        const p = room.participants.get(meta.clientId);
        if (p) {
          p.voiceEnabled = Boolean(msg.voiceEnabled);
          p.muted = Boolean(msg.muted);
          p.lastSeen = Date.now();
          broadcastToRoom(room.roomCode, {
            type: 'voice:state',
            clientId: meta.clientId,
            voiceEnabled: p.voiceEnabled,
            muted: p.muted,
            participants: Array.from(room.participants.values()),
          });
        }
      } else if (type === 'webrtc:signal') {
        const targetId = String(msg.targetId || '');
        const signalType = String(msg.signalType || '');
        if (!targetId || !signalType) return;
        if (!room.participants.has(targetId)) return;
        const targetSocket = clientSockets.get(targetId);
        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(
            JSON.stringify({
              type: 'webrtc:signal',
              fromId: meta.clientId,
              signalType,
              payload: msg.payload ?? null,
            }),
          );
        }
      }
    });

    ws.on('close', () => {
      clientSockets.delete(clientId);
      removeClientFromRoom(ws);
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    // HMR is disabled in AI Studio; stub /@vite/client exports so CSS/TS modules load cleanly without opening an HMR WebSocket.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay {}
`);
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AeroLab XR server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AeroLab XR server:', err);
  process.exit(1);
});
