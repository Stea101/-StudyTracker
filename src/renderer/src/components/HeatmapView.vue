<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import echarts from '../lib/echarts'

// 日历热力图（类 GitHub 贡献图）：按日期展示打卡与番茄钟活跃度。
const props = defineProps({
  records: { type: Object, default: () => ({}) },
  pomodoro: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['back'])

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 活跃度 = 当日番茄钟分钟数；若仅打卡无番茄钟，则记 1（最低档，仍显示浅色）
const activity = computed(() => {
  const points = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = fmt(d)
    const minutes = props.pomodoro[key] ? Math.round(props.pomodoro[key].seconds / 60) : 0
    const hasRecord = !!props.records[key]
    const val = Math.max(minutes, hasRecord ? 1 : 0)
    if (val > 0) points.push([key, val])
  }
  return points
})

const maxValue = computed(() => {
  let m = 30
  for (const key in props.pomodoro) {
    const minutes = Math.round(props.pomodoro[key].seconds / 60)
    if (minutes > m) m = minutes
  }
  return m
})

const summary = computed(() => {
  let checkins = 0
  let sessions = 0
  let minutes = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = fmt(d)
    if (props.records[key]) checkins += 1
    if (props.pomodoro[key]) {
      sessions += props.pomodoro[key].sessions || 0
      minutes += Math.round((props.pomodoro[key].seconds || 0) / 60)
    }
  }
  return { checkins, sessions, minutes }
})

const hasAnyData = computed(() => activity.value.length > 0)

const chartEl = ref(null)
let chart = null

function renderChart() {
  if (!chart) return
  const start = new Date()
  start.setDate(start.getDate() - 364)
  chart.setOption({
    tooltip: {
      formatter: (p) => {
        const val = p.data ? p.data[1] : 0
        return `${p.data[0]}<br/>活跃度 ${val}`
      }
    },
    visualMap: {
      min: 0,
      max: maxValue.value,
      orient: 'horizontal',
      left: 'center',
      bottom: 6,
      itemWidth: 14,
      itemHeight: 14,
      textStyle: { color: '#8a959c' },
      inRange: { color: ['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'] }
    },
    calendar: {
      range: [fmt(start), fmt(new Date())],
      cellSize: ['auto', 14],
      top: 48,
      left: 60,
      right: 20,
      bottom: 70,
      splitLine: { show: true, lineStyle: { color: '#ffffff', width: 3 } },
      itemStyle: { color: '#ebedf0', borderColor: '#ffffff', borderWidth: 2 },
      yearLabel: { show: true, color: '#8a959c' },
      dayLabel: {
        nameMap: ['日', '一', '二', '三', '四', '五', '六'],
        color: '#8a959c'
      },
      monthLabel: {
        nameMap: [
          '一月', '二月', '三月', '四月', '五月', '六月',
          '七月', '八月', '九月', '十月', '十一月', '十二月'
        ],
        color: '#8a959c'
      }
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: activity.value
      }
    ]
  })
}

function onResize() {
  if (chart) chart.resize()
}

onMounted(() => {
  nextTick(() => {
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    renderChart()
    window.addEventListener('resize', onResize)
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>

<template>
  <div class="fixed inset-0 z-40 flex select-none flex-col bg-oat-100 text-ink">
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <button class="nav-btn" @click="emit('back')">← 返回</button>
      <h1 class="text-2xl font-semibold tracking-wide">📅 日历热力图</h1>
      <div class="w-24"></div>
    </header>

    <main class="flex flex-1 flex-col gap-4 overflow-y-auto px-8 py-6">
      <p class="text-center text-sm text-ink/60">
        近 365 天 · 打卡 {{ summary.checkins }} 天 · 专注 {{ summary.sessions }} 次 · 共
        {{ summary.minutes }} 分钟
      </p>

      <p v-if="!hasAnyData" class="text-center text-sm text-ink/50">
        暂无活跃数据，去完成打卡或开启番茄钟吧～
      </p>

      <div class="card overflow-hidden !p-4">
        <div ref="chartEl" class="h-[420px] w-full"></div>
      </div>
    </main>
  </div>
</template>
