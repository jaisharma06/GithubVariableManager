import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'

const app = express()
const port = process.env.PORT ?? 8787

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json())

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)

app.listen(port, () => {
  console.log(`OAuth exchange server listening on http://localhost:${port}`)
})
