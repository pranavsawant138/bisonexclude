'use client'

  import { useState, useRef, useEffect } from 'react'

  type FilterMode = 'not-contacted' | 'contacted'
  type DisplayMode = 'both' | 'emails' | 'domains' | 'linkedin' | 'all'

  interface RawLead {
    id: number
    email: string
    first_name?: string
    last_name?: string
    company?: string
    title?: string
    updated_at?: string
    created_at?: string
    last_contacted_at?: string
    last_emailed_at?: string
    custom_variables?: Array<{ name: string; value: string }>
    lead_campaign_data?: Array<{ campaign_id: number; status: string }>
  }

  interface ProcessedLead {
    email: string
    firstName: string
    lastName: string
    company: string
    title: string
    domain: string
    lastContacted: Date | null
    campaignIds: number[]
    campaignNames: string[]
    linkedinUrl: string
    companyLinkedinUrl: string
    website: string
    employeeCount: string
    customVars: Record<string, string>
  }

  interface Instance {
    name: string
    baseUrl: string
    apiKey: string
  }

  interface Workspace {
    id: number
    name: string
  }

  interface Campaign {
    id: number
    name: string
    status: string
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

  function getCustomVar(lead: RawLead, name: string): string {
    if (!Array.isArray(lead.custom_variables)) return ''
    return lead.custom_variables.find(v => v.name === name)?.value || ''
  }

  function chunkStrings(arr: string[], size: number): string[][] {
    const result: string[][] = []
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
    return result
  }

  function formatDate(d: Date | null): string {
    if (!d) return ''
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

  function loadSavedInstances(): Instance[] {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('eb_instances')
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  }

  function saveInstancesToStorage(instances: Instance[]): void {
    localStorage.setItem('eb_instances', JSON.stringify(instances))
  }

  const DISPLAY_OPTIONS: Array<{ value: DisplayMode; label: string }> = [
    { value: 'both', label: 'Emails + Domains + Date' },
    { value: 'emails', label: 'Emails only' },
    { value: 'domains', label: 'Domains only' },
    { value: 'linkedin', label: 'LinkedIn only' },
    { value: 'all', label: 'All Data' },
  ]

  export default function Dashboard() {
    const [instances, setInstances] = useState<Instance[]>(loadSavedInstances)
    const [instName, setInstName] = useState('')
    const [instBaseUrl, setInstBaseUrl] = useState('')
    const [instApiKey, setInstApiKey] = useState('')
    const [showInstKey, setShowInstKey] = useState(false)
    const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)

    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
    const [loadingWorkspaces, setLoadingWorkspaces] = useState(false)

    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<number>>(new Set())
    const [loadingCampaigns, setLoadingCampaigns] = useState(false)
    const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false)
    const campaignDropdownRef = useRef<HTMLDivElement>(null)

    const [filterMode, setFilterMode] = useState<FilterMode>('not-contacted')
    const [days, setDays] = useState<string>('')
    const [dateField, setDateField] = useState<'updated_at' | 'created_at'>('updated_at')
    const [displayMode, setDisplayMode] = useState<DisplayMode>('both')

    const [leads, setLeads] = useState<ProcessedLead[]>([])
    const [loading, setLoading] = useState(false)
    const [progressCurrent, setProgressCurrent] = useState(0)
    const [progressTotal, setProgressTotal] = useState(0)
    const [progressStatus, setProgressStatus] = useState('')
    const [errorMsg, setErrorMsg] = useState('')
    const [copiedIdx, setCopiedIdx] = useState(-1)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (campaignDropdownRef.current && !campaignDropdownRef.current.contains(e.target as Node)) {
          setCampaignDropdownOpen(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
      if (!selectedInstance) {
        setWorkspaces([])
        setSelectedWorkspace(null)
        return
      }
      setLoadingWorkspaces(true)
      setSelectedWorkspace(null)
      setCampaigns([])
      setSelectedCampaignIds(new Set())
      setLeads([])
      setProgressStatus('')
      fetch('/api/workspaces', {
        headers: { 'x-api-key': selectedInstance.apiKey, 'x-base-url': selectedInstance.baseUrl },
      })
        .then(r => r.json())
        .then(data => setWorkspaces(data.data || []))
        .catch(() => setWorkspaces([]))
        .finally(() => setLoadingWorkspaces(false))
    }, [selectedInstance])

    useEffect(() => {
      if (!selectedInstance || !selectedWorkspace) {
        setCampaigns([])
        setSelectedCampaignIds(new Set())
        return
      }
      setLoadingCampaigns(true)
      setCampaigns([])
      setSelectedCampaignIds(new Set())
      setLeads([])
      setProgressStatus('')
      fetch('/api/campaigns', {
        headers: {
          'x-api-key': selectedInstance.apiKey,
          'x-base-url': selectedInstance.baseUrl,
          'x-workspace-id': String(selectedWorkspace.id),
        },
      })
        .then(r => r.json())
        .then(data => setCampaigns(data.campaigns || []))
        .catch(() => setCampaigns([]))
        .finally(() => setLoadingCampaigns(false))
    }, [selectedWorkspace])

    function saveInstance(): void {
      const name = instName.trim()
      const baseUrl = instBaseUrl.trim().replace(/\/$/, '')
      const apiKey = instApiKey.trim()
      if (!name || !baseUrl || !apiKey) return
      const updated = instances.filter(i => i.name !== name).concat({ name, baseUrl, apiKey })
      setInstances(updated)
      saveInstancesToStorage(updated)
      setInstName('')
      setInstBaseUrl('')
      setInstApiKey('')
    }

    function deleteInstance(name: string): void {
      const updated = instances.filter(i => i.name !== name)
      setInstances(updated)
      saveInstancesToStorage(updated)
      if (selectedInstance?.name === name) setSelectedInstance(null)
    }

    function toggleCampaign(id: number): void {
      setSelectedCampaignIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    function buildDisplayItems(processedLeads: ProcessedLead[], mode: DisplayMode): string[] {
      if (mode === 'emails') return processedLeads.map(l => l.email)

      if (mode === 'domains') {
        const seen = new Set<string>()
        const out: string[] = []
        for (const l of processedLeads) {
          if (l.domain && !seen.has(l.domain)) { seen.add(l.domain); out.push(l.domain) }
        }
        return out
      }

      if (mode === 'linkedin') {
        return processedLeads.map(l => l.linkedinUrl).filter(u => u !== '')
      }

      if (mode === 'all') {
        return processedLeads.map(l => [
          l.email,
          l.firstName,
          l.lastName,
          l.company,
          l.title,
          l.domain,
          l.website,
          l.employeeCount,
          l.linkedinUrl,
          l.companyLinkedinUrl,
          formatDate(l.lastContacted),
          l.campaignNames.join(', '),
        ].join('\t'))
      }

      // 'both'
      return processedLeads.map(l =>
        [l.email, l.domain, formatDate(l.lastContacted), l.campaignNames.join(', ')].join('\t')
      )
    }

    async function doFetch(): Promise<void> {
      if (!selectedInstance || !selectedWorkspace) return
      setLoading(true)
      setErrorMsg('')
      setLeads([])
      setProgressCurrent(0)
      setProgressTotal(0)
      setProgressStatus('Fetching leads...')
      abortRef.current = new AbortController()
      const signal = abortRef.current.signal

      try {
        const leadsRes = await fetch('/api/leads', {
          headers: {
            'x-api-key': selectedInstance.apiKey,
            'x-base-url': selectedInstance.baseUrl,
            'x-workspace-id': String(selectedWorkspace.id),
          },
          signal,
        })

        if (!leadsRes.ok) throw new Error('API returned ' + leadsRes.status)
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
              const parsed = JSON.parse(line)
              if (parsed.error) throw new Error(parsed.error)
              for (const l of (parsed.leads || [])) allLeads.push(l)
              setProgressCurrent(parsed.page || 0)
              setProgressTotal(parsed.lastPage || parsed.page || 0)
              setProgressStatus(`Page ${parsed.page} of ${parsed.lastPage || '?'}`)
            } catch { /* skip bad lines */ }
          }
        }

        const campaignMap: Record<number, string> = {}
        for (const c of campaigns) campaignMap[c.id] = c.name

        const daysNum = days.trim() === '' ? null : parseInt(days)
        const cutoff = daysNum !== null ? new Date() : null
        if (cutoff && daysNum !== null) cutoff.setDate(cutoff.getDate() - daysNum)

        const emailSeen = new Set<string>()
        const processed: ProcessedLead[] = []

        for (const lead of allLeads) {
          if (!lead.email) continue
          const email = lead.email.toLowerCase().trim()
          if (emailSeen.has(email)) continue

          const leadCampaignIds = (lead.lead_campaign_data || []).map(d => d.campaign_id)

          if (selectedCampaignIds.size > 0 && !leadCampaignIds.some(id => selectedCampaignIds.has(id))) continue

          if (cutoff) {
            const lastContacted = getLeadDate(lead, dateField)
            let include: boolean
            if (filterMode === 'not-contacted') {
              include = !lastContacted || lastContacted < cutoff
            } else {
              include = lastContacted !== null && lastContacted >= cutoff
            }
            if (!include) continue
          }

          const lastContacted = getLeadDate(lead, dateField)
          const domain = extractDomain(email)
          const customVars: Record<string, string> = {}
          for (const cv of (lead.custom_variables || [])) customVars[cv.name] = cv.value

          emailSeen.add(email)
          processed.push({
            email,
            firstName: lead.first_name || '',
            lastName: lead.last_name || '',
            company: lead.company || '',
            title: lead.title || '',
            domain,
            lastContacted,
            campaignIds: leadCampaignIds,
            campaignNames: leadCampaignIds.map(id => campaignMap[id]).filter(Boolean),
            linkedinUrl: customVars['person linkedin'] || '',
            companyLinkedinUrl: customVars['company linkedin url'] || '',
            website: customVars['website'] || '',
            employeeCount: customVars['employee count'] || '',
            customVars,
          })
        }

        processed.sort((a, b) => {
          if (!a.lastContacted && !b.lastContacted) return 0
          if (!a.lastContacted) return 1
          if (!b.lastContacted) return -1
          return b.lastContacted.getTime() - a.lastContacted.getTime()
        })

        setLeads(processed)
        setProgressStatus(`Done — ${processed.length.toLocaleString()} leads loaded`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('AbortError')) setErrorMsg(msg)
      }

      setLoading(false)
    }

    function stopFetching(): void {
      abortRef.current?.abort()
      setLoading(false)
    }

    function handleCopyColumn(idx: number, text: string): void {
      copyText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(-1), 1500)
    }

    const displayItems = leads.length > 0 ? buildDisplayItems(leads, displayMode) : []
    const chunks = chunkStrings(displayItems, 10000)
    const uniqueDomainsCount = new Set(leads.map(l => l.domain).filter(Boolean)).size
    const progressPct = progressTotal > 0 ? Math.min(100, (progressCurrent / progressTotal) * 100) : 0

    return (
      <div className="max-w-7xl mx-auto p-6 space-y-5">

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">EmailBison Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Filter leads, extract domains, export in bulk — read-only</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-800">Instances</h2>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="text"
              placeholder="Name (e.g. personal)"
              value={instName}
              onChange={e => setInstName(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-36 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              type="text"
              placeholder="Base URL (e.g. https://personal.buzzlead.io)"
              value={instBaseUrl}
              onChange={e => setInstBaseUrl(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-64 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <div className="relative flex-1 min-w-52">
              <input
                type={showInstKey ? 'text' : 'password'}
                placeholder="Super API Key"
                value={instApiKey}
                onChange={e => setInstApiKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveInstance() }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full pr-14 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={() => setShowInstKey(!showInstKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showInstKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={saveInstance}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
          </div>

          {instances.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {instances.map(inst => (
                <div key={inst.name} className="flex items-center gap-0.5">
                  <button
                    onClick={() => setSelectedInstance(inst)}
                    className={
                      'px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors ' +
                      (selectedInstance?.name === inst.name ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
                    }
                  >
                    {inst.name}
                  </button>
                  <button
                    onClick={() => deleteInstance(inst.name)}
                    className={
                      'px-2 py-1.5 rounded-r-lg text-sm transition-colors ' +
                      (selectedInstance?.name === inst.name ? 'bg-blue-500 text-white hover:bg-red-500' : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500')
                    }
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedInstance && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-800">
              Select Workspace — <span className="text-blue-600">{selectedInstance.name}</span>
            </h2>
            <div className="flex gap-4 flex-wrap items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Client Workspace</label>
                {loadingWorkspaces ? (
                  <div className="text-sm text-gray-400 py-2">Loading workspaces...</div>
                ) : (
                  <select
                    value={selectedWorkspace?.id || ''}
                    onChange={e => setSelectedWorkspace(workspaces.find(w => w.id === Number(e.target.value)) || null)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white min-w-52"
                  >
                    <option value="">Select workspace...</option>
                    {workspaces.map(ws => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedWorkspace && (
                <div className="space-y-1.5" ref={campaignDropdownRef}>
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Campaigns</label>
                  {loadingCampaigns ? (
                    <div className="text-sm text-gray-400 py-2">Loading campaigns...</div>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setCampaignDropdownOpen(!campaignDropdownOpen)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 min-w-52 text-left flex items-center justify-between gap-2 focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <span>
                          {selectedCampaignIds.size === 0 ? 'All Campaigns' : `${selectedCampaignIds.size} campaign${selectedCampaignIds.size > 1 ? 's' : ''} selected`}
                        </span>
                        <span className="text-gray-400 text-xs">▾</span>
                      </button>
                      {campaignDropdownOpen && (
                        <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-72 max-h-72 overflow-y-auto">
                          <div
                            onClick={() => { setSelectedCampaignIds(new Set()); setCampaignDropdownOpen(false) }}
                            className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-100"
                          >
                            All Campaigns
                          </div>
                          {campaigns.map(c => (
                            <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedCampaignIds.has(c.id)}
                                onChange={() => toggleCampaign(c.id)}
                                className="rounded"
                              />
                              <span className="flex-1 leading-snug">{c.name}</span>
                              <span className={
                                'text-xs px-1.5 py-0.5 rounded shrink-0 ' +
                                (c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')
                              }>
                                {c.status}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {selectedInstance && selectedWorkspace && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-800">
              Filters — <span className="text-blue-600">{selectedWorkspace.name}</span>
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
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Days (empty = all)</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  placeholder="All"
                  onChange={e => setDays(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28 focus:ring-2 focus:ring-blue-500 outline-none"
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
                  <button onClick={stopFetching} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">
                    Stop
                  </button>
                )}
              </div>
            </div>

            {progressStatus && (
              <div className="space-y-1.5">
                <div className="text-sm text-gray-500">{progressStatus}</div>
                {progressTotal > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: progressPct + '%' }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {errorMsg && (
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
              <div className="text-xl font-bold text-gray-900">{days || 'All'}</div>
              <div className="text-xs text-gray-500 mt-0.5">Days filter</div>
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
                {displayMode === 'domains' ? 'domains' : displayMode === 'emails' ? 'emails' : displayMode === 'linkedin' ? 'LinkedIn URLs' : 'entries'}
              </h2>
              {displayMode === 'both' && <span className="text-xs text-gray-400">email · domain · date · campaign</span>}
              {displayMode === 'all' && <span className="text-xs text-gray-400">email · first name · last name · company · title · domain · website · employee count · linkedin · company linkedin · date · campaigns</span>}
            </div>

            <div className={
              'grid gap-4 ' +
              (chunks.length === 1 ? 'grid-cols-1' : chunks.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3')
            }>
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

        {!loading && leads.length === 0 && selectedWorkspace && !errorMsg && !progressStatus && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Select filters above and click Fetch Leads to get started.
          </div>
        )}

        {!selectedInstance && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Add an instance above to get started.
          </div>
        )}
      </div>
    )
  }

  What changed: The All Data mode now explicitly outputs 12 tab-separated columns per row:

  Email | First Name | Last Name | Company | Title | Domain | Website | Employee Count | Person LinkedIn | Company LinkedIn | Date | Campaign Names

  Paste it into GitHub as app/page.tsx and you're done — no other files need changing.

✻ Worked for 3m 54s

❯ Okay, there is some formatting issue which I want fixed - So this is how it's looks like in the Dashboard and this is how it looks like in the Google sheet like it's not in the right format can you add in a table format so that I can copy it correctly? Like how  
  it's happening for Image 5                                                                                                                                                                                                                                             
  ⎿  [Image #3]
  ⎿  [Image #4]
  ⎿  [Image #5]

⏺ I can see the problem clearly from the screenshots. The All Data mode is including personalization 1 and personalization 2 custom variables which contain multi-line text with newlines — that's what's breaking the rows in Google Sheets. The fix is:

  1. Only include the specific useful fields (no dynamic custom vars)                                                                                                                                                                                                        
  2. Sanitize all values to strip newlines
                                                                                                                                                                                                                                                                             
  Here's the complete updated app/page.tsx — only the buildDisplayItems function and a new sanitize helper changed, everything else is identical:

  'use client'

  import { useState, useRef, useEffect } from 'react'

  type FilterMode = 'not-contacted' | 'contacted'
  type DisplayMode = 'both' | 'emails' | 'domains' | 'linkedin' | 'all'

  interface RawLead {
    id: number
    email: string
    first_name?: string
    last_name?: string
    company?: string
    title?: string
    updated_at?: string
    created_at?: string
    last_contacted_at?: string
    last_emailed_at?: string
    custom_variables?: Array<{ name: string; value: string }>
    lead_campaign_data?: Array<{ campaign_id: number; status: string }>
  }

  interface ProcessedLead {
    email: string
    firstName: string
    lastName: string
    company: string
    title: string
    domain: string
    lastContacted: Date | null
    campaignIds: number[]
    campaignNames: string[]
    linkedinUrl: string
    companyLinkedinUrl: string
    website: string
    employeeCount: string
    customVars: Record<string, string>
  }

  interface Instance {
    name: string
    baseUrl: string
    apiKey: string
  }

  interface Workspace {
    id: number
    name: string
  }

  interface Campaign {
    id: number
    name: string
    status: string
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

  function getCustomVar(lead: RawLead, name: string): string {
    if (!Array.isArray(lead.custom_variables)) return ''
    return lead.custom_variables.find(v => v.name === name)?.value || ''
  }

  // Removes newlines/carriage returns that would break spreadsheet rows
  function sanitize(val: string): string {
    return val.replace(/[\n\r]+/g, ' ').trim()
  }

  function chunkStrings(arr: string[], size: number): string[][] {
    const result: string[][] = []
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
    return result
  }

  function formatDate(d: Date | null): string {
    if (!d) return ''
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

  function loadSavedInstances(): Instance[] {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('eb_instances')
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  }

  function saveInstancesToStorage(instances: Instance[]): void {
    localStorage.setItem('eb_instances', JSON.stringify(instances))
  }

  const DISPLAY_OPTIONS: Array<{ value: DisplayMode; label: string }> = [
    { value: 'both', label: 'Emails + Domains + Date' },
    { value: 'emails', label: 'Emails only' },
    { value: 'domains', label: 'Domains only' },
    { value: 'linkedin', label: 'LinkedIn only' },
    { value: 'all', label: 'All Data' },
  ]

  export default function Dashboard() {
    const [instances, setInstances] = useState<Instance[]>(loadSavedInstances)
    const [instName, setInstName] = useState('')
    const [instBaseUrl, setInstBaseUrl] = useState('')
    const [instApiKey, setInstApiKey] = useState('')
    const [showInstKey, setShowInstKey] = useState(false)
    const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)

    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
    const [loadingWorkspaces, setLoadingWorkspaces] = useState(false)

    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<number>>(new Set())
    const [loadingCampaigns, setLoadingCampaigns] = useState(false)
    const [campaignDropdownOpen, setCampaignDropdownOpen] = useState(false)
    const campaignDropdownRef = useRef<HTMLDivElement>(null)

    const [filterMode, setFilterMode] = useState<FilterMode>('not-contacted')
    const [days, setDays] = useState<string>('')
    const [dateField, setDateField] = useState<'updated_at' | 'created_at'>('updated_at')
    const [displayMode, setDisplayMode] = useState<DisplayMode>('both')

    const [leads, setLeads] = useState<ProcessedLead[]>([])
    const [loading, setLoading] = useState(false)
    const [progressCurrent, setProgressCurrent] = useState(0)
    const [progressTotal, setProgressTotal] = useState(0)
    const [progressStatus, setProgressStatus] = useState('')
    const [errorMsg, setErrorMsg] = useState('')
    const [copiedIdx, setCopiedIdx] = useState(-1)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (campaignDropdownRef.current && !campaignDropdownRef.current.contains(e.target as Node)) {
          setCampaignDropdownOpen(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
      if (!selectedInstance) {
        setWorkspaces([])
        setSelectedWorkspace(null)
        return
      }
      setLoadingWorkspaces(true)
      setSelectedWorkspace(null)
      setCampaigns([])
      setSelectedCampaignIds(new Set())
      setLeads([])
      setProgressStatus('')
      fetch('/api/workspaces', {
        headers: { 'x-api-key': selectedInstance.apiKey, 'x-base-url': selectedInstance.baseUrl },
      })
        .then(r => r.json())
        .then(data => setWorkspaces(data.data || []))
        .catch(() => setWorkspaces([]))
        .finally(() => setLoadingWorkspaces(false))
    }, [selectedInstance])

    useEffect(() => {
      if (!selectedInstance || !selectedWorkspace) {
        setCampaigns([])
        setSelectedCampaignIds(new Set())
        return
      }
      setLoadingCampaigns(true)
      setCampaigns([])
      setSelectedCampaignIds(new Set())
      setLeads([])
      setProgressStatus('')
      fetch('/api/campaigns', {
        headers: {
          'x-api-key': selectedInstance.apiKey,
          'x-base-url': selectedInstance.baseUrl,
          'x-workspace-id': String(selectedWorkspace.id),
        },
      })
        .then(r => r.json())
        .then(data => setCampaigns(data.campaigns || []))
        .catch(() => setCampaigns([]))
        .finally(() => setLoadingCampaigns(false))
    }, [selectedWorkspace])

    function saveInstance(): void {
      const name = instName.trim()
      const baseUrl = instBaseUrl.trim().replace(/\/$/, '')
      const apiKey = instApiKey.trim()
      if (!name || !baseUrl || !apiKey) return
      const updated = instances.filter(i => i.name !== name).concat({ name, baseUrl, apiKey })
      setInstances(updated)
      saveInstancesToStorage(updated)
      setInstName('')
      setInstBaseUrl('')
      setInstApiKey('')
    }

    function deleteInstance(name: string): void {
      const updated = instances.filter(i => i.name !== name)
      setInstances(updated)
      saveInstancesToStorage(updated)
      if (selectedInstance?.name === name) setSelectedInstance(null)
    }

    function toggleCampaign(id: number): void {
      setSelectedCampaignIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    function buildDisplayItems(processedLeads: ProcessedLead[], mode: DisplayMode): string[] {
      if (mode === 'emails') return processedLeads.map(l => l.email)

      if (mode === 'domains') {
        const seen = new Set<string>()
        const out: string[] = []
        for (const l of processedLeads) {
          if (l.domain && !seen.has(l.domain)) { seen.add(l.domain); out.push(l.domain) }
        }
        return out
      }

      if (mode === 'linkedin') {
        return processedLeads.map(l => l.linkedinUrl).filter(u => u !== '')
      }

      if (mode === 'all') {
        // Header row first
        const header = [
          'Email', 'First Name', 'Last Name', 'Company', 'Title', 'Domain',
          'Website', 'Employee Count', 'Person LinkedIn', 'Company LinkedIn',
          'Date', 'Campaign',
        ].join('\t')

        const rows = processedLeads.map(l => [
          sanitize(l.email),
          sanitize(l.firstName),
          sanitize(l.lastName),
          sanitize(l.company),
          sanitize(l.title),
          sanitize(l.domain),
          sanitize(l.website),
          sanitize(l.employeeCount),
          sanitize(l.linkedinUrl),
          sanitize(l.companyLinkedinUrl),
          formatDate(l.lastContacted),
          sanitize(l.campaignNames.join(', ')),
        ].join('\t'))

        return [header, ...rows]
      }

      // 'both'
      return processedLeads.map(l =>
        [l.email, l.domain, formatDate(l.lastContacted), l.campaignNames.join(', ')].join('\t')
      )
    }

    async function doFetch(): Promise<void> {
      if (!selectedInstance || !selectedWorkspace) return
      setLoading(true)
      setErrorMsg('')
      setLeads([])
      setProgressCurrent(0)
      setProgressTotal(0)
      setProgressStatus('Fetching leads...')
      abortRef.current = new AbortController()
      const signal = abortRef.current.signal

      try {
        const leadsRes = await fetch('/api/leads', {
          headers: {
            'x-api-key': selectedInstance.apiKey,
            'x-base-url': selectedInstance.baseUrl,
            'x-workspace-id': String(selectedWorkspace.id),
          },
          signal,
        })

        if (!leadsRes.ok) throw new Error('API returned ' + leadsRes.status)
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
              const parsed = JSON.parse(line)
              if (parsed.error) throw new Error(parsed.error)
              for (const l of (parsed.leads || [])) allLeads.push(l)
              setProgressCurrent(parsed.page || 0)
              setProgressTotal(parsed.lastPage || parsed.page || 0)
              setProgressStatus(`Page ${parsed.page} of ${parsed.lastPage || '?'}`)
            } catch { /* skip bad lines */ }
          }
        }

        const campaignMap: Record<number, string> = {}
        for (const c of campaigns) campaignMap[c.id] = c.name

        const daysNum = days.trim() === '' ? null : parseInt(days)
        const cutoff = daysNum !== null ? new Date() : null
        if (cutoff && daysNum !== null) cutoff.setDate(cutoff.getDate() - daysNum)

        const emailSeen = new Set<string>()
        const processed: ProcessedLead[] = []

        for (const lead of allLeads) {
          if (!lead.email) continue
          const email = lead.email.toLowerCase().trim()
          if (emailSeen.has(email)) continue

          const leadCampaignIds = (lead.lead_campaign_data || []).map(d => d.campaign_id)

          if (selectedCampaignIds.size > 0 && !leadCampaignIds.some(id => selectedCampaignIds.has(id))) continue

          if (cutoff) {
            const lastContacted = getLeadDate(lead, dateField)
            let include: boolean
            if (filterMode === 'not-contacted') {
              include = !lastContacted || lastContacted < cutoff
            } else {
              include = lastContacted !== null && lastContacted >= cutoff
            }
            if (!include) continue
          }

          const lastContacted = getLeadDate(lead, dateField)
          const domain = extractDomain(email)
          const customVars: Record<string, string> = {}
          for (const cv of (lead.custom_variables || [])) customVars[cv.name] = cv.value

          emailSeen.add(email)
          processed.push({
            email,
            firstName: lead.first_name || '',
            lastName: lead.last_name || '',
            company: lead.company || '',
            title: lead.title || '',
            domain,
            lastContacted,
            campaignIds: leadCampaignIds,
            campaignNames: leadCampaignIds.map(id => campaignMap[id]).filter(Boolean),
            linkedinUrl: customVars['person linkedin'] || '',
            companyLinkedinUrl: customVars['company linkedin url'] || '',
            website: customVars['website'] || '',
            employeeCount: customVars['employee count'] || '',
            customVars,
          })
        }

        processed.sort((a, b) => {
          if (!a.lastContacted && !b.lastContacted) return 0
          if (!a.lastContacted) return 1
          if (!b.lastContacted) return -1
          return b.lastContacted.getTime() - a.lastContacted.getTime()
        })

        setLeads(processed)
        setProgressStatus(`Done — ${processed.length.toLocaleString()} leads loaded`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('AbortError')) setErrorMsg(msg)
      }

      setLoading(false)
    }

    function stopFetching(): void {
      abortRef.current?.abort()
      setLoading(false)
    }

    function handleCopyColumn(idx: number, text: string): void {
      copyText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(-1), 1500)
    }

    const displayItems = leads.length > 0 ? buildDisplayItems(leads, displayMode) : []
    const chunks = chunkStrings(displayItems, 10000)
    const uniqueDomainsCount = new Set(leads.map(l => l.domain).filter(Boolean)).size
    const progressPct = progressTotal > 0 ? Math.min(100, (progressCurrent / progressTotal) * 100) : 0

    return (
      <div className="max-w-7xl mx-auto p-6 space-y-5">

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">EmailBison Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Filter leads, extract domains, export in bulk — read-only</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-800">Instances</h2>
          <div className="flex gap-3 flex-wrap items-center">
            <input
              type="text"
              placeholder="Name (e.g. personal)"
              value={instName}
              onChange={e => setInstName(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-36 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <input
              type="text"
              placeholder="Base URL (e.g. https://personal.buzzlead.io)"
              value={instBaseUrl}
              onChange={e => setInstBaseUrl(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-64 focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <div className="relative flex-1 min-w-52">
              <input
                type={showInstKey ? 'text' : 'password'}
                placeholder="Super API Key"
                value={instApiKey}
                onChange={e => setInstApiKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveInstance() }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full pr-14 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={() => setShowInstKey(!showInstKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              >
                {showInstKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={saveInstance}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
          </div>

          {instances.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {instances.map(inst => (
                <div key={inst.name} className="flex items-center gap-0.5">
                  <button
                    onClick={() => setSelectedInstance(inst)}
                    className={
                      'px-3 py-1.5 rounded-l-lg text-sm font-medium transition-colors ' +
                      (selectedInstance?.name === inst.name ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
                    }
                  >
                    {inst.name}
                  </button>
                  <button
                    onClick={() => deleteInstance(inst.name)}
                    className={
                      'px-2 py-1.5 rounded-r-lg text-sm transition-colors ' +
                      (selectedInstance?.name === inst.name ? 'bg-blue-500 text-white hover:bg-red-500' : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500')
                    }
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedInstance && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-800">
              Select Workspace — <span className="text-blue-600">{selectedInstance.name}</span>
            </h2>
            <div className="flex gap-4 flex-wrap items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Client Workspace</label>
                {loadingWorkspaces ? (
                  <div className="text-sm text-gray-400 py-2">Loading workspaces...</div>
                ) : (
                  <select
                    value={selectedWorkspace?.id || ''}
                    onChange={e => setSelectedWorkspace(workspaces.find(w => w.id === Number(e.target.value)) || null)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white min-w-52"
                  >
                    <option value="">Select workspace...</option>
                    {workspaces.map(ws => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedWorkspace && (
                <div className="space-y-1.5" ref={campaignDropdownRef}>
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Campaigns</label>
                  {loadingCampaigns ? (
                    <div className="text-sm text-gray-400 py-2">Loading campaigns...</div>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setCampaignDropdownOpen(!campaignDropdownOpen)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 min-w-52 text-left flex items-center justify-between gap-2 focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <span>
                          {selectedCampaignIds.size === 0 ? 'All Campaigns' : `${selectedCampaignIds.size} campaign${selectedCampaignIds.size > 1 ? 's' : ''} selected`}
                        </span>
                        <span className="text-gray-400 text-xs">▾</span>
                      </button>
                      {campaignDropdownOpen && (
                        <div className="absolute top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-72 max-h-72 overflow-y-auto">
                          <div
                            onClick={() => { setSelectedCampaignIds(new Set()); setCampaignDropdownOpen(false) }}
                            className="px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-100"
                          >
                            All Campaigns
                          </div>
                          {campaigns.map(c => (
                            <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedCampaignIds.has(c.id)}
                                onChange={() => toggleCampaign(c.id)}
                                className="rounded"
                              />
                              <span className="flex-1 leading-snug">{c.name}</span>
                              <span className={
                                'text-xs px-1.5 py-0.5 rounded shrink-0 ' +
                                (c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')
                              }>
                                {c.status}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {selectedInstance && selectedWorkspace && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-800">
              Filters — <span className="text-blue-600">{selectedWorkspace.name}</span>
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
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Days (empty = all)</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  placeholder="All"
                  onChange={e => setDays(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28 focus:ring-2 focus:ring-blue-500 outline-none"
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
                  <button onClick={stopFetching} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">
                    Stop
                  </button>
                )}
              </div>
            </div>

            {progressStatus && (
              <div className="space-y-1.5">
                <div className="text-sm text-gray-500">{progressStatus}</div>
                {progressTotal > 0 && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: progressPct + '%' }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {errorMsg && (
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
              <div className="text-xl font-bold text-gray-900">{days || 'All'}</div>
              <div className="text-xs text-gray-500 mt-0.5">Days filter</div>
            </div>
          </div>
        )}

        {chunks.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">
                {'Results — '}
                {displayMode === 'all' ? (displayItems.length - 1).toLocaleString() : displayItems.length.toLocaleString()}
                {' '}
                {displayMode === 'domains' ? 'domains' : displayMode === 'emails' ? 'emails' : displayMode === 'linkedin' ? 'LinkedIn URLs' : 'leads'}
              </h2>
              {displayMode === 'both' && <span className="text-xs text-gray-400">email · domain · date · campaign</span>}
              {displayMode === 'all' && <span className="text-xs text-gray-400">Email · First Name · Last Name · Company · Title · Domain · Website · Employee Count · Person LinkedIn · Company LinkedIn · Date · Campaign</span>}
            </div>

            <div className={
              'grid gap-4 ' +
              (chunks.length === 1 ? 'grid-cols-1' : chunks.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3')
            }>
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

        {!loading && leads.length === 0 && selectedWorkspace && !errorMsg && !progressStatus && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Select filters above and click Fetch Leads to get started.
          </div>
        )}

        {!selectedInstance && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Add an instance above to get started.
          </div>
        )}
      </div>
    )
  }

