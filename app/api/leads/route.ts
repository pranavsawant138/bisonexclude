  import { NextRequest } from 'next/server'

  export const maxDuration = 300

  export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key')
    const baseUrl = req.headers.get('x-base-url') || 'https://personal.buzzlead.io'

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'No API key' }) + '\n', { status: 401 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let page = 1
          while (true) {
            const url = new URL(`${baseUrl}/api/leads`)
            url.searchParams.set('page', String(page))
            const res = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${apiKey}` },
            })
            if (!res.ok) {
              controller.enqueue(encoder.encode(JSON.stringify({ error: `API returned ${res.status}` }) + '\n'))
              break
            }
            const data = await res.json()
            const leads = data.data || []
            const lastPage = data.meta?.last_page || page
            controller.enqueue(encoder.encode(JSON.stringify({ leads, page, lastPage }) + '\n'))
            if (page >= lastPage || leads.length === 0) break
            page++
          }
        } catch (err) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: String(err) }) + '\n'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
  }
