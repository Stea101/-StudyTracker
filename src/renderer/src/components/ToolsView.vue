<script setup>
import { computed } from 'vue'

// 工具模块：全屏展示系统内置小工具入口（后续新增工具只需在 tools 数组追加一项）
const props = defineProps({
  newsEnabled: { type: Boolean, default: false }
})
const emit = defineEmits(['back', 'select-tool'])

const tools = computed(() => [
  { id: 'checkin', icon: '⏰', name: '打卡计划', desc: '设置每日打卡时段与重复规则，查看完成统计' },
  { id: 'pomodoro', icon: '🍅', name: '番茄钟', desc: '专注 / 休息计时器，可自定义时长' },
  { id: 'heatmap', icon: '📅', name: '日历热力图', desc: '按日期查看打卡与专注活跃度' },
  { id: 'decision', icon: '🎡', name: '做个决定', desc: '随机转盘抽签，帮你做个决定' },
  props.newsEnabled
    ? { id: 'news', icon: '📰', name: '查看新闻', desc: '今日热搜新闻' }
    : { id: 'news', icon: '📰', name: '查看新闻', desc: '请先保存今日打卡后再查看', locked: true }
])
</script>

<template>
  <div class="fixed inset-0 z-40 flex select-none flex-col bg-oat-100 text-ink">
    <!-- 顶部导航栏 -->
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <button class="nav-btn" @click="emit('back')">← 返回首页</button>
      <h1 class="text-2xl font-semibold tracking-wide">🧰 工具</h1>
      <div class="w-24"></div>
    </header>

    <!-- 工具图标网格 -->
    <main class="flex flex-1 flex-col gap-6 overflow-y-auto px-8 py-8">
      <p class="text-center text-sm text-ink/50">选择一个工具开始使用</p>

      <div class="mx-auto grid w-full max-w-3xl grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
        <button
          v-for="tool in tools"
          :key="tool.id"
          :disabled="!!tool.locked"
          class="group flex flex-col items-center gap-3 rounded-2xl border border-oat-200 bg-white p-8 shadow-sm transition hover:-translate-y-0.5 hover:border-calm/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-oat-200 disabled:hover:shadow-sm"
          @click="!tool.locked && emit('select-tool', tool.id)"
        >
          <span class="text-5xl transition group-hover:scale-110">{{ tool.icon }}</span>
          <span class="text-base font-medium text-ink">{{ tool.name }}</span>
          <span class="text-center text-xs leading-relaxed text-ink/50">
            {{ tool.locked ? '🔒 ' + tool.desc : tool.desc }}
          </span>
        </button>
      </div>
    </main>
  </div>
</template>
