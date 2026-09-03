<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import echarts from '../lib/echarts'

// 学习统计仪表盘：累计/连续打卡天数、本周/本月完成率、番茄钟时长趋势图。
// 数据来自 App.vue 传入的 records / pomodoro（本地 data.json 已加载）。
const props = defineProps({
  records: { type: Object, default: () => ({}) },
  pomodoro: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['back'])

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date()

// ---------- 统计指标 ----------
const totalCheckins = computed(() => Object.keys(props.records).length)

// 连续打卡：若今天未打卡，则从昨天开始往回数
const currentStreak = computed(() => {
  let streak = 0
  const d = new Date()
  if (!props.records[fmt(d)]) d.setDate(d.getDate() - 1)
  while (props.records[fmt(d)]) {
    streak += 1
    d.setDate(d.getDate() - 1)
  }
  return streak
})

// 本周完成率：周一至今天已过天数中打卡的比例
const weekCompletion = computed(() => {
  const now = new Date()
  const dow = now.getDay() // 0=周日
  const sinceMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - sinceMonday)
  const elapsed = sinceMonday + 1
  let checked = 0
  for (let i = 0; i < elapsed; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    if (props.records[fmt(d)]) checked += 1
  }
  return elapsed ? Math.round((checked / elapsed) * 100) : 0
})

// 本月完成率：本月 1 号至今天已过天数中打卡的比例
const monthCompletion = computed(() => {
  const now = new Date()
  const elapsed = now.getDate()
  let checked = 0
  for (let i = 1; i <= elapsed; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), i)
    if (props.records[fmt(d)]) checked += 1
  }
  return elapsed ? Math.round((checked / elapsed) * 100) : 0
})

// 近 14 天番茄钟每日专注时长（分钟）
const trend = computed(() => {
  const days = []
  const values = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = fmt(d)
    const minutes = props.pomodoro[key] ? Math.round(props.pomodoro[key].seconds / 60) : 0
    days.push(key.slice(5)) // 'MM-DD'
    values.push(minutes)
  }
  return { days, values }
})

const hasAnyData = computed(() => totalCheckins.value > 0 || Object.keys(props.pomodoro).length > 0)

// ---------- 图表 ----------
const chartEl = ref(null)
let chart = null

function renderChart() {
  if (!chart) return
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params
        return `${p.name}<br/>🍅 专注 ${p.value} 分钟`
      }
    },
    grid: { left: 48, right: 24, top: 32, bottom: 32 },
    xAxis: {
      type: 'category',
      data: trend.value.days,
      axisLine: { lineStyle: { color: '#e7ded2' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a959c', fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      name: '分钟',
      nameTextStyle: { color: '#8a959c' },
      axisLabel: { color: '#8a959c' },
      splitLine: { lineStyle: { color: '#f0e9e1' } },
      minInterval: 1
    },
    series: [
      {
        name: '专注时长',
        type: 'bar',
        data: trend.value.values,
        barMaxWidth: 26,
        itemStyle: { color: '#6b9cbd', borderRadius: [5, 5, 0, 0] }
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
      <h1 class="text-2xl font-semibold tracking-wide">📊 学习统计</h1>
      <div class="w-24"></div>
    </header>

    <main class="flex flex-1 flex-col gap-6 overflow-y-auto px-8 py-8">
      <p v-if="!hasAnyData" class="text-center text-sm text-ink/50">
        还没有学习记录，先去完成打卡或开启番茄钟吧～
      </p>

      <!-- 指标卡片 -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div class="card !p-5">
          <p class="text-xs text-ink/50">累计打卡天数</p>
          <p class="mt-2 text-3xl font-semibold text-ink">{{ totalCheckins }}<span class="text-base text-ink/50"> 天</span></p>
        </div>
        <div class="card !p-5">
          <p class="text-xs text-ink/50">连续打卡天数</p>
          <p class="mt-2 text-3xl font-semibold text-calm">{{ currentStreak }}<span class="text-base text-ink/50"> 天</span></p>
        </div>
        <div class="card !p-5">
          <p class="text-xs text-ink/50">本周完成率</p>
          <p class="mt-2 text-3xl font-semibold text-sage">{{ weekCompletion }}<span class="text-base text-ink/50"> %</span></p>
        </div>
        <div class="card !p-5">
          <p class="text-xs text-ink/50">本月完成率</p>
          <p class="mt-2 text-3xl font-semibold text-blush">{{ monthCompletion }}<span class="text-base text-ink/50"> %</span></p>
        </div>
      </div>

      <!-- 趋势图 -->
      <div class="card">
        <h2 class="mb-2 text-lg font-medium">🍅 番茄钟总时长趋势（近 14 天）</h2>
        <div ref="chartEl" class="h-72 w-full"></div>
      </div>
    </main>
  </div>
</template>
