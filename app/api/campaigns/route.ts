 import { NextRequest, NextResponse } from 'next/server'

  const BASE = 'https://app.emailbison.com/api'

  export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return NextResponse.json({ error: 'API key required' }, { status: 400 })

    try {
      const campaigns: any[] = []
      let page = 1, lastPage = 1
      do {
        const res = await fetch(`${BASE}/campaigns?page=${page}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!res.ok) break
        const data = await res.json()
        campaigns.push(...(data.data ?? []))
        lastPage = data.meta?.last_page ?? page
        page++
      } while (page <= lastPage)

      return NextResponse.json({ campaigns })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

