  import { NextRequest } from 'next/server'

  export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key')
    const baseUrl = req.headers.get('x-base-url') || 'https://personal.buzzlead.io'

    if (!apiKey) return Response.json({ error: 'No API key' }, { status: 401 })

    try {
      const res = await fetch(`${baseUrl}/api/workspaces`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return Response.json({ error: `Upstream ${res.status}` }, { status: res.status })
      return Response.json(await res.json())
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }
