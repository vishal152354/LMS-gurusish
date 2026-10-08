# Pariksha — React frontend (LMS-FE)

The Pariksha AI viva & assessment portal rebuilt as a React single-page app. It talks to the existing **FastAPI backend** (`viva-webapp/backend`, port 7860) over its current API — the backend is unchanged, so this app and the original HTML frontend can run side by side.

## Tech stack

| Area | Libraries |
|---|---|
| Core | React 19, TypeScript 5, Vite 6, React Router 7 |
| UI | Tailwind CSS 4 (+ tailwind-merge, class-variance-authority, clsx), Radix UI primitives with shadcn-style components in `src/components/ui`, Lucide icons, Recharts, Embla carousel, Sonner toasts |
| State & data | Redux Toolkit + React Redux with redux-persist, Axios, React Hook Form + Zod, Socket.IO client |
| Other | @dnd-kit (drag-and-drop answering), react-day-picker + moment (dates), react-easy-crop (profile photo), react-idle-timer (auto sign-out) |
| Tooling | ESLint 9 + typescript-eslint, standard-version, GitLab CI |
| Test server | Node.js, Express, ws, CORS, nodemon (+ Socket.IO) — `test-server/` |

## Features

**Students** — sign in with roll number + name · *My tests* (to do / completed) · full-screen test with tab-switch monitoring · three question types: **multiple choice** (drag the right option into the answer box, tap it, or press A–D), **fill in the blank** (type into the gap; small spelling slips are accepted) and **match the following** (drag or tap cards onto their items; partial marks per correct pair) · **answers and the score are revealed only after the last question** — the backend sends no correctness until then · results with an answer donut and a question-by-question review.

**Professors** — content upload with live processing progress, rename, delete · create tests by choosing **how many of each question type** (MCQ, fill in the blanks, match the following); the paper is generated from the knowledge graph in parallel batches, usually in under 30 seconds, with a live batch-by-batch progress bar · roster CSV upload · results with status filters, per-student answer charts (match pairs shown pair by pair) and Excel export · live monitor · notification bell · profile photo with cropping · automatic sign-out after inactivity.

**Ellie, the guide** — an animated elephant who walks users through every page with a spotlight tour the first time they visit (sign-in, tests, each question type, results, and every professor step). She cheers students on between questions without ever hinting at answers. The elephant button (bottom right) replays a page's tour, replays all tours, or turns Ellie off. Tours skip anything not on screen, support the keyboard (← → Esc) and respect reduced-motion settings.

## Getting started

Requirements: Node 20+ (22 recommended) and the FastAPI backend running on `http://127.0.0.1:7860`.

```bash
npm install
npm run dev            # http://localhost:5173
```

In development Vite proxies `/student`, `/professor`, `/orchestrator`, `/audio` and `/health` to the backend, so no CORS setup is needed. Browser page loads of `/student/...` and `/professor/...` are served by the React app; only API calls are forwarded.

Real-time notifications (optional):

```bash
cd test-server && npm install && npm run dev    # :4000
npm run demo                                    # sends a sample sequence
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` / `build:staging` / `build:production` | Type-check, then build with that mode's env file |
| `npm run preview` | Serve the built `dist/` |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript only |
| `npm run release` | standard-version: bump version from commits, update CHANGELOG, tag |

## Environment

| Variable | Meaning |
|---|---|
| `VITE_APP_ENV` | `development` / `staging` / `production` |
| `VITE_API_BASE_URL` | Backend origin. Empty in development (uses the proxy) |
| `VITE_SOCKET_URL` | Notification server (Socket.IO) |
| `VITE_IDLE_TIMEOUT_MINUTES` | Professor auto sign-out |
| `VITE_DEV_PROXY_TARGET` | Dev only — backend address for the proxy (default `http://127.0.0.1:7860`) |

Values live in `.env.development`, `.env.staging` and `.env.production`; put machine-specific overrides in `.env.*.local` (git-ignored). The staging/production URLs are placeholders — set your real hosts.

## Project layout

```
src/
  components/ui/      shadcn-style primitives (button, dialog, select, form, calendar, carousel, …)
  components/         app-level pieces (AnswerDonut, QuestionReview, NotificationBell, AvatarCropDialog, …)
  features/auth/      sign-in
  features/student/   tests list, test-taking (AnswerBoard = drag-and-drop), results
  features/professor/ content, events, roster, results, live
  hooks/              notification socket, integrity guard, idle sign-out, generation progress
  services/           Axios instance + typed API clients
  store/              Redux slices (auth, results, notifications) with persistence
  types/api.ts        backend response shapes
test-server/          notification test server
```

## Deployment

Vercel or Netlify hosts this app (`vercel.json` and `netlify.toml` are included); the FastAPI backend runs on a server behind Caddy. Step-by-step guide: [`../deploy/README.md`](../deploy/README.md).

## Notes

- **Notifications** — the FastAPI backend doesn't emit any yet; `test-server/` simulates them. To go live, have the backend `POST /notify` to a server like it.
- **Live monitor** — reads `/orchestrator/status`, which only counts sessions started through the backend's orchestrator flow, so roster-based tests may not appear there (same as the original dashboard).
- **CI** — `.gitlab-ci.yml` runs install → lint + typecheck → `build:staging` on `develop`, `build:production` on `main` and `vX.Y.Z` tags.
- **iCloud** — if this folder sits in an iCloud-synced Desktop, keep `node_modules` out of sync: `xattr -w 'com.apple.fileprovider.ignore#P' 1 node_modules` (already applied here).
