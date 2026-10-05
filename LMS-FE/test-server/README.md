# Notification test server

Local server for exercising Pariksha's real-time notification connections.
It is a development tool — the FastAPI backend does not emit notifications yet.

```bash
npm install
npm run dev        # nodemon, http://localhost:4000
npm run demo       # in another terminal: send a scripted sequence
npm run send -- "Hello" "From the CLI" success professors
```

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness + connected count |
| `GET /clients` | Who is connected (protocol, role, id) |
| `POST /notify` | `{ target, type, title, message }` — deliver a notification |
| `ws://…/socket.io` | Socket.IO — used by the React app (`auth: { role, id }`) |
| `ws://…/ws?role=&id=` | Raw WebSocket (`ws`) — send `{"event":"ping"}`, get `pong` |

`target` is `all`, `students`, `professors`, `student:<roll>` or `professor:<id>`.
Environment: `PORT` (default 4000), `CORS_ORIGINS` (default the Vite dev server).
