 'use client'                                                                                                                                                                                                    
                  
  import { useState, useRef } from 'react'                                                                                                                                                                        
                  
  type FilterMode = 'not-contacted' | 'contacted'
  type DisplayMode = 'both' | 'emails' | 'domains'

  interface RawLead {
    id: number
    email: string
    updated_at?: string
    created_at?: string
    last_contacted_at?: string
    last_emailed_at?: string
    campaigns?: Array<{ id: number; name: string }>
    campaign?: { id: number; name: string } | string
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

  function getLeadDate(lead: RawLead, field: 'updated_at' | 'created_at'): Date | null {
    const raw = field === 'created_at'
      ? lead.created_at
      : (lead.last_contacted_at || lead.last_emailed_at || lead.updated_at)
    if (!raw) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }

  function chunkStrings(arr: string[], size: number): string[][] {
    const result: string[][] = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  }

  function formatDate(d: Date | null): string {
    if (!d) return 'Unknown'
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function copyText(text: string): void {
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

  function loadSavedWorkspaces(): Workspace[] {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('eb_workspaces')
      return stored ? JSON.parse(stored) : []
    } catch (e) {
      return []
    }
  }

  function saveWorkspacesToStorage(workspaces: Workspace[]): void {
    localStorage.setItem('eb_workspaces', JSON.stringify(workspaces))
  }

  const DISPLAY_OPTIONS: Array<{ value: DisplayMode; label: string }> = [
    { value: 'both', label: 'Emails + Domains' },
    { value: 'emails', label: 'Emails only' },
    { value: 'domains', label: 'Domains only' },
  ]

  export default function Dashboard() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>(loadSavedWorkspaces)
    const [wsName, setWsName] = useState<string>('')
    const [wsKey, setWsKey] = useState<string>('')
    const [showKey, setShowKey] = useState<boolean>(false)
    const [selected, setSelected] = useState<Workspace | null>(null)
    const [filterMode, setFilterMode] = useState<FilterMode>('not-contacted')
    const [days, setDays] = useState<number>(90)
    const [displayMode, setDisplayMode] = useState<DisplayMode>('both')
    const [dateField, setDateField] = useState<'updated_at' | 'created_at'>('updated_at')
    const [leads, setLeads] = useState<ProcessedLead[]>([])
    const [loading, setLoading] = useState<boolean>(false)
    const [progressCurrent, setProgressCurrent] = useState<number>(0)
    const [progressTotal, setProgressTotal] = useState<number>(0)
    const [progressStatus, setProgressStatus] = useState<string>('')
    const [errorMsg, setErrorMsg] = useState<string>('')
    const [copiedIdx, setCopiedIdx] = useState<number>(-1)
    const abortRef = useRef<AbortController | null>(null)

    function addWorkspace(): void {
      const name = wsName.trim()
      const apiKey = wsKey.trim()
      if (!name || !apiKey) return
      const updated = workspaces.filter(w => w.name !== name).concat({ name, apiKey })
      setWorkspaces(updated)
      saveWorkspacesToStorage(updated)
      setWsName('')
      setWsKey('')
    }

    function deleteWorkspace(name: string): void {
      const updated = workspaces.filter(w => w.name !== name)
      setWorkspaces(updated)
      saveWorkspacesToStorage(updated)
      if (selected && selected.name === name) setSelected(null)
    }

    function buildDisplayItems(processedLeads: ProcessedLead[], mode: DisplayMode): string[] {
      if (mode === 'emails') {
        return processedLeads.map(l => l.email)
      }
      if (mode === 'domains') {
        const seen: Set<string> = new Set()
        const out: string[] = []
        for (const l of processedLeads) {
          if (l.domain && !seen.has(l.domain)) {
            seen.add(l.domain)
            out.push(l.domain)
          }
        }
        return out
      }
      return processedLeads.map(l => {
        return [l.email, l.domain, formatDate(l.lastContacted), l.campaignNames.join(', ')].join('\t')
      })
    }

    async function doFetch(): Promise<void> {
      if (!selected) return
      setLoading(true)
      setErrorMsg('')
      setLeads([])
      setProgressCurrent(0)
      setProgressTotal(0)
      setProgressStatus('Fetching campaigns...')
      abortRef.current = new AbortController()
      const signal = abortRef.current.signal

      try {
        await fetch('/api/campaigns', {
          headers: { 'x-api-key': selected.apiKey },
          signal,
        })

        setProgressStatus('Fetching leads...')
        const leadsRes = await fetch('/api/leads', {
          headers: { 'x-api-key': selected.apiKey },
          signal,
        })

        if (!leadsRes.ok) {
          throw new Error('EmailBison returned status ' + leadsRes.status)
        }
        if (!leadsRes.body) {
          throw new Error('No response body from leads API')
        }

        const reader = leadsRes.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        const allLeads: RawLead[] = []

        while (true) {
          const readResult = await reader.read()
          if (readResult.done) break
          buf += dec.decode(readResult.value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li]
            if (!line || !line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.error) throw new Error(parsed.error)
              const newLeads: RawLead[] = parsed.leads || []
              for (const l of newLeads) allLeads.push(l)
              setProgressCurrent(parsed.page || 0)
              setProgressTotal(parsed.lastPage || parsed.page || 0)
              setProgressStatus('Page ' + parsed.page + ' of ' + (parsed.lastPage || '?'))
            } catch (lineErr) {
              // skip bad line
            }
          }
        }

        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        const emailSeen: Set<string> = new Set()
        const processed: ProcessedLead[] = []

        for (let i = 0; i < allLeads.length; i++) {
          const lead = allLeads[i]
          if (!lead.email) continue
          const email = lead.email.toLowerCase().trim()
          if (emailSeen.has(email)) continue

          const lastContacted = getLeadDate(lead, dateField)
          let include: boolean
          if (filterMode === 'not-contacted') {
            include = !lastContacted || lastContacted < cutoff
          } else {
            include = lastContacted !== null && lastContacted >= cutoff
          }
          if (!include) continue

          const domain = extractDomain(email)
          const campaignNames: string[] = []

          if (Array.isArray(lead.campaigns)) {
            for (let ci = 0; ci < lead.campaigns.length; ci++) {
              const c = lead.campaigns[ci]
              if (c && c.name) campaignNames.push(c.name)
            }
          } else if (lead.campaign) {
            let cn = ''
            if (typeof lead.campaign === 'object') {
              cn = lead.campaign.name || ''
            } else {
              cn = String(lead.campaign)
            }
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
        setProgressStatus('Done — ' + processed.length.toLocaleString() + ' leads loaded')
      } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        if (errMsg.indexOf('AbortError') < 0) {
          setErrorMsg(errMsg || 'Something went wrong')
        }
      }

      setLoading(false)
    }

    function stopFetching(): void {
      if (abortRef.current) abortRef.current.abort()
      setLoading(false)
    }

    function handleCopyColumn(idx: number, text: string): void {
      copyText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(-1), 1500)
    }

    const displayItems: string[] = leads.length > 0 ? buildDisplayItems(leads, displayMode) : []
    const chunks: string[][] = chunkStrings(displayItems, 10000)

    const domainSet: Set<string> = new Set()
    for (const l of leads) {
      if (l.domain) domainSet.add(l.domain)
    }
    const uniqueDomainsCount = domainSet.size
    const progressPct = progressTotal > 0 ? Math.min(100, (progressCurrent / progressTotal) * 100) : 0

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
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-44 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <div className="relative flex-1 min-w-64">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="EmailBison API Key"
                value={wsKey}
                onChange={e => setWsKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addWorkspace() }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full pr-14 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={addWorkspace}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
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
                    className={
                      'px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors ' +
                      (selected && selected.name === ws.name
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
                    }
                  >
                    {ws.name}
                  </button>
                  <button
                    onClick={() => deleteWorkspace(ws.name)}
                    className={
                      'px-2 py-1.5 rounded-r-lg text-sm transition-colors ' +
                      (selected && selected.name === ws.name
                        ? 'bg-blue-500 text-white hover:bg-red-500'
                        : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500')
                    }
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
                    className={
                      'px-4 py-2 font-medium transition-colors border-r border-gray-300 ' +
                      (filterMode === 'not-contacted' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                    }
                  >
                    Not contacted in X days
                  </button>
                  <button
                    onClick={() => setFilterMode('contacted')}
                    className={
                      'px-4 py-2 font-medium transition-colors ' +
                      (filterMode === 'contacted' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                    }
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
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Date Field</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  <button
                    onClick={() => setDateField('updated_at')}
                    className={
                      'px-3 py-2 font-medium transition-colors border-r border-gray-300 ' +
                      (dateField === 'updated_at' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                    }
                  >
                    Updated At
                  </button>
                  <button
                    onClick={() => setDateField('created_at')}
                    className={
                      'px-3 py-2 font-medium transition-colors ' +
                      (dateField === 'created_at' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                    }
                  >
                    Created At
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Show</label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                  {DISPLAY_OPTIONS.map((opt, idx) => (
                    <button
                      key={opt.value}
                      onClick={() => setDisplayMode(opt.value)}
                      className={
                        'px-3 py-2 font-medium transition-colors ' +
                        (idx > 0 ? 'border-l border-gray-300 ' : '') +
                        (displayMode === opt.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50')
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={doFetch}
                  disabled={loading}
                  className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Fetching...' : 'Fetch Leads'}
                </button>
                {loading && (
                  <button
                    onClick={stopFetching}
                    className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>

            {progressStatus !== '' && (
              <div className="space-y-1.5">
                <div className="text-sm text-gray-500">{progressStatus}</div>
                {progressTotal > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all"
                      style={{ width: progressPct + '%' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {errorMsg !== '' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{errorMsg}</div>
        )}

        {leads.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{leads.length.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Matching Leads</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{uniqueDomainsCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Unique Domains</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{chunks.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">Columns (10k ea.)</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xl font-bold text-gray-900">{days}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {filterMode === 'not-contacted' ? 'Days since last contact' : 'Days lookback'}
              </div>
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
              className={
                'grid gap-4 ' +
                (chunks.length === 1
                  ? 'grid-cols-1'
                  : chunks.length === 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3')
              }
            >
              {chunks.map((ch, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <span className="text-sm font-medium text-gray-700">
                      {'Column ' + (i + 1) + ' (' + ch.length.toLocaleString() + ')'}
                    </span>
                    <button
                      onClick={() => handleCopyColumn(i, ch.join('\n'))}
                      className={
                        'text-xs px-3 py-1.5 rounded-md font-medium transition-colors ' +
                        (copiedIdx === i ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700')
                      }
                    >
                      {copiedIdx === i ? 'Copied!' : 'Copy All'}
                    </button>
                  </div>
                  <div className="p-3 max-h-80 overflow-y-auto">
                    <textarea
                      readOnly
                      value={ch.join('\n')}
                      rows={Math.min(15, ch.length)}
                      className="w-full text-xs font-mono text-gray-700 resize-none border-none outline-none bg-transparent leading-5"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && leads.length === 0 && selected !== null && errorMsg === '' && progressStatus === '' && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Select filters above and click Fetch Leads to get started.
          </div>
        )}

        {selected === null && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Add a workspace above to get started.
          </div>
        )}

      </div>
    )
  }
