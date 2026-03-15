 import { NextRequest } from 'next/server'

  const BASE = 'https://personal.buzzlead.io/api'

  export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response('API key required', { status: 400 })

    const enc = new TextEncoder()
    let closed = false

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          if (!closed) controller.enqueue(enc.encode(JSON.stringify(data) + '\n'))
        }
        try {
          let page = 1, lastPage = 1
          do {
            const res = await fetch(`${BASE}/leads?page=${page}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (!res.ok) { send({ error: `EmailBison API error: ${res.status}` }); break }
            const data = await res.json()
            lastPage = data.meta?.last_page ?? page
            send({ leads: data.data ?? [], page, lastPage })
            page++
          } while (page <= lastPage)
        } catch (err) {
          try { if (!closed) controller.enqueue(enc.encode(JSON.stringify({ error: String(err) }) + '\n')) } catch {}
        } finally {
          closed = true
          try { controller.close() } catch {}
        }
      },
      cancel() { closed = true },
    })

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

