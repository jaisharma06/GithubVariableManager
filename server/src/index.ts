import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'

const app = express()
const port = process.env.PORT ?? 8787

// Comma-separated so both the live app (client/, :4200) and the archived React app
// (archive/web/, :5173 — see its own README for why it's still around) can reach this relay
// without either accidentally locking the other out.
const DEFAULT_WEB_ORIGINS = ['http://localhost:4200', 'http://localhost:5173']
const webOrigins = process.env.WEB_ORIGIN
  ? process.env.WEB_ORIGIN.split(',').map((origin) => origin.trim())
  : DEFAULT_WEB_ORIGINS

app.use(cors({ origin: webOrigins }))
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)

app.listen(port, () => {
  console.log(`OAuth exchange server listening on http://localhost:${port}`)
})
