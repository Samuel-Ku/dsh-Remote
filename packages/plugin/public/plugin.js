/* DSH Remote 插件端快速状态面板 · 零依赖 */
'use strict'

const $ = (id) => document.getElementById(id)
const API = '/remote/admin/api'
const t = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key)
let latest = null
let lastDays = []
let busy = false
let usageBusy = false
let usageLoadedAt = 0

function text(id, value) { const el = $(id); if (el) el.textContent = value == null ? '—' : String(value) }
function escapeText(value) { return String(value ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])) }
function openConsole(event) {
  event?.preventDefault()
  // Desktop 拒绝 dsh-app: 弹窗；在当前 iframe 导航，沿用宿主认证与抽屉。
  if (location.protocol === 'dsh-app:') location.assign('/remote/admin/')
  else window.open('/remote/admin/', '_blank', 'noopener')
}
function closePanel() { window.parent.postMessage({ source: 'dsh-remote-plugin', type: 'close' }, location.origin) }
function fmtTokens(value) {
  const n = Number(value) || 0
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K'
  return String(Math.round(n))
}
function fmtCost(value) { return '¥' + (Number(value) || 0).toFixed(2) }
function renderUsage(days) {
  const section = $('plugin-usage')
  const empty = $('plugin-usage-empty')
  if (!section) return
  if (Array.isArray(days) && days.length) lastDays = days
  if (!Array.isArray(days) || !days.length) {
    section.classList.add('empty')
    empty?.classList.remove('hidden')
    text('plugin-usage-date', '—')
    text('plugin-token-total', '—')
    text('plugin-peak-share', '0%')
    text('plugin-cost', '—')
    text('plugin-cost-split', t('costWaiting'))
    if ($('plugin-token-track')) $('plugin-token-track').innerHTML = ''
    $('plugin-usage-ring')?.style.setProperty('--plugin-peak', '0%')
    return
  }
  const today = days[days.length - 1] || {}
  const total = today.total || {}
  const input = Number(total.input) || 0
  const cache = (Number(total.cacheRead) || 0) + (Number(total.cacheWrite) || 0)
  const output = Number(total.output) || 0
  const totalTokens = input + cache + output
  const peakCost = Number(today.peak?.cost) || 0
  const offCost = Number(today.off?.cost) || 0
  const totalCost = peakCost + offCost
  const peakShare = totalCost > 0 ? Math.round(peakCost / totalCost * 100) : 0
  const share = (n) => totalTokens ? Math.max(0, n / totalTokens * 100) : 0
  section.classList.remove('empty')
  empty?.classList.add('hidden')
  text('plugin-usage-date', today.date || '—')
  text('plugin-token-total', fmtTokens(totalTokens))
  text('plugin-peak-share', peakShare + '%')
  text('plugin-cost', fmtCost(totalCost))
  text('plugin-cost-split', t('costSplit', { peak: fmtCost(peakCost), off: fmtCost(offCost) }))
  const track = $('plugin-token-track')
  if (track) track.innerHTML = `<i class="input" style="width:${share(input)}%"></i><i class="cache" style="width:${share(cache)}%"></i><i class="output" style="width:${share(output)}%"></i>`
  $('plugin-usage-ring')?.style.setProperty('--plugin-peak', peakShare + '%')
}
async function loadUsage() {
  if (usageBusy) return
  usageBusy = true
  try {
    const res = await fetch(`${API}/stats/summary?days=7`, { headers: { 'x-dsh-remote-client': 'plugin' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const out = await res.json()
    renderUsage(out.days || [])
  } catch {
    renderUsage([])
  } finally {
    usageLoadedAt = Date.now()
    usageBusy = false
  }
}

function setBusy(value) {
  busy = value
  $('plugin-primary').disabled = value
  $('plugin-toggle').disabled = value
}

function render(st) {
  latest = st
  const gateway = st.mode === 'gateway' || st.gatewayRunning === true
  const authError = st.gatewayAuthError || ''
  const healthy = gateway && !authError && st.upstream?.reachable !== false
  const installed = st.gatewayInstalled !== false
  const hero = $('plugin-hero')
  hero.classList.toggle('ok', healthy)
  hero.classList.toggle('warn', gateway && !healthy)
  hero.classList.toggle('off', !gateway)

  text('plugin-status', healthy ? t('statusOk') : gateway ? t('statusWarn') : installed ? t('statusStopped') : t('statusEmbedded'))
  text('plugin-status-desc', healthy
    ? t('descOk', { devices: st.onlineCount || 0, reqs: st.totalRequests || 0 })
    : authError || (gateway ? t('descWarn') : installed ? t('descStopped') : t('descEmbedded')))
  text('plugin-status-meta', healthy ? t('metaOk') : gateway ? t('metaWarn') : installed ? t('metaStopped') : t('metaEmbedded'))

  const primary = $('plugin-primary')
  primary.textContent = gateway ? t('primaryConsole') : installed ? t('primaryStart') : t('primaryView')
  primary.dataset.action = gateway ? 'console' : installed ? 'start' : 'console'
  text('plugin-toggle-label', gateway ? t('toggleStop') : t('toggleStart'))
  $('plugin-toggle-icon')?.setAttribute('data-morph-state', gateway ? 'open' : 'closed')
  $('plugin-toggle').classList.toggle('hidden', !installed)

  text('plugin-version', st.version ? 'v' + st.version : '—')
  text('plugin-gateway-version', gateway ? ('v' + (st.gatewayVersion || st.version || t('unknown'))) : t('notRunning'))
  text('plugin-devices', `${st.onlineCount || 0} / ${st.deviceCount || 0}`)
  text('plugin-host', (st.lanIPs || []).find(x => x && x !== '127.0.0.1') || st.host || '127.0.0.1')
  if (!gateway) {
    usageLoadedAt = Date.now()
    renderUsage([])
  } else if (Date.now() - usageLoadedAt > 30000) {
    loadUsage()
  }
  $('plugin-error').classList.add('hidden')
}

let stateLoadPromise = null
async function load() {
  if (stateLoadPromise) return stateLoadPromise
  stateLoadPromise = readState().finally(() => { stateLoadPromise = null })
  return stateLoadPromise
}
async function readState() {
  try {
    const res = await fetch(`${API}/state`, { headers: { 'x-dsh-remote-client': 'plugin' },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    render(await res.json())
  } catch (e) {
    $('plugin-hero').classList.remove('ok', 'warn')
    $('plugin-hero').classList.add('off')
    text('plugin-status', t('statusUnreachable'))
    text('plugin-status-desc', t('descUnreachable'))
    text('plugin-status-meta', t('metaRetry'))
    $('plugin-error').textContent = t('errStateLoad', { error: e.message || e })
    $('plugin-error').classList.remove('hidden')
  }
}

async function toggleGateway() {
  if (busy) return
  setBusy(true)
  const action = latest?.mode === 'gateway' || latest?.gatewayRunning === true ? 'stop' : 'start'
  try {
    const res = await fetch(`${API}/gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-remote-client': 'plugin' },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const out = await res.json()
    if (!out.ok) throw new Error(out.error || t('errGatewayIncomplete'))
    await new Promise(resolve => setTimeout(resolve, 650))
    await load()
  } catch (e) {
    $('plugin-error').textContent = t('errGatewayOp', { error: e.message || e })
    $('plugin-error').classList.remove('hidden')
  } finally { setBusy(false) }
}

async function copyToken() {
  const token = latest?.token || ''
  if (!token) return
  const label = $('plugin-copy-label') || $('plugin-copy')?.lastChild
  try {
    await navigator.clipboard.writeText(token)
    if (label) label.textContent = t('copied')
    setTimeout(() => { if (label) label.textContent = t('copyToken') }, 1400)
  } catch {
    $('plugin-error').textContent = t('errCopy')
    $('plugin-error').classList.remove('hidden')
  }
}

function renderLangBtn() {
  const btn = $('plugin-lang')
  if (btn) btn.textContent = (window.I18N && window.I18N.lang === 'en') ? '中文' : 'EN'
}

$('plugin-close').addEventListener('click', closePanel)
$('plugin-console').addEventListener('click', openConsole)
if (location.protocol === 'dsh-app:') $('plugin-about').addEventListener('click', openConsole)
$('plugin-toggle').addEventListener('click', toggleGateway)
$('plugin-copy').addEventListener('click', copyToken)
$('plugin-primary').addEventListener('click', () => {
  if ($('plugin-primary').dataset.action === 'start') toggleGateway()
  else openConsole()
})
$('plugin-lang')?.addEventListener('click', () => {
  if (!window.I18N) return
  window.I18N.setLang(window.I18N.lang === 'zh' ? 'en' : 'zh')
  renderLangBtn()
  if (latest) render(latest)
  else load()
  renderUsage(lastDays)
})

if (window.I18N) window.I18N.init(window.PLUGIN_STR)
renderLangBtn()
load()
loadUsage()
setInterval(load, 5000)
setInterval(loadUsage, 30000)
