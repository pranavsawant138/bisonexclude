  'use client'    
                                                                                                                        
  import { useState, useRef, useCallback } from 'react'                                                               

  type FilterMode = 'not-contacted' | 'contacted'
  type DisplayMode = 'both' | 'emails' | 'domains'

  interface RawLead {
    id: number
    email: string
    updated_at?: string
    last_contacted_at?: string
    last_emailed_at?: string
    campaigns?: Array<{ id: number; name: string }>
    campaign?: { id: number; name: string } | string
    [key: string]: unknown
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

  function extractDomain(email: string): string {
    const at = email.indexOf('@')
    return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : ''
  }

  function getLastContacted(lead: RawLead): Date | null {
    const raw = lead.last_contacted_at || lead.last_emailed_at || lead.updated_at
    if (!raw) return null
    const d = new Date(raw as string)
    return isNaN(d.getTime()) ? null : d
  }

  function chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  }

  function formatDate(d: Date | null): string {
    if (!d) return 'Unknown'
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function copyToClipboard(text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
    } else {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
  }

  function loadWorkspaces(): Workspace[] {
    if (typeof window === 'undefined') return []
    try {
      return JSON.parse(localStorage.getItem('eb_workspaces') || '[]')
    } catch (e) {
      return []
    }
  }

  const displayModeOptions: Array<{ value: DisplayMode; label: string }> = [
    { value: 'both', label: 'Emails + Domains' },
    { value: 'emails', label: 'Emails only' },
    { value: 'domains', label: 'Domains only' },
  ]

  export default function Dashboard() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>(loadWorkspaces)
    const [wsName, setWsName] = useState('')
    const [wsKey, setWsKey] = useState('')
    const [showKey, setShowKey] = useState(false)
    const [selected, setSelected] = useState<Workspace | null>(null)

    const [filterMode, setFilterMode] = useState<FilterMode>('not-contacted')
    const [days, setDays] = useState(90)
    const [displayMode, setDisplayMode] = useState<DisplayMode>('both')

    const [leads, setLeads] = useState<ProcessedLead[]>([])
    const [loading, setLoading] = useState(false)
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' })
    const [error, setError] = useState('')
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    function saveWorkspace() {
      if (!wsName.trim() || !wsKey.trim()) return
      const updated = [
        ...workspaces.filter(w => w.name !== wsName.trim()),
        { name: wsName.trim(), apiKey: wsKey.trim() },
      ]
      setWorkspaces(updated)
      localStorage.setItem('eb_workspaces', JSON.stringify(updated))
      setWsName('')
      setWsKey('')
    }

    function removeWorkspace(name: string) {
      const updated = workspaces.filter(w => w.name !== name)
      setWorkspaces(updated)
      localStorage.setItem('eb_workspaces', JSON.stringify(updated))
      if (selected?.name === name) setSelected(null)
    }

    const fetchData = useCallback(async () => {
      if (!selected) return
      setLoading(true)
      setError('')
      setLeads([])
      setProgress({ current: 0, total: 0, status: 'Fetching campaigns...' })
      abortRef.current = new AbortController()

      try {
        await fetch('/api/campaigns', {
          headers: { 'x-api-key': selected.apiKey },
          signal: abortRef.current.signal,
        })

        setProgress(p => ({ ...p, status: 'Fetching leads...' }))
        const leadsRes = await fetch('/api/leads', {
          headers: { 'x-api-key': selected.apiKey },
          signal: abortRef.current.signal,
        })
        if (!leadsRes.ok) throw new Error('EmailBison returned ' + leadsRes.status)
        if (!leadsRes.body) throw new Error('No response body')

        const reader = leadsRes.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const allLeads: RawLead[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.error) throw new Error(parsed.error)
              allLeads.push(...(parsed.leads || []))
              setProgress({
                current: parsed.page,
                total: parsed.lastPage || parsed.page,
                status: 'Page ' + parsed.page + ' of ' + (parsed.lastPage || '?'),
              })
            } catch (e) {
              // skip malformed lines
            }
          }
        }

        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        const emailSeen = new Set<string>()
        const processed: ProcessedLead[] = []

        for (const lead of allLeads) {
          if (!lead.email) continue
          const email = (lead.email as string).toLowerCase().trim()
          if (emailSeen.has(email)) continue

          const lastContacted = getLastContacted(lead)
          const include =
            filterMode === 'not-contacted'
              ? !lastContacted || lastContacted < cutoff
              : !!lastContacted && lastContacted >= cutoff
          if (!include) continue

          const domain = extractDomain(email)
          const campaignNames: string[] = []

          if (Array.isArray(lead.campaigns)) {
            for (const c of lead.campaigns) {
              if (c && c.name) campaignNames.push(c.name)
            }
          } else if (lead.campaign) {
            const cn =
              typeof lead.campaign === 'object'
                ? (lead.campaign as { name?: string }).name
                : String(lead.campaign)
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
        setProgress(p => ({ ...p, status: 'Done — ' + processed.length.toLocaleString() + ' leads' }))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg !== 'AbortError') setError(msg || 'Something went wrong')
      } finally {
        setLoading(false)
      }
    }, [selected, filterMode, days])

    function stopFetch() {
      abortRef.current?.abort()
      setLoading(false)
    }

    function getDisplayItems(): string[] {
      if (leads.length === 0) return []
      if (displayMode === 'emails') {
        return leads.map(l => l.email)
      }
      if (displayMode === 'domains') {
        const seen = new Set<string>()
        const result: string[] = []
        for (const l of leads) {
          if (l.domain && !seen.has(l.domain)) {
            seen.add(l.domain)
            result.push(l.domain)
          }
        }
        return result
      }
      return leads.map(l =>
        [l.email, l.domain, formatDate(l.lastContacted), l.campaignNames.join(', ')].join('\t')
      )
    }

    function handleCopy(i: number, text: string) {
      copyToClipboard(text)
      setCopiedIdx(i)
      setTimeout(() => setCopiedIdx(null), 1500)
    }

    const displayItems = getDisplayItems()
    const chunks = chunkArray(displayItems, 10000)
    const uniqueDomains = [...new Set(leads.map(l => l.domain).filter(Boolean))]

    return (
      <div className="max-w-7xl mx-auto p-6 space-y-5">

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">EmailBison Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Filter leads, extract domains, export in bulk — read-only</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-800">Workspaces</h2>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="text"
              placeholder="Workspace / client name"
              value={wsName}
              onChange={e => setWsName(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-44 focus:ring-2
  focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <div className="relative flex-1 min-w-64">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="EmailBison API Key"
                value={wsKey}
                onChange={e => setWsKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveWorkspace() }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full pr-14 focus:ring-2
  focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={saveWorkspace}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700
  transition-colors"
            >
              Save
            </button>
          </div>

          {workspaces.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {workspaces.map(ws => (
                <div key={ws.name} className="flex items-center gap-0.5">
                  <button
                    onClick={() => setSelected(ws)}
                    className={`px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors ${
                      selected?.name === ws.name
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {ws.name}
                  </button>
                  <button
                    onClick={() => removeWorkspace(ws.name)}
                    className={`px-2 py-1.5 rounded-r-lg text-sm transition-colors ${
                      selected?.name === ws.name
                        ? 'bg-blue-500 text-white hover:bg-red-500'
                        : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500'
                    }`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-800">
              {'Filters — '}
              <span className="text-blue-600">{selected.name}</span>
            </h2>

            <div className="flex gap-4 flex-wrap items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Mode</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  <button
                    onClick={() => setFilterMode('not-contacted')}
                    className={`px-4 py-2 font-medium transition-colors border-r border-gray-300 ${
                      filterMode === 'not-contacted' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700
  hover:bg-gray-50'
                    }`}
                  >
                    Not contacted in X days
                  </button>
                  <button
                    onClick={() => setFilterMode('contacted')}
                    className={`px-4 py-2 font-medium transition-colors ${
                      filterMode === 'contacted' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Contacted in last X days
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Days</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-blue-500
  focus:border-blue-500 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Show</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  {displayModeOptions.map((opt, idx) => (
                    <button
                      key={opt.value}
                      onClick={() => setDisplayMode(opt.value)}
                      className={`px-3 py-2 font-medium transition-colors ${idx > 0 ? 'border-l border-gray-300' : ''}
  ${
                        displayMode === opt.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700
  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Fetching...' : 'Fetch Leads'}
                </button>
                {loading && (
                  <button
                    onClick={stopFetch}
                    className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600
  transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>

            {progress.status && (
              <div className="space-y-1.5">
                <div className="text-sm text-gray-500">{progress.status}</div>
                {progress.total > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all"
                      style={{ width: Math.min(100, (progress.current / progress.total) * 100) + '%' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        )}

        {leads.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{leads.length.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Matching Leads</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{uniqueDomains.length.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Unique Domains</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{chunks.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">Columns (10k ea.)</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">
                {filterMode === 'not-contacted' ? 'Not contacted' : 'Contacted'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{days} days filter</div>
            </div>
          </div>
        )}

        {chunks.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                {'Results — '}
                {displayItems.length.toLocaleString()}
                {' '}
                {displayMode === 'domains' ? 'domains' : displayMode === 'emails' ? 'emails' : 'entries'}
              </h2>
              {displayMode === 'both' && (
                <span className="text-xs text-gray-400">email · domain · last contacted · campaign</span>
              )}
            </div>

            <div
              className={`grid gap-4 ${
                chunks.length === 1
                  ? 'grid-cols-1'
                  : chunks.length === 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {chunks.map((ch, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <span className="text-sm font-medium text-gray-700">
                      {'Column ' + (i + 1) + ' '}
                      <span className="text-gray-400 font-normal">{'(' + ch.length.toLocaleString() + ')'}</span>
                    </span>
                    <button
                      onClick={() => handleCopy(i, ch.join('\n'))}
                      className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                        copiedIdx === i ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
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
