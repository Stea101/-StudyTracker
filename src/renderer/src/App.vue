<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, toRaw } from 'vue'
import ToolsView from './components/ToolsView.vue'
import PomodoroView from './components/PomodoroView.vue'
import StatsView from './components/StatsView.vue'
import HeatmapView from './components/HeatmapView.vue'
import NewsView from './components/NewsView.vue'
import DecisionView from './components/DecisionView.vue'
import CheckinView from './components/CheckinView.vue'
import CheckinToday from './components/CheckinToday.vue'
import { pad, fmtDate as formatDate, parseDate } from './lib/date'

const todayStr = formatDate(new Date())

// ---------- 状态 ----------
const records = reactive({}) // 全部已保存记录
const selectedDate = ref(todayStr)
const completed = ref('')
const plan = ref('')
const todayDraft = reactive({ completed: '', plan: '' }) // 今日未保存草稿
const showHistory = ref(false)
const showSettings = ref(false)
const motto = ref('')
const mottoDraft = ref('')
const savedTip = ref(false)
const saveError = ref(false)
let savedTipTimer = null

// ---------- 设置（模块化） ----------
const settingsView = ref('menu') // 'menu' | 'motto' | 'apiKey' | 'feedback'
const settingOptions = [
  { id: 'motto', icon: '💬', label: '座右铭', desc: '设置显示在窗口顶部的激励语' },
  { id: 'apiKey', icon: '🔑', label: '新闻 API 密钥', desc: '查看或修改新闻接口密钥' },
  { id: 'feedback', icon: '✉️', label: '问题反馈', desc: '把问题或建议一键发送给开发者' }
]
const apiKeyMasked = ref('')
const showApiKeyEdit = ref(false)
const apiKeyDraft = ref('')
const apiKeyError = ref('')
const apiKeySaved = ref(false)
let apiKeySavedTimer = null

// ---------- 设置 · 问题反馈 ----------
// 开发者邮箱不写死在代码里：由主进程从 .env 读取后经 IPC 提供，未配置时为空字符串
const feedbackEmail = ref('')
const feedbackContent = ref('')
const feedbackSending = ref(false)
const feedbackSent = ref(false)
const feedbackFailure = ref(null) // { reason, error, email, body, clientName }
const feedbackCopied = ref('') // 'email' | 'body' | ''
// 每次发送前都让用户选一次邮件软件（Windows 会把 mailto 默认程序记住，不再询问）
const mailPickerOpen = ref(false)
const mailPickerLoading = ref(false)
const mailClients = ref([]) // [{ id, name, exeName }]
let feedbackSentTimer = null
let feedbackCopiedTimer = null

// ---------- 工具模块 / 番茄钟 ----------
const currentView = ref('main') // 'main' | 'tools' | 'pomodoro' | 'heatmap' | 'news' | 'decision' | 'stats' | 'checkin'
const pomodoro = reactive({}) // { [date]: { sessions, seconds } }
const pomodoroSettings = reactive({ focusMinutes: 25, restMinutes: 5 })

// ---------- 打卡计划 ----------
const checkinPlans = ref([]) // [{ id, name, repeat, customDays, startDate, endDate, slots[] }]
const checkinLogs = reactive({}) // { [planId]: { [date]: { [slotId]: { at, ts } } } }
const checkinTip = ref('')
const checkinError = ref('')
let checkinTipTimer = null
let checkinErrorTimer = null

// 每秒走动的时钟：让首页「一键打卡」按打卡时段实时切换状态与倒计时。
// 打卡相关逻辑统一以 todayKey 为准（跨零点后自动进入新的一天）。
const now = ref(new Date())
const todayKey = computed(() => formatDate(now.value))
let clockTimer = null

// ---------- 计算属性 ----------
const isToday = computed(() => selectedDate.value === todayStr)
const canEdit = computed(() => isToday.value)
const title = computed(() => (isToday.value ? '📚 今日打卡' : `📅 ${selectedDate.value}`))

const todayRecord = computed(() => records[todayStr])
const isDirty = computed(() => {
  if (!isToday.value) return false
  const saved = todayRecord.value
  return completed.value !== (saved ? saved.completed : '') || plan.value !== (saved ? saved.plan : '')
})

const sortedDates = computed(() => {
  const keys = new Set([...Object.keys(records), ...Object.keys(pomodoro)])
  return [...keys].sort((a, b) => (a < b ? 1 : -1))
})
const tomorrowDisabled = computed(() => selectedDate.value >= todayStr)

// 番茄钟：今日专注统计（n 次专注学习，共 m 分钟）
const pomodoroMinutes = (entry) => (entry && entry.seconds ? Math.round(entry.seconds / 60) : 0)
const todayPomodoroText = computed(() => {
  const p = pomodoro[todayStr]
  if (!p || !p.sessions) return ''
  return `今日进行了 ${p.sessions} 次专注学习，一共 ${pomodoroMinutes(p)} 分钟。`
})

// 昨日写下的「明日计划」→ 今日参考（只读展示）
const yesterdayStr = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return formatDate(d)
})()
const yesterdayPlan = computed(() => {
  const rec = records[yesterdayStr]
  return rec && rec.plan ? rec.plan : ''
})

// 今日是否已保存过打卡（保存后才能查看新闻）
const hasSavedToday = computed(() => !!records[todayStr])

// ---------- 方法 ----------
function selectDate(dateStr) {
  selectedDate.value = dateStr
  if (dateStr === todayStr) {
    completed.value = todayDraft.completed
    plan.value = todayDraft.plan
  } else {
    const rec = records[dateStr]
    completed.value = rec ? rec.completed : ''
    plan.value = rec ? rec.plan : ''
  }
}

function goYesterday() {
  const d = parseDate(selectedDate.value)
  d.setDate(d.getDate() - 1)
  selectDate(formatDate(d))
}

function goTomorrow() {
  if (tomorrowDisabled.value) return
  const d = parseDate(selectedDate.value)
  d.setDate(d.getDate() + 1)
  selectDate(formatDate(d))
}

function goToday() {
  selectDate(todayStr)
}

// ---------- 工具模块 ----------
function openTools() {
  currentView.value = 'tools'
}

function backToMain() {
  currentView.value = 'main'
}

function openTool(id) {
  if (id === 'pomodoro') currentView.value = 'pomodoro'
  else if (id === 'heatmap') currentView.value = 'heatmap'
  else if (id === 'news') currentView.value = 'news'
  else if (id === 'decision') currentView.value = 'decision'
  else if (id === 'checkin') currentView.value = 'checkin'
}

function backToTools() {
  currentView.value = 'tools'
}

function openStats() {
  showHistory.value = false
  currentView.value = 'stats'
}

// 番茄钟：记录一次专注学习（累计次数与秒数，按天归档）
function recordFocusSession(elapsedSeconds) {
  const secs = Math.max(0, Math.round(elapsedSeconds))
  const entry = pomodoro[todayStr] || { sessions: 0, seconds: 0 }
  entry.sessions += 1
  entry.seconds += secs
  pomodoro[todayStr] = entry
  persistPomodoro()
}

async function persistPomodoro() {
  try {
    await window.api.writeData({ pomodoro: toRaw(pomodoro) })
  } catch (err) {
    console.error('保存番茄钟记录失败:', err)
  }
}

async function savePomodoroSettings(settings) {
  pomodoroSettings.focusMinutes = settings.focusMinutes
  pomodoroSettings.restMinutes = settings.restMinutes
  try {
    await window.api.writeData({ pomodoroSettings: toRaw(pomodoroSettings) })
  } catch (err) {
    console.error('保存番茄钟设置失败:', err)
  }
}

// ---------- 打卡计划：新增 / 修改 / 删除 / 一键打卡 ----------
function flashCheckinError(message) {
  checkinError.value = message
  clearTimeout(checkinErrorTimer)
  checkinErrorTimer = setTimeout(() => (checkinError.value = ''), 3000)
}

async function saveCheckinPlan(plan) {
  const list = toRaw(checkinPlans.value).map((p) => ({ ...p }))
  const index = list.findIndex((p) => p.id === plan.id)
  if (index >= 0) list[index] = plan
  else list.push(plan)
  try {
    await window.api.writeData({ checkinPlans: list })
    checkinPlans.value = list
  } catch (err) {
    console.error('保存打卡计划失败:', err)
    flashCheckinError('⚠️ 打卡计划保存失败，请重试')
  }
}

async function deleteCheckinPlan(id) {
  const list = toRaw(checkinPlans.value).filter((p) => p.id !== id)
  const logs = { ...toRaw(checkinLogs) }
  delete logs[id]
  try {
    await window.api.writeData({ checkinPlans: list, checkinLogs: logs })
    checkinPlans.value = list
    delete checkinLogs[id]
  } catch (err) {
    console.error('删除打卡计划失败:', err)
    flashCheckinError('⚠️ 删除失败，请重试')
  }
}

// 一键打卡：以当前时间记录到 checkinLogs[planId][date][slotId]
async function doCheckin({ planId, slotId, date }) {
  const t = new Date()
  const at = `${pad(t.getHours())}:${pad(t.getMinutes())}`
  if (!checkinLogs[planId]) checkinLogs[planId] = {}
  if (!checkinLogs[planId][date]) checkinLogs[planId][date] = {}
  checkinLogs[planId][date][slotId] = { at, ts: t.getTime() }

  const plan = checkinPlans.value.find((p) => p.id === planId)
  const slot = plan ? (plan.slots || []).find((s) => s.id === slotId) : null
  checkinTip.value = `✓ ${slot ? slot.name : '打卡'} 打卡成功（${at}）`
  clearTimeout(checkinTipTimer)
  checkinTipTimer = setTimeout(() => (checkinTip.value = ''), 2500)

  try {
    await window.api.writeData({ checkinLogs: toRaw(checkinLogs) })
  } catch (err) {
    console.error('保存打卡记录失败:', err)
    flashCheckinError('⚠️ 打卡记录保存失败，请重试')
  }
}

async function saveToday() {
  if (!isToday.value) return
  const record = { completed: completed.value, plan: plan.value }
  // toRaw 剥离 Vue 响应式代理：否则含历史日期的记录经 IPC 结构化克隆时会抛 DataCloneError，导致静默保存失败
  const nextRecords = { ...toRaw(records), [todayStr]: record }
  try {
    await window.api.writeData({ motto: motto.value, records: nextRecords })
    records[todayStr] = record
    todayDraft.completed = completed.value
    todayDraft.plan = plan.value
    savedTip.value = true
    clearTimeout(savedTipTimer)
    savedTipTimer = setTimeout(() => (savedTip.value = false), 2000)
  } catch (err) {
    console.error('保存失败:', err)
    saveError.value = true
    clearTimeout(savedTipTimer)
    savedTipTimer = setTimeout(() => (saveError.value = false), 3000)
  }
}

function openSettings() {
  mottoDraft.value = motto.value
  settingsView.value = 'menu'
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
}

function backToSettingsMenu() {
  settingsView.value = 'menu'
  showApiKeyEdit.value = false
  apiKeyError.value = ''
  closeMailPicker()
}

async function openSettingOption(id) {
  if (id === 'motto') {
    mottoDraft.value = motto.value
    settingsView.value = 'motto'
  } else if (id === 'apiKey') {
    settingsView.value = 'apiKey'
    showApiKeyEdit.value = false
    apiKeyError.value = ''
    apiKeySaved.value = false
    await loadApiKey()
  } else if (id === 'feedback') {
    settingsView.value = 'feedback'
    feedbackSending.value = false
    feedbackSent.value = false
    feedbackFailure.value = null
    feedbackCopied.value = ''
    closeMailPicker()
  }
}

// ---------- 问题反馈 ----------
// 复制文本：优先使用 clipboard API，file:// 等场景下回退到 execCommand
async function copyText(text, tag) {
  let ok = false
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  } catch {
    ok = false
  }
  if (!ok) {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.top = '-1000px'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(el)
  }
  feedbackCopied.value = ok ? tag : ''
  if (ok) {
    clearTimeout(feedbackCopiedTimer)
    feedbackCopiedTimer = setTimeout(() => (feedbackCopied.value = ''), 2000)
  }
  return ok
}

function closeFeedbackFailure() {
  feedbackFailure.value = null
  feedbackCopied.value = ''
}

function closeMailPicker() {
  mailPickerOpen.value = false
  mailClients.value = []
}

// 点击「一键发送反馈」：先枚举本机已安装的邮件软件，弹窗让用户每次自己选，
// 避免 Windows 记住上次的 mailto 默认程序后不再询问。
async function startSendFeedback() {
  if (feedbackSending.value || mailPickerLoading.value) return
  feedbackSent.value = false
  feedbackFailure.value = null
  feedbackCopied.value = ''
  mailClients.value = []
  mailPickerOpen.value = true
  mailPickerLoading.value = true
  try {
    const list = await window.api.listMailClients()
    mailClients.value = Array.isArray(list) ? list : []
  } catch (err) {
    console.error('获取本机邮件软件列表失败:', err)
    mailClients.value = []
  } finally {
    mailPickerLoading.value = false
  }
}

// 用用户本次选定的邮件软件发送（clientId 为 'default' 表示跟随系统默认）
async function sendFeedbackWith(clientId) {
  if (feedbackSending.value) return
  mailPickerOpen.value = false
  feedbackSending.value = true
  feedbackSent.value = false
  feedbackFailure.value = null
  feedbackCopied.value = ''
  try {
    const result = await window.api.openFeedbackMail({
      content: feedbackContent.value,
      clientId
    })
    if (result && result.ok) {
      feedbackSent.value = true
      clearTimeout(feedbackSentTimer)
      feedbackSentTimer = setTimeout(() => (feedbackSent.value = false), 5000)
    } else {
      feedbackFailure.value = {
        reason: (result && result.reason) || 'open-failed',
        error: (result && result.error) || '',
        email: (result && result.email) || feedbackEmail.value,
        body: (result && result.body) || feedbackContent.value,
        clientName: (result && result.clientName) || ''
      }
    }
  } catch (err) {
    console.error('拉起邮件客户端失败:', err)
    feedbackFailure.value = {
      reason: 'open-failed',
      error: (err && err.message) || '',
      email: feedbackEmail.value,
      body: feedbackContent.value,
      clientName: ''
    }
  } finally {
    feedbackSending.value = false
  }
}

// 失败窗口里的标题 / 说明文案（区分「没装邮件软件」「指定软件启动失败」等情况）
function feedbackFailureTitle(failure) {
  if (failure.reason === 'not-configured') return '⚠️ 本版本未配置反馈邮箱'
  if (failure.reason === 'no-mail-client') return '⚠️ 没有检测到可用的邮件软件'
  if (failure.reason === 'client-missing') return '⚠️ 选中的邮件软件已不可用'
  if (failure.reason === 'client-launch-failed') return '⚠️ 启动邮件软件失败'
  return '⚠️ 无法打开邮件软件'
}

function feedbackFailureDesc(failure) {
  if (failure.reason === 'not-configured') {
    return '当前构建没有配置开发者邮箱，无法一键发送。请到项目仓库的 Issues 页面提交问题或建议，并附上下面的邮件内容。'
  }
  if (failure.reason === 'no-mail-client') {
    return '没有检测到本机已安装并注册的邮件客户端。请手动把问题或建议发送到下面的开发者邮箱：'
  }
  if (failure.reason === 'client-missing') {
    return '之前选择的邮件软件可能已被卸载，请重新选择。你也可以手动把问题或建议发送到下面的开发者邮箱：'
  }
  if (failure.reason === 'client-launch-failed') {
    return `启动「${failure.clientName || '所选邮件软件'}」失败。你可以换一个邮件软件重试，或手动把问题或建议发送到下面的开发者邮箱：`
  }
  return '拉起邮件客户端失败。请手动把问题或建议发送到下面的开发者邮箱：'
}

async function loadApiKey() {
  try {
    const result = await window.api.getApiKey()
    apiKeyMasked.value = (result && result.masked) || ''
  } catch (err) {
    console.error('读取 API 密钥失败:', err)
    apiKeyMasked.value = ''
  }
}

function startApiKeyEdit() {
  showApiKeyEdit.value = true
  apiKeyDraft.value = ''
  apiKeyError.value = ''
  apiKeySaved.value = false
}

function cancelApiKeyEdit() {
  showApiKeyEdit.value = false
  apiKeyDraft.value = ''
  apiKeyError.value = ''
}

async function saveApiKey() {
  const value = apiKeyDraft.value.trim()
  if (!value) {
    apiKeyError.value = 'API 密钥不能为空'
    return
  }
  try {
    const result = await window.api.saveApiKey(value)
    if (result && result.ok) {
      apiKeyMasked.value = result.masked || ''
      showApiKeyEdit.value = false
      apiKeyDraft.value = ''
      apiKeyError.value = ''
      apiKeySaved.value = true
      clearTimeout(apiKeySavedTimer)
      apiKeySavedTimer = setTimeout(() => (apiKeySaved.value = false), 2000)
    } else {
      apiKeyError.value = (result && result.error) || '保存失败，请重试'
    }
  } catch (err) {
    console.error('保存 API 密钥失败:', err)
    apiKeyError.value = '保存失败，请重试'
  }
}

async function saveMotto() {
  try {
    await window.api.writeData({ motto: mottoDraft.value, records: toRaw(records) })
    motto.value = mottoDraft.value
    showSettings.value = false
    savedTip.value = true
    clearTimeout(savedTipTimer)
    savedTipTimer = setTimeout(() => (savedTip.value = false), 2000)
  } catch (err) {
    console.error('保存座右铭失败:', err)
    saveError.value = true
    clearTimeout(savedTipTimer)
    savedTipTimer = setTimeout(() => (saveError.value = false), 3000)
  }
}

// 编辑今日时实时同步草稿，避免切换到历史再切回来时丢失未保存内容
watch([completed, plan], () => {
  if (isToday.value) {
    todayDraft.completed = completed.value
    todayDraft.plan = plan.value
  }
})

// ---------- 初始化 ----------
onMounted(async () => {
  try {
    const info = await window.api.getFeedbackEmail()
    feedbackEmail.value = (info && info.email) || ''
  } catch (err) {
    console.error('读取反馈邮箱失败:', err)
    feedbackEmail.value = ''
  }
  const data = await window.api.readData()
  if (data) {
    motto.value = data.motto || ''
    if (data.records && typeof data.records === 'object') {
      Object.assign(records, data.records)
    }
    if (data.pomodoro && typeof data.pomodoro === 'object') {
      Object.assign(pomodoro, data.pomodoro)
    }
    if (data.pomodoroSettings && typeof data.pomodoroSettings === 'object') {
      pomodoroSettings.focusMinutes = Number(data.pomodoroSettings.focusMinutes) || 25
      pomodoroSettings.restMinutes = Number(data.pomodoroSettings.restMinutes) || 5
    }
    if (Array.isArray(data.checkinPlans)) {
      checkinPlans.value = data.checkinPlans
    }
    if (data.checkinLogs && typeof data.checkinLogs === 'object') {
      Object.assign(checkinLogs, data.checkinLogs)
    }
  }
  const rec = records[todayStr]
  todayDraft.completed = rec ? rec.completed : ''
  todayDraft.plan = rec ? rec.plan : ''
  selectDate(todayStr)

  now.value = new Date()
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  clearInterval(clockTimer)
  clearTimeout(savedTipTimer)
  clearTimeout(apiKeySavedTimer)
  clearTimeout(checkinTipTimer)
  clearTimeout(checkinErrorTimer)
  clearTimeout(feedbackSentTimer)
  clearTimeout(feedbackCopiedTimer)
})
</script>

<template>
  <div class="flex h-screen w-full select-none flex-col bg-oat-100 text-ink">
    <!-- 顶部导航栏 -->
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <h1 class="text-2xl font-semibold tracking-wide">{{ title }}</h1>
      <div class="flex items-center gap-2">
        <button class="nav-btn" @click="goYesterday">← 昨天</button>
        <button
          class="nav-btn"
          :disabled="tomorrowDisabled"
          :class="{ 'cursor-not-allowed opacity-40': tomorrowDisabled }"
          @click="goTomorrow"
        >
          明天 →
        </button>
        <button class="nav-btn-primary" :disabled="isToday" @click="goToday">今天</button>
        <button class="nav-btn ml-2" @click="openTools">🧰 工具</button>
        <button class="nav-btn" @click="openSettings">⚙️ 设置</button>
      </div>
    </header>

    <!-- 座右铭（顶部只读展示） -->
    <div class="border-b border-oat-200 bg-white/40 px-8 py-2.5">
      <p
        v-if="motto"
        class="mx-auto line-clamp-2 max-w-3xl text-center text-sm italic leading-snug text-ink/75"
      >
        「 {{ motto }} 」
      </p>
      <p v-else class="text-center text-sm text-ink/40">
        「 尚未设置座右铭，点击右上角 ⚙️ 设置 」
      </p>
    </div>

    <!-- 主内容区 -->
    <main class="flex flex-1 flex-col gap-6 overflow-y-auto px-8 py-6">
      <!-- 今日打卡任务：到点显示一键打卡按钮（显示该时段打卡名称） -->
      <CheckinToday
        :plans="checkinPlans"
        :logs="checkinLogs"
        :now="now"
        @checkin="doCheckin"
        @open-plans="openTool('checkin')"
      />
      <transition name="fade">
        <p v-if="checkinTip" class="-mt-4 text-center text-sm text-emerald-600">{{ checkinTip }}</p>
        <p v-else-if="checkinError" class="-mt-4 text-center text-sm text-red-500">{{ checkinError }}</p>
      </transition>

      <!-- 今日番茄钟统计 -->
      <section class="rounded-2xl border border-calm/30 bg-calm/10 px-5 py-3">
        <div class="mb-1 flex items-center gap-2">
          <span class="text-sm font-medium text-ink/80">🍅 今日专注</span>
        </div>
        <p class="text-sm leading-relaxed text-ink/75">
          {{ todayPomodoroText || '今日还没有专注学习记录，点击右上角「🧰 工具」开启番茄钟吧～' }}
        </p>
      </section>

      <!-- 昨日计划 · 今日参考（仅今天显示，只读） -->
      <section
        v-if="isToday"
        class="rounded-2xl border border-sage/40 bg-sage/10 px-5 py-3"
      >
        <div class="mb-1 flex items-center gap-2">
          <span class="text-sm font-medium text-ink/80">📋 昨日计划 · 今日参考</span>
          <span class="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-ink/50">只读</span>
        </div>
        <p class="max-h-16 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink/75">
          {{ yesterdayPlan || '昨天没有写下明日计划，今天自由安排吧～' }}
        </p>
      </section>

      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        <!-- 卡片1：今日完成 -->
        <section class="card">
          <h2 class="mb-3 text-lg font-medium">✅ 今日完成</h2>
          <textarea
            v-model="completed"
            :readonly="!canEdit"
            class="textarea"
            :class="{ 'textarea-readonly': !canEdit }"
            placeholder="记录今天完成的学习内容…"
          ></textarea>
        </section>

        <!-- 卡片2：明日计划 -->
        <section class="card">
          <h2 class="mb-3 text-lg font-medium">📝 明日计划</h2>
          <textarea
            v-model="plan"
            :readonly="!canEdit"
            class="textarea"
            :class="{ 'textarea-readonly': !canEdit }"
            placeholder="写下明天的学习计划…"
          ></textarea>
        </section>
      </div>

      <p v-if="!canEdit" class="text-center text-sm text-ink/50">
        🔒 历史记录为只读，无法修改
      </p>

      <!-- 底部操作区 -->
      <div class="mt-auto">
        <div class="flex items-center gap-4">
          <button class="history-btn" @click="showHistory = true">📜 查看历史记录</button>
          <button v-if="canEdit" class="save-btn" @click="saveToday">💾 保存今日打卡内容</button>
          <button v-else class="save-btn save-btn-disabled" disabled>💾 保存今日打卡内容</button>
        </div>

        <transition name="fade">
          <p v-if="saveError" class="mt-2 text-center text-sm text-red-500">⚠️ 保存失败，请重试</p>
          <p v-else-if="savedTip" class="mt-2 text-center text-sm text-emerald-600">✓ 已保存到本地</p>
          <p v-else-if="canEdit && isDirty" class="mt-2 text-center text-sm text-amber-600/80">
            有未保存的更改
          </p>
        </transition>
      </div>
    </main>

    <!-- 历史记录弹窗 -->
    <div
      v-if="showHistory"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      @click.self="showHistory = false"
    >
      <div class="flex max-h-[80%] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-2xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-xl font-semibold">📜 历史记录</h3>
          <div class="flex items-center gap-2">
            <button class="nav-btn-primary" @click="openStats">📊 统计</button>
            <button
              class="text-2xl leading-none text-ink/50 transition hover:text-ink"
              @click="showHistory = false"
            >
              ×
            </button>
          </div>
        </div>

        <p v-if="sortedDates.length === 0" class="py-10 text-center text-ink/50">
          暂无记录，快去完成今天的打卡吧～
        </p>

        <div v-else class="flex flex-col gap-4 overflow-y-auto pr-1">
          <div
            v-for="date in sortedDates"
            :key="date"
            class="rounded-xl border border-oat-200 bg-oat-50 p-4"
          >
            <div class="mb-2 flex items-center gap-2">
              <span class="font-medium">{{ date }}</span>
              <span
                v-if="date === todayStr"
                class="rounded-full bg-calm/10 px-2 py-0.5 text-xs text-calm"
                >今天</span
              >
            </div>
            <template v-if="records[date]">
              <p class="mb-1 text-sm">
                <span class="text-ink/50">✅ 完成：</span>{{ records[date].completed || '—' }}
              </p>
              <p class="mb-1 text-sm">
                <span class="text-ink/50">📝 计划：</span>{{ records[date].plan || '—' }}
              </p>
            </template>
            <p v-if="pomodoro[date]" class="text-sm text-calm">
              <span class="text-ink/50">🍅 专注：</span>{{ pomodoro[date].sessions }} 次，共
              {{ pomodoroMinutes(pomodoro[date]) }} 分钟
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 设置弹窗（模块化：菜单 + 各子设置页） -->
    <div
      v-if="showSettings"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      @click.self="closeSettings"
    >
      <div
        class="flex max-h-[85%] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <!-- 设置菜单 -->
        <template v-if="settingsView === 'menu'">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-xl font-semibold">⚙️ 设置</h3>
            <button
              class="text-2xl leading-none text-ink/50 transition hover:text-ink"
              @click="closeSettings"
            >
              ×
            </button>
          </div>

          <div class="flex flex-col gap-3">
            <button
              v-for="opt in settingOptions"
              :key="opt.id"
              class="flex items-center gap-4 rounded-xl border border-oat-200 bg-white p-4 text-left transition hover:border-calm/50 hover:bg-calm/5"
              @click="openSettingOption(opt.id)"
            >
              <span class="text-2xl">{{ opt.icon }}</span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium text-ink">{{ opt.label }}</span>
                <span class="block text-xs text-ink/50">{{ opt.desc }}</span>
              </span>
              <span class="text-ink/40">›</span>
            </button>
          </div>
        </template>

        <!-- 座右铭子页 -->
        <template v-else-if="settingsView === 'motto'">
          <div class="mb-4 flex items-center gap-3">
            <button class="nav-btn shrink-0" @click="backToSettingsMenu">← 返回</button>
            <h3 class="flex-1 text-center text-xl font-semibold">💬 座右铭设置</h3>
            <button
              class="shrink-0 text-2xl leading-none text-ink/50 transition hover:text-ink"
              @click="closeSettings"
            >
              ×
            </button>
          </div>

          <textarea
            v-model="mottoDraft"
            class="textarea h-40"
            placeholder="写下一句激励自己的话…"
          ></textarea>
          <p class="mt-2 text-xs text-ink/50">保存后显示在窗口顶部，只读；如需修改请再次打开此窗口。</p>

          <div class="mt-4 flex items-center gap-3">
            <button class="save-btn" @click="saveMotto">💾 保存座右铭</button>
            <button class="history-btn" @click="backToSettingsMenu">取消</button>
          </div>
        </template>

        <!-- 新闻 API 密钥子页 -->
        <template v-else-if="settingsView === 'apiKey'">
          <div class="mb-4 flex items-center gap-3">
            <button class="nav-btn shrink-0" @click="backToSettingsMenu">← 返回</button>
            <h3 class="flex-1 text-center text-xl font-semibold">🔑 新闻 API 密钥</h3>
            <button
              class="shrink-0 text-2xl leading-none text-ink/50 transition hover:text-ink"
              @click="closeSettings"
            >
              ×
            </button>
          </div>

          <!-- 查看模式 -->
          <div v-if="!showApiKeyEdit" class="flex flex-col gap-4">
            <div class="rounded-xl border border-oat-200 bg-oat-50 p-4">
              <p class="mb-2 text-xs text-ink/50">当前密钥（仅显示首尾字符）</p>
              <p class="break-all font-mono text-lg text-ink">{{ apiKeyMasked || '未设置' }}</p>
              <p v-if="apiKeySaved" class="mt-2 text-sm text-emerald-600">✓ 已保存</p>
            </div>
            <p class="text-xs text-ink/50">
              密钥完整值仅在修改输入时可见；保存后以密文形式存储，仅展示首尾字符。
            </p>
            <button class="save-btn" @click="startApiKeyEdit">✏️ 修改</button>
          </div>

          <!-- 修改（输入）模式 -->
          <div v-else class="flex flex-col gap-4">
            <div>
              <label class="mb-1 block text-sm text-ink/70">输入新的 API 密钥</label>
              <input
                v-model="apiKeyDraft"
                type="text"
                class="w-full rounded-xl border border-oat-200 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-calm focus:ring-2 focus:ring-calm/20"
                placeholder="粘贴或输入完整密钥"
                autocomplete="off"
                spellcheck="false"
              />
              <p class="mt-2 text-xs text-ink/50">
                输入时完整显示；保存后将加密存储，并自动覆盖（删除）旧密钥。
              </p>
            </div>
            <p v-if="apiKeyError" class="text-sm text-red-500">⚠️ {{ apiKeyError }}</p>
            <div class="flex items-center gap-3">
              <button class="save-btn" @click="saveApiKey">💾 保存密钥</button>
              <button class="history-btn" @click="cancelApiKeyEdit">取消</button>
            </div>
          </div>
        </template>

        <!-- 问题反馈子页 -->
        <template v-else-if="settingsView === 'feedback'">
          <div class="mb-4 flex items-center gap-3">
            <button class="nav-btn shrink-0" @click="backToSettingsMenu">← 返回</button>
            <h3 class="flex-1 text-center text-xl font-semibold">✉️ 问题反馈</h3>
            <button
              class="shrink-0 text-2xl leading-none text-ink/50 transition hover:text-ink"
              @click="closeSettings"
            >
              ×
            </button>
          </div>

          <p class="mb-3 text-sm leading-relaxed text-ink/70">
            把你在使用中发现的问题或建议写下来，点击下面的按钮后会让你选择用哪个邮件软件发送（<span
              class="text-ink/85"
              >每次都会询问</span
            >），收件人已自动填好，确认内容后直接发送即可。
          </p>

          <div v-if="feedbackEmail" class="mb-3 rounded-xl border border-oat-200 bg-oat-50 px-4 py-3">
            <p class="mb-1 text-xs text-ink/50">收件人（开发者邮箱）</p>
            <p class="select-text break-all font-mono text-base text-ink">{{ feedbackEmail }}</p>
          </div>
          <div v-else class="mb-3 rounded-xl border border-oat-200 bg-oat-50 px-4 py-3">
            <p class="text-xs leading-relaxed text-ink/60">
              当前构建未配置开发者邮箱，无法一键发送邮件；请到项目仓库的 Issues 页面提交问题或建议。
            </p>
          </div>

          <textarea
            v-model="feedbackContent"
            class="textarea h-40 select-text"
            maxlength="2000"
            placeholder="例如：在首页一键打卡时，如果……希望能……"
          ></textarea>
          <p class="mt-1 flex items-center justify-between text-xs text-ink/50">
            <span>邮件会自动附带应用版本与系统信息，方便定位问题。</span>
            <span>{{ feedbackContent.length }}/2000</span>
          </p>

          <p v-if="feedbackSent" class="mt-3 text-sm text-emerald-600">
            ✓ 已拉起邮件客户端，请在邮件中确认内容并点击发送
          </p>

          <div class="mt-4 flex items-center gap-3">
            <button
              class="save-btn"
              :disabled="feedbackSending || mailPickerLoading || !feedbackEmail"
              :class="{
                'cursor-not-allowed opacity-60': feedbackSending || mailPickerLoading || !feedbackEmail
              }"
              @click="startSendFeedback"
            >
              {{ feedbackSending ? '正在拉起邮件软件…' : '📧 一键发送反馈' }}
            </button>
            <button class="history-btn" @click="backToSettingsMenu">关闭</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 问题反馈：每次发送前选择使用哪个邮件软件 -->
    <div
      v-if="mailPickerOpen"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      @click.self="closeMailPicker"
    >
      <div class="flex max-h-[85%] w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-2xl">
        <h3 class="mb-1 text-lg font-semibold">选择发送反馈的邮件软件</h3>
        <p class="mb-4 text-sm text-ink/60">
          每次发送都会询问你，方便随时更换。<template v-if="feedbackEmail">收件人固定为 {{ feedbackEmail }}。</template>
        </p>

        <p v-if="mailPickerLoading" class="py-8 text-center text-sm text-ink/50">
          正在检测本机已安装的邮件软件…
        </p>

        <div v-else class="flex flex-col gap-2 overflow-y-auto pr-1">
          <button
            class="flex items-center gap-3 rounded-xl border border-calm/50 bg-calm/5 p-3 text-left transition hover:bg-calm/10"
            @click="sendFeedbackWith('default')"
          >
            <span class="text-2xl">🖥️</span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-ink">使用系统默认的邮件软件</span>
              <span class="block text-xs text-ink/50">跟随 Windows 的 mailto 默认设置</span>
            </span>
          </button>

          <button
            v-for="client in mailClients"
            :key="client.id"
            class="flex items-center gap-3 rounded-xl border border-oat-200 bg-white p-3 text-left transition hover:border-calm/50 hover:bg-calm/5"
            @click="sendFeedbackWith(client.id)"
          >
            <span class="text-2xl">✉️</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-ink">{{ client.name }}</span>
              <span class="block truncate text-xs text-ink/50">{{ client.exeName }}</span>
            </span>
          </button>

          <p v-if="!mailClients.length" class="mt-1 text-xs leading-relaxed text-ink/45">
            未检测到其它已注册的邮件软件，点上面「使用系统默认的邮件软件」即可。
          </p>
        </div>

        <div class="mt-4 flex">
          <button class="history-btn w-full" @click="closeMailPicker">取消</button>
        </div>
      </div>
    </div>

    <!-- 问题反馈：拉起邮件客户端失败时的提示窗口（把邮箱显示给用户，提示手动发送） -->
    <div
      v-if="feedbackFailure"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      @click.self="closeFeedbackFailure"
    >
      <div class="max-h-[85%] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h3 class="mb-2 text-lg font-semibold text-red-500">
          {{ feedbackFailureTitle(feedbackFailure) }}
        </h3>
        <p class="mb-4 text-sm leading-relaxed text-ink/70">
          {{ feedbackFailureDesc(feedbackFailure) }}
        </p>

        <div
          v-if="feedbackFailure.email"
          class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
        >
          <p class="mb-1 text-xs text-ink/50">开发者邮箱</p>
          <p class="select-text break-all font-mono text-xl text-ink">{{ feedbackFailure.email }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="feedbackFailure.email"
            class="nav-btn-primary"
            @click="copyText(feedbackFailure.email, 'email')"
          >
            {{ feedbackCopied === 'email' ? '✓ 已复制' : '📋 复制邮箱地址' }}
          </button>
          <button class="history-btn" @click="copyText(feedbackFailure.body, 'body')">
            {{ feedbackCopied === 'body' ? '✓ 已复制' : '📋 复制邮件内容' }}
          </button>
          <button
            v-if="feedbackFailure.reason !== 'not-configured'"
            class="history-btn"
            @click="startSendFeedback"
          >
            🔄 换个软件重试
          </button>
        </div>

        <p v-if="feedbackFailure.error" class="mt-3 text-xs text-ink/40">
          失败原因：{{ feedbackFailure.error }}
        </p>
        <p v-if="feedbackFailure.email" class="mt-3 text-xs leading-relaxed text-ink/50">
          提示：你可以复制上面的邮箱地址，然后用任意邮箱（网页版邮箱、手机邮箱 App 等）自行发送建议给开发者。
        </p>
        <p v-else class="mt-3 text-xs leading-relaxed text-ink/50">
          提示：请复制上面的邮件内容，粘贴到项目仓库的 Issue 里。
        </p>

        <div class="mt-4 flex">
          <button class="save-btn" @click="closeFeedbackFailure">知道了</button>
        </div>
      </div>
    </div>

    <!-- 工具模块（全屏覆盖） -->
    <ToolsView
      v-if="currentView === 'tools'"
      :news-enabled="hasSavedToday"
      @back="backToMain"
      @select-tool="openTool"
    />

    <!-- 打卡计划：管理 + 每个计划的统计图（全屏覆盖，从工具菜单进入） -->
    <CheckinView
      v-else-if="currentView === 'checkin'"
      :plans="checkinPlans"
      :logs="checkinLogs"
      :today="todayKey"
      @back="backToTools"
      @save-plan="saveCheckinPlan"
      @delete-plan="deleteCheckinPlan"
    />

    <!-- 番茄钟（全屏覆盖） -->
    <PomodoroView
      v-else-if="currentView === 'pomodoro'"
      :focus-minutes="pomodoroSettings.focusMinutes"
      :rest-minutes="pomodoroSettings.restMinutes"
      @back="backToTools"
      @complete-focus="recordFocusSession"
      @update-settings="savePomodoroSettings"
    />

    <!-- 日历热力图（全屏覆盖） -->
    <HeatmapView
      v-else-if="currentView === 'heatmap'"
      :records="records"
      :pomodoro="pomodoro"
      @back="backToTools"
    />

    <!-- 查看新闻（全屏覆盖，从工具菜单进入） -->
    <NewsView v-else-if="currentView === 'news'" @back="backToTools" />

    <!-- 做个决定（全屏覆盖，从工具菜单进入） -->
    <DecisionView v-else-if="currentView === 'decision'" @back="backToTools" />

    <!-- 学习统计仪表盘（全屏覆盖，从历史记录进入） -->
    <StatsView
      v-else-if="currentView === 'stats'"
      :records="records"
      :pomodoro="pomodoro"
      @back="backToMain"
    />
  </div>
</template>
