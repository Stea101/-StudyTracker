<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import echarts from '../lib/echarts'
import {
  REPEAT_OPTIONS,
  repeatLabel,
  scheduleLabel,
  planAppliesOn,
  planStats,
  planDayProgress,
  recentCheckinRecords
} from '../lib/checkin'
import { fmtDate, parseDate, addDays, makeId, timeToMinutes, WEEKDAY_SHORT } from '../lib/date'
import { isCalendarCovered } from '../lib/workday'

// 打卡计划管理 + 每个计划的统计图。
// 计划数据由 App.vue 统一持有（props），本组件只负责编辑并通过事件回传，
// 保证首页「一键打卡」与统计页看到的是同一份数据。
const props = defineProps({
  plans: { type: Array, default: () => [] },
  logs: { type: Object, default: () => ({}) },
  today: { type: String, required: true }
})
const emit = defineEmits(['back', 'save-plan', 'delete-plan'])

// 与主进程 normalizeCheckinPlans 的上限保持一致
const MAX_PLANS = 30

const view = ref('list') // 'list' | 'editor' | 'detail'
const activePlanId = ref('')
const confirmDeleteId = ref('')

const todayObj = computed(() => parseDate(props.today))

// 所有计划的统计（供列表摘要与详情页共用）
const statsMap = computed(() => {
  const map = {}
  for (const plan of props.plans) {
    map[plan.id] = planStats(plan, props.logs, props.today)
  }
  return map
})
const activePlan = computed(() => props.plans.find((p) => p.id === activePlanId.value) || null)
const activeStats = computed(() => statsMap.value[activePlanId.value] || null)
const activeRecords = computed(() =>
  activePlan.value ? recentCheckinRecords(activePlan.value, props.logs, 8) : []
)

function planListState(plan) {
  const applies = planAppliesOn(plan, todayObj.value)
  const progress = planDayProgress(plan, props.logs, props.today)
  return { applies, progress }
}

// ---------- 计划编辑器 ----------
const DEFAULT_TIMES = [
  ['07:00', '08:00'],
  ['09:00', '10:00'],
  ['12:00', '13:00'],
  ['14:00', '15:00'],
  ['16:00', '17:00'],
  ['19:00', '20:00'],
  ['21:00', '22:00'],
  ['22:00', '23:00']
]

function newSlot(index) {
  const [start, end] = DEFAULT_TIMES[index % DEFAULT_TIMES.length]
  return { id: makeId('slot'), name: '', start, end }
}

const editor = reactive({
  id: '',
  name: '',
  repeat: 'daily',
  customDays: [1, 2, 3, 4, 5],
  startDate: '',
  endDate: '',
  slots: [],
  createdAt: 0
})
const editorError = ref('')

// 用编辑器当前内容构造一个「临时计划」，用于实时预览生效日期
function draftPlan() {
  return {
    id: editor.id || 'draft',
    name: editor.name,
    repeat: editor.repeat,
    customDays: editor.customDays,
    startDate: editor.startDate,
    endDate: editor.endDate,
    slots: editor.slots
  }
}

const editorPreviewDays = computed(() => {
  const plan = draftPlan()
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(todayObj.value, i)
    days.push({ date: fmtDate(d), label: WEEKDAY_SHORT[d.getDay()], applies: planAppliesOn(plan, d) })
  }
  return days
})

const workdayHint = computed(() => {
  if (editor.repeat !== 'workdays') return ''
  const year = (editor.startDate ? parseDate(editor.startDate) : todayObj.value).getFullYear()
  return isCalendarCovered(new Date(year, 0, 1))
    ? ''
    : `${year} 年的法定节假日安排尚未收录，该年将按「周一~周五」近似判断。`
})

function resetEditor(plan) {
  editor.id = plan ? plan.id : ''
  editor.name = plan ? plan.name : ''
  editor.repeat = plan ? plan.repeat : 'daily'
  editor.customDays = plan ? [...(plan.customDays || [])] : [1, 2, 3, 4, 5]
  editor.startDate = plan ? plan.startDate || '' : props.today
  editor.endDate = plan ? plan.endDate || '' : ''
  editor.slots = plan ? plan.slots.map((s) => ({ ...s })) : [newSlot(0)]
  editor.createdAt = plan ? plan.createdAt || 0 : 0
  editorError.value = ''
}

function openCreate() {
  resetEditor(null)
  view.value = 'editor'
}

function openEdit(plan) {
  resetEditor(plan)
  view.value = 'editor'
}

function openDetail(plan) {
  activePlanId.value = plan.id
  confirmDeleteId.value = ''
  view.value = 'detail'
  nextTick(renderCharts)
}

function setSlotCount(count) {
  const target = Math.min(8, Math.max(1, Number(count) || 1))
  while (editor.slots.length < target) editor.slots.push(newSlot(editor.slots.length))
  while (editor.slots.length > target) editor.slots.pop()
  editorError.value = ''
}

function toggleCustomDay(day) {
  const set = new Set(editor.customDays)
  if (set.has(day)) set.delete(day)
  else set.add(day)
  editor.customDays = [...set].sort((a, b) => a - b)
}

function goBack() {
  if (view.value === 'list') {
    emit('back')
  } else {
    view.value = 'list'
    editorError.value = ''
    confirmDeleteId.value = ''
  }
}

const headerBackLabel = computed(() => (view.value === 'list' ? '← 返回工具' : '← 返回计划列表'))
const headerTitle = computed(() => {
  if (view.value === 'editor') return editor.id ? '✏️ 编辑打卡计划' : '➕ 新建打卡计划'
  if (view.value === 'detail') return '📊 打卡计划统计'
  return '⏰ 打卡计划'
})

function saveEditor() {
  const name = editor.name.trim()
  if (!name) {
    editorError.value = '请填写计划名称'
    return
  }
  if (!editor.slots.length) {
    editorError.value = '至少需要 1 个打卡时段'
    return
  }
  for (let i = 0; i < editor.slots.length; i++) {
    const slot = editor.slots[i]
    if (!slot.name.trim()) {
      editorError.value = `第 ${i + 1} 个打卡时段还没有填写名称`
      return
    }
    const start = timeToMinutes(slot.start)
    const end = timeToMinutes(slot.end)
    if (start === null || end === null) {
      editorError.value = `第 ${i + 1} 个打卡时段的时间格式不正确`
      return
    }
    if (end <= start) {
      editorError.value = `「${slot.name.trim()}」的结束时间必须晚于开始时间（同一自然日内）`
      return
    }
  }
  if (editor.repeat === 'custom' && !editor.customDays.length) {
    editorError.value = '自定义星期至少需要勾选一天'
    return
  }
  if (editor.startDate && editor.endDate && editor.endDate < editor.startDate) {
    editorError.value = '结束日期不能早于开始日期'
    return
  }

  emit('save-plan', {
    id: editor.id || makeId('plan'),
    name,
    repeat: editor.repeat,
    customDays: [...editor.customDays].sort((a, b) => a - b),
    startDate: editor.startDate,
    endDate: editor.endDate,
    slots: editor.slots.map((s) => ({ ...s, name: s.name.trim() })),
    createdAt: editor.createdAt || Date.now()
  })
  view.value = 'list'
  editorError.value = ''
}

function askDelete(id) {
  confirmDeleteId.value = confirmDeleteId.value === id ? '' : id
}

function doDelete(id) {
  confirmDeleteId.value = ''
  if (activePlanId.value === id) {
    activePlanId.value = ''
    view.value = 'list'
  }
  emit('delete-plan', id)
}

// ---------- 统计图表 ----------
const trendEl = ref(null)
const slotEl = ref(null)
let trendChart = null
let slotChart = null

const AXIS_COLOR = '#8a959c'
const SPLIT_COLOR = '#f0e9e1'

function renderCharts() {
  if (view.value !== 'detail') return
  const s = activeStats.value
  if (!s) return

  if (trendEl.value) {
    if (!trendChart) trendChart = echarts.init(trendEl.value)
    trendChart.setOption(
      {
        tooltip: {
          trigger: 'axis',
          formatter: (params) => {
            const list = Array.isArray(params) ? params : [params]
            const head = list.length ? list[0].name : ''
            return `${head}<br/>${list.map((p) => `${p.marker}${p.seriesName} ${p.value} 次`).join('<br/>')}`
          }
        },
        legend: {
          data: ['实际打卡', '应打卡'],
          right: 4,
          top: 0,
          itemWidth: 12,
          itemHeight: 8,
          textStyle: { color: AXIS_COLOR, fontSize: 11 }
        },
        grid: { left: 36, right: 20, top: 36, bottom: 28 },
        xAxis: {
          type: 'category',
          data: s.trend.map((d) => d.label),
          axisLine: { lineStyle: { color: '#e7ded2' } },
          axisTick: { show: false },
          axisLabel: { color: AXIS_COLOR, fontSize: 11 }
        },
        yAxis: {
          type: 'value',
          name: '次数',
          nameTextStyle: { color: AXIS_COLOR, fontSize: 11 },
          axisLabel: { color: AXIS_COLOR, fontSize: 11 },
          splitLine: { lineStyle: { color: SPLIT_COLOR } },
          minInterval: 1
        },
        series: [
          {
            name: '实际打卡',
            type: 'bar',
            data: s.trend.map((d) => d.done),
            barMaxWidth: 22,
            itemStyle: { color: '#6b9cbd', borderRadius: [4, 4, 0, 0] }
          },
          {
            name: '应打卡',
            type: 'line',
            data: s.trend.map((d) => d.expected),
            symbolSize: 6,
            lineStyle: { color: '#a8c3b8', width: 2 },
            itemStyle: { color: '#a8c3b8' }
          }
        ]
      },
      true
    )
    trendChart.resize()
  }

  if (slotEl.value && s.slotStats.length) {
    if (!slotChart) slotChart = echarts.init(slotEl.value)
    slotChart.setOption(
      {
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (params) => {
            const p = Array.isArray(params) ? params[0] : params
            const row = s.slotStats[p.dataIndex]
            return `${p.name}<br/>完成率 ${p.value}%（${row.done}/${row.expected} 次）`
          }
        },
        grid: { left: 96, right: 48, top: 16, bottom: 28 },
        xAxis: {
          type: 'value',
          max: 100,
          axisLabel: { formatter: '{value}%', color: AXIS_COLOR, fontSize: 11 },
          splitLine: { lineStyle: { color: SPLIT_COLOR } }
        },
        yAxis: {
          type: 'category',
          data: s.slotStats.map((x) => x.slot.name),
          axisLine: { lineStyle: { color: '#e7ded2' } },
          axisTick: { show: false },
          axisLabel: { color: AXIS_COLOR, fontSize: 11 }
        },
        series: [
          {
            type: 'bar',
            data: s.slotStats.map((x) => x.rate),
            barMaxWidth: 18,
            itemStyle: { color: '#a8c3b8', borderRadius: [0, 5, 5, 0] },
            label: { show: true, position: 'right', formatter: '{c}%', color: AXIS_COLOR, fontSize: 11 }
          }
        ]
      },
      true
    )
    slotChart.resize()
  }
}

function disposeCharts() {
  if (trendChart) {
    trendChart.dispose()
    trendChart = null
  }
  if (slotChart) {
    slotChart.dispose()
    slotChart = null
  }
}

function onResize() {
  if (trendChart) trendChart.resize()
  if (slotChart) slotChart.resize()
}

watch(view, (v) => {
  if (v !== 'detail') disposeCharts()
})

watch(activeStats, () => {
  if (view.value === 'detail') nextTick(renderCharts)
})

onMounted(() => {
  window.addEventListener('resize', onResize)
  if (view.value === 'detail') nextTick(renderCharts)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  disposeCharts()
})
</script>

<template>
  <div class="fixed inset-0 z-40 flex select-none flex-col bg-oat-100 text-ink">
    <!-- 顶部导航栏 -->
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <button class="nav-btn" @click="goBack">{{ headerBackLabel }}</button>
      <h1 class="text-2xl font-semibold tracking-wide">{{ headerTitle }}</h1>
      <div class="flex w-28 justify-end">
        <button
          v-if="view === 'list'"
          class="nav-btn-primary"
          :disabled="plans.length >= MAX_PLANS"
          @click="openCreate"
        >
          ＋ 新建计划
        </button>
      </div>
    </header>

    <main class="flex flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <!-- ================= 计划列表 ================= -->
      <template v-if="view === 'list'">
        <p class="text-center text-sm text-ink/50">
          设置每天的打卡时段，到点后首页会出现一键打卡按钮；点击计划卡片可查看统计图。
        </p>
        <p v-if="plans.length >= MAX_PLANS" class="text-center text-xs text-amber-600/90">
          最多支持 {{ MAX_PLANS }} 个打卡计划，如需新增请先删除不再使用的计划。
        </p>

        <p v-if="!plans.length" class="py-10 text-center text-ink/50">
          还没有打卡计划，点击右上角「＋ 新建计划」创建第一个吧～
        </p>

        <div v-else class="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div v-for="plan in plans" :key="plan.id" class="card !p-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-lg font-medium text-ink">{{ plan.name }}</span>
              <span class="rounded-full bg-calm/10 px-2 py-0.5 text-[11px] text-calm">
                {{ repeatLabel(plan) }}
              </span>
              <span
                v-if="planListState(plan).applies"
                class="rounded-full bg-sage/20 px-2 py-0.5 text-[11px] text-ink/70"
              >
                今日需打卡 {{ planListState(plan).progress.done }}/{{ planListState(plan).progress.total }}
              </span>
              <span v-else class="rounded-full bg-oat-200/70 px-2 py-0.5 text-[11px] text-ink/50">
                今日不需打卡
              </span>
              <span class="ml-auto text-xs text-ink/45">
                完成率 {{ statsMap[plan.id] ? statsMap[plan.id].completionRate : 0 }}%
              </span>
            </div>

            <p class="mt-1 text-xs text-ink/45">
              生效区间：{{ scheduleLabel(plan) }} · 一天 {{ plan.slots.length }} 次 · 共
              {{ statsMap[plan.id] ? statsMap[plan.id].completed : 0 }} 次打卡
            </p>

            <div class="mt-3 flex flex-wrap gap-2">
              <span
                v-for="slot in plan.slots"
                :key="slot.id"
                class="rounded-lg border border-oat-200 bg-oat-50 px-2.5 py-1 text-xs text-ink/70"
              >
                {{ slot.name }} · {{ slot.start }}–{{ slot.end }}
              </span>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <button class="nav-btn-primary" @click="openDetail(plan)">📊 查看统计</button>
              <button class="history-btn" @click="openEdit(plan)">✏️ 编辑</button>
              <template v-if="confirmDeleteId === plan.id">
                <span class="text-sm text-red-500">确认删除？该计划的历史打卡记录也会一并删除</span>
                <button class="history-btn !border-red-300 !text-red-500" @click="doDelete(plan.id)">
                  确认删除
                </button>
                <button class="history-btn" @click="confirmDeleteId = ''">取消</button>
              </template>
              <button v-else class="history-btn ml-auto" @click="askDelete(plan.id)">🗑 删除</button>
            </div>
          </div>
        </div>
      </template>

      <!-- ================= 新建 / 编辑 ================= -->
      <template v-else-if="view === 'editor'">
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
          <!-- 计划名称 -->
          <div class="card !p-5">
            <label class="mb-2 block text-sm font-medium text-ink/80">计划名称</label>
            <input
              v-model="editor.name"
              type="text"
              maxlength="20"
              class="w-full select-text rounded-xl border border-oat-200 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-calm focus:ring-2 focus:ring-calm/20"
              placeholder="如：考研作息、健身打卡"
            />
          </div>

          <!-- 一天几次打卡 -->
          <div class="card !p-5">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium text-ink/80">一天需要打卡几次</span>
              <div class="flex items-center gap-3">
                <button
                  class="stepper-btn"
                  :disabled="editor.slots.length <= 1"
                  @click="setSlotCount(editor.slots.length - 1)"
                >
                  −
                </button>
                <span class="min-w-[3rem] text-center text-lg font-medium">{{ editor.slots.length }}</span>
                <button
                  class="stepper-btn"
                  :disabled="editor.slots.length >= 8"
                  @click="setSlotCount(editor.slots.length + 1)"
                >
                  ＋
                </button>
                <span class="text-sm text-ink/50">次 / 天</span>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <div
                v-for="(slot, index) in editor.slots"
                :key="slot.id"
                class="rounded-xl border border-oat-200 bg-oat-50 p-3"
              >
                <div class="mb-2 flex items-center gap-2">
                  <span
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-calm/15 text-xs text-calm"
                  >
                    {{ index + 1 }}
                  </span>
                  <input
                    v-model="slot.name"
                    type="text"
                    maxlength="20"
                    class="min-w-0 flex-1 select-text rounded-lg border border-oat-200 bg-white px-3 py-1.5 text-sm text-ink outline-none transition focus:border-calm"
                    placeholder="打卡名称，如：晨读英语"
                  />
                </div>
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="text-ink/50">打卡时间段</span>
                  <input
                    v-model="slot.start"
                    type="time"
                    class="select-text rounded-lg border border-oat-200 bg-white px-2 py-1 text-sm text-ink outline-none transition focus:border-calm"
                  />
                  <span class="text-ink/40">—</span>
                  <input
                    v-model="slot.end"
                    type="time"
                    class="select-text rounded-lg border border-oat-200 bg-white px-2 py-1 text-sm text-ink outline-none transition focus:border-calm"
                  />
                  <span class="text-xs text-ink/40">到点后首页会出现一键打卡按钮</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 重复规则 -->
          <div class="card !p-5">
            <p class="mb-3 text-sm font-medium text-ink/80">计划持续的时间（哪些日子需要打卡）</p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                v-for="opt in REPEAT_OPTIONS"
                :key="opt.id"
                class="rounded-xl border p-3 text-left transition"
                :class="
                  editor.repeat === opt.id
                    ? 'border-calm bg-calm/10'
                    : 'border-oat-200 bg-white hover:border-calm/50'
                "
                @click="editor.repeat = opt.id"
              >
                <span class="block text-sm font-medium text-ink">{{ opt.label }}</span>
                <span class="mt-0.5 block text-xs leading-relaxed text-ink/50">{{ opt.desc }}</span>
              </button>
            </div>

            <div v-if="editor.repeat === 'custom'" class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="day in [1, 2, 3, 4, 5, 6, 0]"
                :key="day"
                class="h-9 w-11 rounded-lg border text-sm transition"
                :class="
                  editor.customDays.includes(day)
                    ? 'border-calm bg-calm text-white'
                    : 'border-oat-200 bg-white text-ink/60 hover:border-calm/50'
                "
                @click="toggleCustomDay(day)"
              >
                {{ WEEKDAY_SHORT[day] }}
              </button>
            </div>

            <p v-if="workdayHint" class="mt-3 text-xs text-amber-600/90">ℹ️ {{ workdayHint }}</p>

            <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-xs text-ink/50">开始日期</label>
                <input
                  v-model="editor.startDate"
                  type="date"
                  class="w-full select-text rounded-lg border border-oat-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-calm"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs text-ink/50">结束日期（留空表示长期有效）</label>
                <input
                  v-model="editor.endDate"
                  type="date"
                  class="w-full select-text rounded-lg border border-oat-200 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-calm"
                />
              </div>
            </div>

            <!-- 未来 7 天生效预览 -->
            <div class="mt-4 rounded-xl border border-oat-200 bg-oat-50 p-3">
              <p class="mb-2 text-xs text-ink/50">接下来 7 天的生效预览</p>
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="(day, i) in editorPreviewDays"
                  :key="day.date"
                  class="rounded-lg px-2.5 py-1 text-xs"
                  :class="day.applies ? 'bg-sage/25 text-ink/80' : 'bg-white text-ink/40'"
                >
                  {{ i === 0 ? '今天' : `周${day.label}` }} · {{ day.applies ? '需打卡' : '休息' }}
                </span>
              </div>
            </div>
          </div>

          <p v-if="editorError" class="text-center text-sm text-red-500">⚠️ {{ editorError }}</p>

          <div class="flex items-center gap-3">
            <button class="save-btn" @click="saveEditor">💾 保存打卡计划</button>
            <button class="history-btn" @click="goBack">取消</button>
          </div>
        </div>
      </template>

      <!-- ================= 单个计划统计 ================= -->
      <template v-else-if="view === 'detail' && activePlan">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <div class="card !p-5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xl font-medium text-ink">{{ activePlan.name }}</span>
              <span class="rounded-full bg-calm/10 px-2 py-0.5 text-[11px] text-calm">
                {{ repeatLabel(activePlan) }}
              </span>
            </div>
            <p class="mt-1 text-xs text-ink/45">
              生效区间：{{ scheduleLabel(activePlan) }} · 一天 {{ activePlan.slots.length }} 次
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <span
                v-for="slot in activePlan.slots"
                :key="slot.id"
                class="rounded-lg border border-oat-200 bg-oat-50 px-2.5 py-1 text-xs text-ink/70"
              >
                {{ slot.name }} · {{ slot.start }}–{{ slot.end }}
              </span>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <button class="history-btn" @click="openEdit(activePlan)">✏️ 编辑计划</button>
              <button class="history-btn ml-auto" @click="askDelete(activePlan.id)">🗑 删除</button>
              <template v-if="confirmDeleteId === activePlan.id">
                <span class="text-sm text-red-500">确认删除？</span>
                <button class="history-btn !border-red-300 !text-red-500" @click="doDelete(activePlan.id)">
                  确认
                </button>
                <button class="history-btn" @click="confirmDeleteId = ''">取消</button>
              </template>
            </div>
          </div>

          <!-- 指标卡片 -->
          <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div class="card !p-5">
              <p class="text-xs text-ink/50">累计打卡</p>
              <p class="mt-2 text-3xl font-semibold text-ink">
                {{ activeStats.completed }}<span class="text-base text-ink/50"> 次</span>
              </p>
              <p class="mt-1 text-[11px] text-ink/40">应打卡 {{ activeStats.expected }} 次</p>
            </div>
            <div class="card !p-5">
              <p class="text-xs text-ink/50">计划完成率</p>
              <p class="mt-2 text-3xl font-semibold text-calm">
                {{ activeStats.completionRate }}<span class="text-base text-ink/50"> %</span>
              </p>
              <p class="mt-1 text-[11px] text-ink/40">生效 {{ activeStats.activeDays }} 天</p>
            </div>
            <div class="card !p-5">
              <p class="text-xs text-ink/50">连续全部完成</p>
              <p class="mt-2 text-3xl font-semibold text-sage">
                {{ activeStats.streak }}<span class="text-base text-ink/50"> 天</span>
              </p>
              <p class="mt-1 text-[11px] text-ink/40">全部时段均打卡</p>
            </div>
            <div class="card !p-5">
              <p class="text-xs text-ink/50">今日进度</p>
              <p class="mt-2 text-3xl font-semibold text-blush">
                {{ activeStats.todayDone }}<span class="text-base text-ink/50">
                  /{{ activeStats.todayExpected }}</span
                >
              </p>
              <p class="mt-1 text-[11px] text-ink/40">
                {{ activeStats.todayApplies ? '今日需打卡' : '今日不需打卡' }}
              </p>
            </div>
          </div>

          <!-- 近 14 天完成情况 -->
          <div class="card">
            <h2 class="mb-2 text-lg font-medium">📈 近 14 天打卡完成情况</h2>
            <div ref="trendEl" class="h-64 w-full"></div>
          </div>

          <!-- 各时段完成率 -->
          <div class="card">
            <h2 class="mb-2 text-lg font-medium">🎯 各打卡时段完成率</h2>
            <div v-if="activeStats.slotStats.length" ref="slotEl" class="h-56 w-full"></div>
            <p v-else class="py-6 text-center text-sm text-ink/50">该计划还没有打卡时段</p>
            <div class="mt-3 flex flex-wrap gap-2 border-t border-oat-200 pt-3">
              <span
                v-for="row in activeStats.slotStats"
                :key="row.slot.id"
                class="rounded-lg bg-oat-50 px-2.5 py-1 text-xs text-ink/60"
              >
                {{ row.slot.name }}：{{ row.done }}/{{ row.expected }} 次
              </span>
            </div>
          </div>

          <!-- 最近打卡记录 -->
          <div class="card">
            <h2 class="mb-3 text-lg font-medium">🕒 最近打卡记录</h2>
            <p v-if="!activeRecords.length" class="text-sm text-ink/50">还没有打卡记录～</p>
            <div v-else class="flex flex-col gap-2">
              <div
                v-for="row in activeRecords"
                :key="`${row.date}-${row.slotId}`"
                class="flex items-center justify-between rounded-lg bg-oat-50 px-3 py-2 text-sm"
              >
                <span class="text-ink/80">{{ row.slotName }}</span>
                <span class="text-ink/50">{{ row.date }} {{ row.at || '' }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
