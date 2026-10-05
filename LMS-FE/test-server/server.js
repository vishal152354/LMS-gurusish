// Pariksha notification test server.
//
// Speaks two protocols so both kinds of client can be exercised:
//   • Socket.IO  (default path /socket.io) — what the React app connects with
//   • raw WebSocket at /ws                 — for wscat / browser devtools / load tests
//
// Clients identify themselves as a role + id:
//   Socket.IO: io(url, { auth: { role: 'student', id: 'CS2023001' } })
//   ws:        ws://localhost:4000/ws?role=professor&id=prof_default
//
// Send a notification:  POST /notify  { target, type, title, message }
//   target: "all" | "students" | "professors" | "student:<roll>" | "professor:<id>"
//   type:   "info" | "success" | "warning" | "error"

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { Server as SocketIOServer } from 'socket.io'

const PORT = Number(process.env.PORT ?? 4000)
const ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',')
const TYPES = new Set(['info', 'success', 'warning', 'error'])

const app = express()
app.use(cors({ origin: ORIGINS }))
app.use(express.json({ limit: '32kb' }))

const server = http.createServer(app)
const io = new SocketIOServer(server, { cors: { origin: ORIGINS } })
// noServer: socket.io owns /socket.io upgrades; only /ws is handed to ws.
// (Attaching ws with { server, path } makes it reject socket.io's upgrades.)
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') return
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ── connection registry (both protocols) ─────────────────────
/** @type {Map<string, {proto: 'socket.io'|'ws', role: string, id: string, connectedAt: string, send: (n: object) => void}>} */
const clients = new Map()

function rooms(role, id) {
  return ['all', `${role}s`, `${role}:${id}`]
}

io.on('connection', (socket) => {
  const role = socket.handshake.auth?.role === 'professor' ? 'professor' : 'student'
  const id = String(socket.handshake.auth?.id ?? 'anonymous')
  const key = `sio:${socket.id}`
  rooms(role, id).forEach((r) => socket.join(r))
  clients.set(key, { proto: 'socket.io', role, id, connectedAt: new Date().toISOString(), send: (n) => socket.emit('notification', n) })
  log(`+ socket.io ${role}:${id}  (${clients.size} connected)`)
  socket.on('disconnect', () => { clients.delete(key); log(`- socket.io ${role}:${id}  (${clients.size} connected)`) })
})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost')
  const role = url.searchParams.get('role') === 'professor' ? 'professor' : 'student'
  const id = url.searchParams.get('id') ?? 'anonymous'
  const key = `ws:${randomUUID()}`
  clients.set(key, { proto: 'ws', role, id, connectedAt: new Date().toISOString(), send: (n) => ws.send(JSON.stringify({ event: 'notification', data: n })) })
  log(`+ ws ${role}:${id}  (${clients.size} connected)`)
  ws.send(JSON.stringify({ event: 'welcome', data: { role, id } }))

  // heartbeat so dead connections are noticed
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return ws.send(JSON.stringify({ event: 'error', data: 'Messages must be JSON' })) }
    if (msg?.event === 'ping') ws.send(JSON.stringify({ event: 'pong', data: Date.now() }))
  })
  ws.on('close', () => { clients.delete(key); log(`- ws ${role}:${id}  (${clients.size} connected)`) })
})

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, 30_000)
wss.on('close', () => clearInterval(heartbeat))

// ── delivery ─────────────────────────────────────────────────
function matches(client, target) {
  if (target === 'all') return true
  if (target === 'students') return client.role === 'student'
  if (target === 'professors') return client.role === 'professor'
  const [role, ...rest] = target.split(':')
  const id = rest.join(':')
  return client.role === role && client.id.toUpperCase() === id.toUpperCase()
}

function deliver(target, payload) {
  const n = { id: randomUUID(), at: new Date().toISOString(), ...payload }
  let count = 0
  for (const c of clients.values()) if (matches(c, target)) { c.send(n); count++ }
  log(`→ ${target}: "${n.title}" delivered to ${count}`)
  return { notification: n, delivered: count }
}

// ── HTTP API ─────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, connected: clients.size }))

app.get('/clients', (_req, res) => {
  res.json([...clients.values()].map(({ send: _s, ...c }) => c))
})

app.post('/notify', (req, res) => {
  const { target = 'all', type = 'info', title, message } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: '"title" is required' })
  if (!TYPES.has(type)) return res.status(400).json({ error: `"type" must be one of ${[...TYPES].join(', ')}` })
  if (typeof target !== 'string' || !/^(all|students|professors|student:.+|professor:.+)$/.test(target)) {
    return res.status(400).json({ error: '"target" must be all | students | professors | student:<roll> | professor:<id>' })
  }
  res.json(deliver(target, { type, title: title.trim().slice(0, 140), message: typeof message === 'string' ? message.slice(0, 500) : undefined }))
})

server.listen(PORT, () => {
  log(`Pariksha notify test server on http://localhost:${PORT}`)
  log(`  socket.io  ws://localhost:${PORT}/socket.io   raw ws  ws://localhost:${PORT}/ws`)
  log(`  CORS origins: ${ORIGINS.join(', ')}`)
})

const shutdown = () => { log('shutting down'); io.close(); wss.close(); server.close(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
