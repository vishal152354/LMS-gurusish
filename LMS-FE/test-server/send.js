// Send test notifications to the running server.
//   node send.js "Title" "Message" [type] [target]
//   node send.js --demo            → a short scripted sequence
const BASE = process.env.NOTIFY_URL ?? 'http://localhost:4000'

async function send(body) {
  const r = await fetch(`${BASE}/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? r.statusText)
  console.log(`✓ "${body.title}" → ${body.target ?? 'all'} (${data.delivered} client${data.delivered === 1 ? '' : 's'})`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  if (process.argv[2] === '--demo') {
    const seq = [
      { target: 'professors', type: 'info', title: 'Asha R started “Unit 2 — Ohm’s law”', message: 'CS2023001 · 10 questions' },
      { target: 'students', type: 'info', title: 'New test available', message: 'Unit 2 — Ohm’s law is open on My tests.' },
      { target: 'professors', type: 'warning', title: 'Tab switch recorded', message: 'Rahul K left the test window (warning 1 of 3).' },
      { target: 'professors', type: 'success', title: 'Asha R finished', message: 'Scored 8 / 10 · grade A' },
    ]
    for (const n of seq) { await send(n); await sleep(1500) }
  } else {
    const [title = 'Test notification', message = 'Sent from test-server/send.js', type = 'info', target = 'all'] = process.argv.slice(2)
    await send({ title, message, type, target })
  }
} catch (e) {
  console.error(`✗ ${e.message} — is the server running? (npm run dev)`)
  process.exitCode = 1
}
