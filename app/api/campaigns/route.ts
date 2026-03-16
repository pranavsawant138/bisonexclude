 import { NextRequest } from 'next/server'                                                                                                                                                                       
                  
  export async function GET(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key')
    const baseUrl = req.headers.get('x-base-url') || 'https://personal.buzzlead.io'
    const workspaceId = req.headers.get('x-workspace-id')

    if (!apiKey) return Response.json({ error: 'No API key' }, { status: 401 })

    try {
      const allCampaigns: unknown[] = []
      let page = 1
      while (true) {
        const url = new URL(`${baseUrl}/api/campaigns`)
        url.searchParams.set('page', String(page))
        if (workspaceId) url.searchParams.set('team_id', workspaceId)
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!res.ok) break
        const data = await res.json()
        const campaigns = data.data || []
        for (const c of campaigns) allCampaigns.push(c)
        if (!data.links?.next || campaigns.length === 0) break
        page++
      }
      return Response.json({ campaigns: allCampaigns })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }
