<script setup>
import { ref, reactive, computed, watch, onMounted, toRaw } from 'vue'
import ToolsView from './components/ToolsView.vue'
import PomodoroView from './components/PomodoroView.vue'

// ---------- 日期工具 ----------
const pad = (n) => String(n).padStart(2, '0')
const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDate = (str) => {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

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
const showNews = ref(false)
const newsLoading = ref(false)
const newsError = ref('')
const newsData = ref(null)
let savedTipTimer = null

// ---------- 设置（模块化） ----------
const settingsView = ref('menu') // 'menu' | 'motto' | 'apiKey'
const settingOptions = [
  { id: 'motto', icon: '💬', label: '座右铭', desc: '设置显示在窗口顶部的激励语' },
  { id: 'apiKey', icon: '🔑', label: '新闻 API 密钥', desc: '查看或修改新闻接口密钥' }
]
const apiKeyMasked = ref('')
const showApiKeyEdit = ref(false)
const apiKeyDraft = ref('')
const apiKeyError = ref('')
const apiKeySaved = ref(false)
let apiKeySavedTimer = null

// ---------- 工具模块 / 番茄钟 ----------
const currentView = ref('main') // 'main' | 'tools' | 'pomodoro'
const pomodoro = reactive({}) // { [date]: { sessions, seconds } }
const pomodoroSettings = reactive({ focusMinutes: 25, restMinutes: 5 })

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
  }
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

async function openNews() {
  if (!hasSavedToday.value) return
  showNews.value = true
  newsData.value = null
  newsError.value = ''
  await loadNews()
}

async function loadNews() {
  newsLoading.value = true
  newsError.value = ''
  try {
    const result = await window.api.fetchNews()
    if (result && result.ok) {
      newsData.value = { top: result.top || [], hot: result.hot || [] }
    } else {
      newsError.value = (result && result.error) || '新闻加载失败，请稍后重试'
    }
  } catch (err) {
    console.error('新闻加载失败:', err)
    newsError.value = '新闻加载失败，请检查网络后重试'
  } finally {
    newsLoading.value = false
  }
}

function closeNews() {
  showNews.value = false
}

function openLink(url) {
  if (url) window.api.openExternal(url)
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
  }
  const rec = records[todayStr]
  todayDraft.completed = rec ? rec.completed : ''
  todayDraft.plan = rec ? rec.plan : ''
  selectDate(todayStr)
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
          <button
            class="history-btn"
            :disabled="!hasSavedToday"
            :title="hasSavedToday ? '查看今日热搜新闻' : '请先保存今日打卡'"
            :class="{ 'cursor-not-allowed opacity-40': !hasSavedToday }"
            @click="openNews"
          >
            📰 查看新闻
          </button>
          <button v-if="canEdit" class="save-btn" @click="saveToday">💾 保存今日打卡</button>
          <button v-else class="save-btn save-btn-disabled" disabled>💾 保存今日打卡</button>
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
          <button
            class="text-2xl leading-none text-ink/50 transition hover:text-ink"
            @click="showHistory = false"
          >
            ×
          </button>
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
      </div>
    </div>

    <!-- 新闻弹窗 -->
    <div
      v-if="showNews"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      @click.self="closeNews"
    >
      <div class="flex max-h-[85%] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-2xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-xl font-semibold">📰 今日新闻</h3>
          <button
            class="text-2xl leading-none text-ink/50 transition hover:text-ink"
            @click="closeNews"
          >
            ×
          </button>
        </div>

        <div
          v-if="newsLoading"
          class="flex flex-col items-center justify-center gap-3 py-16 text-ink/50"
        >
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-calm border-t-transparent"></div>
          <p class="text-sm">正在加载新闻…</p>
        </div>

        <div v-else-if="newsError" class="flex flex-col items-center gap-4 py-16 text-center">
          <p class="text-4xl">😢</p>
          <p class="text-sm text-ink/70">{{ newsError }}</p>
          <button class="nav-btn-primary" @click="loadNews">🔄 重试</button>
        </div>

        <div v-else-if="newsData" class="flex flex-col gap-4 overflow-y-auto pr-1">
          <div
            v-if="newsData.top.length"
            class="rounded-xl border border-calm/30 bg-calm/10 p-4"
          >
            <h4 class="mb-2 text-sm font-medium text-calm">🔝 置顶新闻</h4>
            <ul class="flex flex-col gap-2">
              <li v-for="(item, i) in newsData.top" :key="'top' + i">
                <a
                  href="#"
                  class="text-sm text-ink/80 transition hover:text-calm hover:underline"
                  @click.prevent="openLink(item.link)"
                >
                  {{ item.top }}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 class="mb-2 text-sm font-medium text-ink/60">🔥 全网热搜</h4>
            <ul class="flex flex-col gap-1">
              <li
                v-for="(item, i) in newsData.hot"
                :key="'hot' + i"
                class="flex items-baseline gap-2"
              >
                <span
                  class="w-6 shrink-0 text-right text-xs font-semibold"
                  :class="i < 3 ? 'text-red-500' : 'text-ink/40'"
                >
                  {{ i + 1 }}
                </span>
                <a
                  href="#"
                  class="text-sm text-ink/80 transition hover:text-calm hover:underline"
                  @click.prevent="openLink(item.link)"
                >
                  {{ item.hot_research }}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p v-else class="py-16 text-center text-ink/50">暂无新闻</p>
      </div>
    </div>

    <!-- 工具模块（全屏覆盖） -->
    <ToolsView v-if="currentView === 'tools'" @back="backToMain" @select-tool="openTool" />

    <!-- 番茄钟（全屏覆盖） -->
    <PomodoroView
      v-else-if="currentView === 'pomodoro'"
      :focus-minutes="pomodoroSettings.focusMinutes"
      :rest-minutes="pomodoroSettings.restMinutes"
      @back="backToMain"
      @complete-focus="recordFocusSession"
      @update-settings="savePomodoroSettings"
    />
  </div>
</template>
