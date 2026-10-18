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

**Students** — sign in with roll number + name · *My tests* (to do / completed) · full-screen test with tab-switch monitoring · three question types: multiple choice (drag the option into the answer box, tap it, or press A–D), fill in the blank, and match the following (join each pair with a coloured line — tap one side then the other, or drag between the dots) · score and answers shown only after the last question · results with an answer donut and a question-by-question review · Ellie, the elephant guide.

**Teachers** — read-only content library (uploaded by the admin) · create tests by **ticking one or more content items** and choosing how many of each question type **and the marks for each type** (live total) · roster CSV upload · results with a **class performance chart** (every student's score against the class average), status filters, per-student answer charts and Excel export · live monitor · profile photo · automatic sign-out after inactivity.

**Admins** — separate sign-in (Admin tab) · **content library**: upload course material (PDF, DOCX, TXT, Markdown) with live processing progress, rename, delete unused items — teachers can't upload · view every teacher (tests and content per teacher), reset a teacher's password, remove unused accounts · view every student who has signed in, search, remove students with no attempts · **test results across all teachers**: average score by test chart, then any test's class chart, per-student answers and Excel export. Admins don't create accounts — students join themselves with roll number + name. The admin account comes from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `viva-webapp/.env` (see `.env.example`).

> Teacher pages live under `/teacher`; old `/professor/...` links redirect. The backend API keeps its `/professor` paths.

## Getting started

Requirements: Node 20+ (22 recommended) and the FastAPI backend running on `http://127.0.0.1:7860`.

```bash
npm install
npm run dev            # http://localhost:5173
```

In development Vite proxies `/student`, `/professor`, `/admin`, `/orchestrator`, `/audio` and `/health` to the backend, so no CORS setup is needed. Browser page loads of `/student/...`, `/teacher/...` and `/admin/...` are served by the React app; only API calls are forwarded.

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
  features/professor/ teacher pages: content, events, roster, results (+ class chart), live
  features/admin/     admin console: teachers, students, test results
  components/results/ shared results view (class chart, per-student table) for teachers and admins
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
