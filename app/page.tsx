 'use client'

  import { useState, useRef, useCallback } from 'react'

  // ── Types ──────────────────────────────────────────────────────────────────

  interface RawLead {
    id: number
    email: string
    updated_at?: string
    last_contacted_at?: string
    last_emailed_at?: string
    campaigns?: { id: number; name: string }[]
    campaign?: { id: number; name: string } | string
    [key: string]: any
  }

  interface ProcessedLead {
    email: string
    domain: string
    lastContacted: Date | null
    campaignNames: string[]
  }

  interface Workspace {
    name: string
    apiKey: string
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function extractDomain(email: string) {
    const parts = email.split('@')
    return parts.length === 2 ? parts[1].toLowerCase().trim() : ''
  }

  function getLastContacted(lead: RawLead): Date | null {
    const raw = lead.last_contacted_at || lead.last_emailed_at || lead.updated_at
    if (!raw) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }

  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  function fmtDate(d: Date | null) {
    if (!d) return 'Unknown'
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    })
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  export default function Dashboard() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
      if (typeof window === 'undefined') return []
      try { return JSON.parse(localStorage.getItem('eb_workspaces') || '[]') } catch { return [] }
    })
    const [wsName, setWsName] = useState('')
    const [wsKey, setWsKey] = useState('')
    const [showKey, setShowKey] = useState(false)
    const [selected, setSelected] = useState<Workspace | null>(null)

    const [filterMode, setFilterMode] = useState<'not-contacted' | 'contacted'>('not-contacted')
    const [days, setDays] = useState(90)
    const [displayMode, setDisplayMode] = useState<'both' | 'emails' | 'domains'>('both')

    const [leads, setLeads] = useState<ProcessedLead[]>([])
    const [loading, setLoading] = useState(false)
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' })
    const [error, setError] = useState('')
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    // ── Workspace management ───────────────────────────────────────────────

    const saveWorkspace = () => {
      if (!wsName.trim() || !wsKey.trim()) return
      const updated = [...workspaces.filter(w => w.name !== wsName.trim()), { name: wsName.trim(), apiKey: wsKey.trim()
  }]
      setWorkspaces(updated)
      localStorage.setItem('eb_workspaces', JSON.stringify(updated))
      setWsName(''); setWsKey('')
    }

    const removeWorkspace = (name: string) => {
      const updated = workspaces.filter(w => w.name !== name)
      setWorkspaces(updated)
      localStorage.setItem('eb_workspaces', JSON.stringify(updated))
      if (selected?.name === name) setSelected(null)
    }

    // ── Fetch ──────────────────────────────────────────────────────────────

    const fetchData = useCallback(async () => {
      if (!selected) return
      setLoading(true); setError(''); setLeads([])
      setProgress({ current: 0, total: 0, status: 'Fetching campaigns...' })
      abortRef.current = new AbortController()

      try {
        // 1. Campaigns
        const campaignsRes = await fetch('/api/campaigns', {
          headers: { 'x-api-key': selected.apiKey },
          signal: abortRef.current.signal,
        })
        const campaignData = campaignsRes.ok ? await campaignsRes.json() : { campaigns: [] }
        const campaigns: { id: number; name: string }[] = campaignData.campaigns || []

        // 2. Stream leads
        setProgress(p => ({ ...p, status: 'Fetching leads...' }))
        const leadsRes = await fetch('/api/leads', {
          headers: { 'x-api-key': selected.apiKey },
          signal: abortRef.current.signal,
        })
        if (!leadsRes.ok) throw new Error(`EmailBison returned ${leadsRes.status}`)
        if (!leadsRes.body) throw new Error('No response body')

        const reader = leadsRes.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        const allLeads: RawLead[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const ch = JSON.parse(line)
              if (ch.error) throw new Error(ch.error)
              allLeads.push(...(ch.leads || []))
              setProgress({ current: ch.page, total: ch.lastPage || ch.page, status: `Page ${ch.page} of ${ch.lastPage
  || '?'}` })
            } catch {}
          }
        }

        // 3. Process
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)

        const emailSeen = new Set<string>()
        const processed: ProcessedLead[] = []

        for (const lead of allLeads) {
          if (!lead.email) continue
          const email = lead.email.toLowerCase().trim()
          if (emailSeen.has(email)) continue

          const lastContacted = getLastContacted(lead)
          const include = filterMode === 'not-contacted'
            ? (!lastContacted || lastContacted < cutoff)
            : (!!lastContacted && lastContacted >= cutoff)
          if (!include) continue

          const domain = extractDomain(email)

          const campaignNames: string[] = []
          if (Array.isArray(lead.campaigns)) {
            for (const c of lead.campaigns) { if (c?.name) campaignNames.push(c.name) }
          } else if (lead.campaign) {
            const cn = typeof lead.campaign === 'object' ? lead.campaign?.name : String(lead.campaign)
            if (cn) campaignNames.push(cn)
          }

          emailSeen.add(email)
          processed.push({ email, domain, lastContacted, campaignNames })
        }

        processed.sort((a, b) => {
          if (!a.lastContacted && !b.lastContacted) return 0
          if (!a.lastContacted) return 1
          if (!b.lastContacted) return -1
          return b.lastContacted.getTime() - a.lastContacted.getTime()
        })

        setLeads(processed)
        setProgress(p => ({ ...p, status: `Done — ${processed.length.toLocaleString()} leads loaded` }))
      } catch (err: any) {
        if (err.name !== 'AbortError') setError(err.message || 'Something went wrong')
      } finally {
        setLoading(false)
      }
    }, [selected, filterMode, days])

    const stopFetch = () => { abortRef.current?.abort(); setLoading(false) }

    // ── Display ────────────────────────────────────────────────────────────

    const displayItems = (() => {
      if (leads.length === 0) return []
      if (displayMode === 'emails') return leads.map(l => l.email)
      if (displayMode === 'domains') {
        const seen = new Set<string>()
        return leads.flatMap(l => {
          if (!l.domain || seen.has(l.domain)) return []
          seen.add(l.domain); return [l.domain]
        })
      }
      // both: email | domain | date | campaigns
      return leads.map(l =>
        [l.email, l.domain, fmtDate(l.lastContacted), l.campaignNames.join(', ')].join('\t')
      )
    })()

    const chunks = chunk(displayItems, 10000)
    const uniqueDomains = [...new Set(leads.map(l => l.domain).filter(Boolean))]

    const handleCopy = (i: number, text: string) => {
      copyText(text)
      setCopiedIdx(i)
      setTimeout(() => setCopiedIdx(null), 1500)
    }

    // ── Render ─────────────────────────────────────────────────────────────

    return (
      <div className="max-w-7xl mx-auto p-6 space-y-5">

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">EmailBison Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Filter leads, extract domains, export in bulk — read-only mirror</p>
        </div>

        {/* Workspaces */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-800">Workspaces</h2>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="text" placeholder="Workspace / client name"
              value={wsName} onChange={e => setWsName(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-44 focus:ring-2
  focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <div className="relative flex-1 min-w-64">
              <input
                type={showKey ? 'text' : 'password'} placeholder="EmailBison API Key"
                value={wsKey} onChange={e => setWsKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveWorkspace()}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full pr-14 focus:ring-2
  focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs
  text-gray-400 hover:text-gray-600">
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button onClick={saveWorkspace} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium
  hover:bg-blue-700 transition-colors">
              Save
            </button>
          </div>

          {workspaces.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {workspaces.map(ws => (
                <div key={ws.name} className="flex items-center gap-0.5">
                  <button
                    onClick={() => setSelected(ws)}
                    className={`px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors ${selected?.name ===
  ws.name ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >{ws.name}</button>
                  <button onClick={() => removeWorkspace(ws.name)} className={`px-2 py-1.5 rounded-r-lg text-sm
  transition-colors ${selected?.name === ws.name ? 'bg-blue-500 text-white hover:bg-red-500' : 'bg-gray-100
  text-gray-400 hover:bg-red-100 hover:text-red-500'}`}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        {selected && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-800">
              Filters — <span className="text-blue-600">{selected.name}</span>
            </h2>

            <div className="flex gap-4 flex-wrap items-end">
              {/* Filter mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Mode</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  {(['not-contacted', 'contacted'] as const).map(m => (
                    <button key={m} onClick={() => setFilterMode(m)}
                      className={`px-4 py-2 font-medium transition-colors border-r border-gray-300 last:border-r-0
  ${filterMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                      {m === 'not-contacted' ? 'Not contacted in X days' : 'Contacted in last X days'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Days */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Days</label>
                <input type="number" min={1} value={days}
                  onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-blue-500
  focus:border-blue-500 outline-none"
                />
              </div>

              {/* Show mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Show</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  {([['both', 'Emails + Domains'], ['emails', 'Emails only'], ['domains', 'Domains only']] as
  const).map(([m, label]) => (
                    <button key={m} onClick={() => setDisplayMode(m)}
                      className={`px-3 py-2 font-medium transition-colors border-r border-gray-300 last:border-r-0
  ${displayMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button onClick={fetchData} disabled={loading}
                  className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700
  disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {loading ? 'Fetching...' : 'Fetch Leads'}
                </button>
                {loading && (
                  <button onClick={stopFetch} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium
  hover:bg-red-600 transition-colors">
                    Stop
                  </button>
                )}
              </div>
            </div>

            {/* Progress */}
            {progress.status && (
              <div className="space-y-1.5">
                <div className="text-sm text-gray-500">{progress.status}</div>
                {progress.total > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-blue-600 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        )}

        {/* Stats */}
        {leads.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              ['Matching Leads', leads.length.toLocaleString()],
              ['Unique Domains', uniqueDomains.length.toLocaleString()],
              ['Columns (10k ea.)', String(chunks.length)],
              ['Mode', filterMode === 'not-contacted' ? `Not contacted ${days}d` : `Contacted ${days}d`],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-xl font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {chunks.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                Results — {displayItems.length.toLocaleString()} {displayMode === 'domains' ? 'domains' : displayMode
  === 'emails' ? 'emails' : 'entries'}
              </h2>
              {displayMode === 'both' && (
                <span className="text-xs text-gray-400">Columns: email · domain · last contacted · campaign</span>
              )}
            </div>

            <div className={`grid gap-4 ${chunks.length === 1 ? 'grid-cols-1' : chunks.length === 2 ? 'grid-cols-1 
  md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
              {chunks.map((ch, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <span className="text-sm font-medium text-gray-700">
                      Column {i + 1} <span className="text-gray-400 font-normal">({ch.length.toLocaleString()})</span>
                    </span>
                    <button
                      onClick={() => handleCopy(i, ch.join('\n'))}
                      className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${copiedIdx === i ?
  'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                      {copiedIdx === i ? 'Copied!' : 'Copy All'}
                    </button>
                  </div>
                  <div className="p-3 max-h-80 overflow-y-auto">
                    <textarea
                      readOnly
                      value={ch.join('\n')}
                      rows={Math.min(15, ch.length)}
                      onClick={e => (e.target as HTMLTextAreaElement).select()}
                      className="w-full text-xs font-mono text-gray-700 resize-none border-none outline-none
  bg-transparent leading-5"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty states */}
        {!loading && leads.length === 0 && selected && !error && progress.status === '' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Select filters above and click <strong className="text-gray-600">Fetch Leads</strong> to get started.
          </div>
        )}
        {!selected && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Add a workspace above to get started.
          </div>
        )}
      </div>
    )
  }

