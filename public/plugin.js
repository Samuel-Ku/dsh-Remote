/* DSH Remote 插件端快速状态面板 · 零依赖 */
'use strict'

const $ = (id) => document.getElementById(id)
const API = '/remote/admin/api'
const t = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key)
let latest = null
let busy = false
let usageBusy = false
let usageLoadedAt = 0
let usageData = null
const setup = window.DshSetup?.mount($('plugin-setup'), {
  base: '/remote/', start: () => toggleGateway(), console: () => openConsole(null,'diagnostics'), deviceKey: () => openConsole(null,'devices'),
})

function text(id, value) { const el = $(id); if (el) el.textContent = value == null ? '—' : String(value) }
function escapeText(value) { return String(value ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])) }
function openConsole(event, section = '') {
  event?.preventDefault()
  // Desktop 拒绝 dsh-app: 弹窗；在当前 iframe 导航，沿用宿主认证与抽屉。
  const target = '/remote/admin/' + (section ? '#remote/' + section : '')
  if (location.protocol === 'dsh-app:') location.assign(target)
  else window.open(target, '_blank', 'noopener')
}
function closePanel() { window.parent.postMessage({ source: 'dsh-remote-plugin', type: 'close' }, location.origin) }
function renderUsage(data, phase = '') {
  const target = $('plugin-cost-data')
  const html = window.DshInsights?.costHtml(data, phase, true, false, true) || t('errQuotaUnavailable')
  if (target && target.innerHTML !== html) target.innerHTML = html
}
async function loadUsage() {
  if (usageBusy) return
  usageBusy = true
  $('plugin-usage-refresh').disabled = true
  try {
    const res = await fetch(`${API}/cost`, { credentials: 'same-origin', signal: AbortSignal.timeout(20000), headers: { 'x-dsh-remote-client': 'plugin' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const out = await res.json()
    usageData = out
    renderUsage(out)
  } catch {
    renderUsage(usageData, 'error')
  } finally {
    usageLoadedAt = Date.now()
    usageBusy = false
    $('plugin-usage-refresh').disabled = false
  }
}

function setBusy(value) {
  busy = value
  $('plugin-primary').disabled = value
  if ($('plugin-toggle')) $('plugin-toggle').disabled = value
}

function render(st) {
  latest = st
  setup?.update(st)
  const gateway = st.mode === 'gateway' || st.gatewayRunning === true
  const authError = st.gatewayAuthError || ''
  const healthy = st.mode === 'gateway' && !authError && st.upstream?.reachable === true
  const model = typeof window !== 'undefined' ? window.DshRemoteUI?.derive(st) : null
  const installed = st.gatewayInstalled !== false
  const hero = $('plugin-hero')
  hero.classList.toggle('ok', healthy)
  hero.classList.toggle('warn', gateway && !healthy)
  hero.classList.toggle('off', !gateway)

  text('plugin-status', healthy ? t('statusOk') : gateway ? t('statusWarn') : installed ? t('statusStopped') : t('statusEmbedded'))
  text('plugin-status-desc', healthy
    ? t('onlineConnections', { count: model?.onlineCount ?? (st.devices || []).filter(d => d.online && (d.kind === 'app' || d.kind === 'web')).length })
    : authError || (gateway ? st.upstream?.reachable === false ? t('descWarn') : t('descUnknown') : installed ? t('descStopped') : t('descEmbedded')))
  text('plugin-status-meta', healthy ? t('metaOk') : gateway ? t('metaWarn') : installed ? t('metaStopped') : t('metaEmbedded'))

  const primary = $('plugin-primary')
  const hasClient = (st.devices || []).some(d => d.online && (d.kind === 'app' || d.kind === 'web'))
  const pairedBefore = (st.devices || []).some(d => d.kind === 'app' || d.kind === 'web') || st.deviceKeys?.entries?.length
  primary.textContent = healthy && !hasClient ? pairedBefore ? t('addPhone') : t('installApp') : healthy ? t('addPhone') : gateway ? t('checkConnection') : installed ? t('primaryStart') : t('primaryView')
  primary.dataset.action = healthy && typeof setup?.show === 'function' ? 'setup' : gateway ? 'console' : installed ? 'start' : 'console'
  text('plugin-toggle-label', gateway ? t('toggleStop') : t('toggleStart'))
  $('plugin-toggle-icon')?.setAttribute('data-morph-state', gateway ? 'open' : 'closed')
  $('plugin-toggle')?.classList.toggle('hidden', !installed)

  text('plugin-version', st.version ? 'v' + st.version : '—')
  text('plugin-gateway-version', gateway ? ('v' + (st.gatewayVersion || st.version || t('unknown'))) : t('notRunning'))
  text('plugin-devices', `${st.onlineCount || 0} / ${st.deviceCount || 0}`)
  text('plugin-host', (st.lanIPs || []).find(x => x && x !== '127.0.0.1') || st.host || '127.0.0.1')
  if (typeof window !== 'undefined' && window.DshRemoteUI) {
    const ui = window.DshRemoteUI
    const path = $('plugin-health-path'), list = $('plugin-client-list')
    const pathHtml = ui.pathHtml(model), clientHtml = ui.clientHtml(st)
    if (path && path.innerHTML !== pathHtml) path.innerHTML = pathHtml
    if (list && list.innerHTML !== clientHtml) list.innerHTML = clientHtml
    text('plugin-online-title', ui.t('online'))
    text('plugin-console', ui.t('console'))
    text('plugin-pair', ui.t('pair'))
    text('plugin-about', ui.t('help'))
    if ($('plugin-pair')) $('plugin-pair').disabled = !model.authenticated
    if (model.phase === 'ready') text('plugin-status', ui.t('ready'))
    else if (!authError) text('plugin-status', ui.t(model.phase))
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
    setup?.update(null)
    if (typeof window !== 'undefined' && window.DshRemoteUI) {
      const path = $('plugin-health-path')
      if (path) path.innerHTML = window.DshRemoteUI.pathHtml(window.DshRemoteUI.derive(null))
    }
    $('plugin-hero').classList.remove('ok', 'warn')
    $('plugin-hero').classList.add('off')
    text('plugin-status', t('statusUnreachable'))
    text('plugin-status-desc', t('descUnreachable'))
    text('plugin-status-meta', t('metaRetry'))
    $('plugin-error').textContent = t('errStateLoad', { error: escapeText(e.message || e) })
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
  try {
    await navigator.clipboard.writeText(token)
    const button = $('plugin-copy')
    const old = button.lastChild
    if (old) old.textContent = t('copied')
    setTimeout(() => { if (old) old.textContent = t('copyToken') }, 1400)
  } catch {
    $('plugin-error').textContent = t('errCopy')
    $('plugin-error').classList.remove('hidden')
  }
}

$('plugin-close').addEventListener('click', closePanel)
$('plugin-doctor')?.addEventListener('click', () => {
  const report=value=>{text('plugin-error',value);$('plugin-error').classList.remove('hidden')}
  if(typeof window.DshDoctorEntry?.open!=='function'){report(t('errDoctorLoad'));return}
  window.DshDoctorEntry.open({state:()=>latest,pluginMode:true,copy:async value=>{try{await navigator.clipboard.writeText(value);return true}catch{return false}},toast:report})
})
$('plugin-console').addEventListener('click', openConsole)
if (location.protocol === 'dsh-app:') $('plugin-about').addEventListener('click', openConsole)
$('plugin-toggle')?.addEventListener('click', toggleGateway)
$('plugin-copy')?.addEventListener('click', copyToken)
$('plugin-pair')?.addEventListener('click', () => {
  if ($('plugin-setup')) $('plugin-setup').hidden = false
  setup?.show(2)
})
$('plugin-primary').addEventListener('click', () => {
  if ($('plugin-primary').dataset.action === 'start') toggleGateway()
  else if ($('plugin-primary').dataset.action === 'setup' && setup?.show) {
    if ($('plugin-setup')) $('plugin-setup').hidden = false
    setup.show()
  }
  else openConsole()
})

function renderLangBtn() {
  const btn = $('plugin-lang')
  if (btn) btn.textContent = (window.I18N && window.I18N.lang === 'en') ? '中文' : 'EN'
}
$('plugin-lang')?.addEventListener('click', () => {
  if (!window.I18N) return
  window.I18N.setLang(window.I18N.lang === 'zh' ? 'en' : 'zh')
  renderLangBtn()
  // the shared panel modules pick the language when they render, so re-render them too
  if (latest) render(latest)
  else load()
  renderUsage(usageData)
})
if (window.I18N) window.I18N.init(window.PLUGIN_STR)
renderLangBtn()

load()
setInterval(load, 5000)
$('plugin-usage-refresh').addEventListener('click', loadUsage)
loadUsage()
setInterval(() => { if (document.visibilityState !== 'hidden' && Date.now() - usageLoadedAt >= 30000) void loadUsage() }, 30000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - usageLoadedAt >= 30000) void loadUsage() })
