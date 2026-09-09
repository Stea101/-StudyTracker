<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// 番茄钟：专注 / 休息计时器。
// 规则：计时不会自动暂停；时间到只提示不停止；手动暂停后自动进入另一阶段；
// 专注阶段结束时向上抛 elapsed 秒数用于统计；休息阶段可选择退出。
// 计时基于真实时间戳（Date.now()）计算：即使窗口最小化/后台被浏览器节流，
// 也不会出现“计时变慢”的问题；定时器只负责刷新界面显示。
const props = defineProps({
  focusMinutes: { type: Number, default: 25 },
  restMinutes: { type: Number, default: 5 }
})
const emit = defineEmits(['back', 'complete-focus', 'update-settings'])

const phase = ref('focus') // 'focus' | 'rest'
const running = ref(false) // false = 未开始；true = 计时中（持续到退出）
const startedAt = ref(0) // 当前阶段开始时刻（毫秒时间戳）
const nowTick = ref(0) // 用于触发界面刷新的“当前时刻”
const focusDraft = ref(props.focusMinutes)
const restDraft = ref(props.restMinutes)

let timer = null

// 当前阶段已过秒数：由真实时间戳计算，后台/最小化期间也不会丢时间
const elapsed = computed(() => {
  if (!running.value || !startedAt.value) return 0
  return Math.max(0, Math.floor((nowTick.value - startedAt.value) / 1000))
})

const durationSeconds = computed(() =>
  phase.value === 'focus' ? focusDraft.value * 60 : restDraft.value * 60
)
const remaining = computed(() => durationSeconds.value - elapsed.value)
const isOverrun = computed(() => remaining.value < 0)

const timeDisplay = computed(() => {
  const abs = remaining.value < 0 ? 0 : remaining.value
  const mm = String(Math.floor(abs / 60)).padStart(2, '0')
  const ss = String(abs % 60).padStart(2, '0')
  return `${mm}:${ss}`
})

const overrunText = computed(() => {
  const abs = Math.abs(remaining.value)
  const mm = String(Math.floor(abs / 60)).padStart(2, '0')
  const ss = String(abs % 60).padStart(2, '0')
  return `${mm}:${ss}`
})

const promptText = computed(() => {
  if (!running.value || remaining.value > 0) return ''
  return phase.value === 'focus' ? '🎉 专注时间到，该休息啦！' : '📖 休息时间到，该学习啦！'
})

function updateNow() {
  nowTick.value = Date.now()
}

// 窗口重新可见 / 获得焦点时立即校准，避免节流期间显示滞后
function syncNow() {
  if (running.value) updateNow()
}

function ensureTimer() {
  if (timer) return
  timer = setInterval(updateNow, 250)
}

function incFocus() {
  if (!running.value) focusDraft.value = Math.min(180, focusDraft.value + 1)
}
function decFocus() {
  if (!running.value) focusDraft.value = Math.max(1, focusDraft.value - 1)
}
function incRest() {
  if (!running.value) restDraft.value = Math.min(120, restDraft.value + 1)
}
function decRest() {
  if (!running.value) restDraft.value = Math.max(1, restDraft.value - 1)
}

function markPhaseStart() {
  startedAt.value = Date.now()
  nowTick.value = startedAt.value
}

function startCycle() {
  emit('update-settings', { focusMinutes: focusDraft.value, restMinutes: restDraft.value })
  phase.value = 'focus'
  running.value = true
  markPhaseStart()
  ensureTimer()
}

function switchTo(next) {
  phase.value = next
  markPhaseStart()
}

// 手动暂停专注 → 记录本次专注时长，并自动开始休息
function finishFocus() {
  emit('complete-focus', elapsed.value)
  switchTo('rest')
}

// 手动暂停休息 → 自动开始下一轮专注
function finishRest() {
  switchTo('focus')
}

function exit() {
  emit('back')
}

onMounted(() => {
  ensureTimer()
  document.addEventListener('visibilitychange', syncNow)
  window.addEventListener('focus', syncNow)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', syncNow)
  window.removeEventListener('focus', syncNow)
})
</script>

<template>
  <div class="fixed inset-0 z-40 flex select-none flex-col bg-oat-100 text-ink">
    <!-- 顶部导航栏 -->
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <div class="flex w-24 items-center">
        <button v-if="!running" class="nav-btn" @click="exit">← 返回</button>
      </div>
      <h1 class="text-2xl font-semibold tracking-wide">🍅 番茄钟</h1>
      <div class="flex w-24 justify-end">
        <span
          v-if="running"
          class="rounded-full px-3 py-1 text-sm font-medium"
          :class="phase === 'focus' ? 'bg-calm/10 text-calm' : 'bg-sage/20 text-ink/70'"
        >
          {{ phase === 'focus' ? '🔴 专注中' : '🌿 休息中' }}
        </span>
      </div>
    </header>

    <!-- 未开始：设置时长 -->
    <main v-if="!running" class="flex flex-1 flex-col items-center justify-center gap-8 px-8">
      <div class="w-full max-w-md rounded-2xl border border-oat-200 bg-white p-8 shadow-sm">
        <h2 class="mb-6 text-center text-lg font-medium">设置时长（分钟）</h2>

        <div class="flex flex-col gap-6">
          <div class="flex items-center justify-between">
            <span class="text-sm text-ink/70">🔴 专注时间</span>
            <div class="flex items-center gap-2">
              <button class="stepper-btn" @click="decFocus">−</button>
              <span class="w-16 text-center font-mono text-2xl font-medium">{{ focusDraft }}</span>
              <button class="stepper-btn" @click="incFocus">＋</button>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-sm text-ink/70">🌿 休息时间</span>
            <div class="flex items-center gap-2">
              <button class="stepper-btn" @click="decRest">−</button>
              <span class="w-16 text-center font-mono text-2xl font-medium">{{ restDraft }}</span>
              <button class="stepper-btn" @click="incRest">＋</button>
            </div>
          </div>
        </div>

        <button class="pomodoro-btn mt-8 w-full" @click="startCycle">▶ 开始专注</button>
        <p class="mt-3 text-center text-xs leading-relaxed text-ink/50">
          开始后计时不会自动停止，需手动暂停；暂停后会自动开始休息计时。
        </p>
      </div>
    </main>

    <!-- 计时中 -->
    <main v-else class="flex flex-1 flex-col items-center justify-center gap-8 px-8">
      <div class="flex flex-col items-center gap-4">
        <p class="text-sm text-ink/50">{{ phase === 'focus' ? '🔴 专注时间' : '🌿 休息时间' }}</p>

        <p
          class="font-mono text-7xl font-semibold tracking-tight"
          :class="isOverrun ? 'text-red-500' : 'text-ink'"
        >
          {{ timeDisplay }}
        </p>
        <p v-if="isOverrun" class="text-sm text-red-500/80">已超时 {{ overrunText }}</p>

        <transition name="fade">
          <div
            v-if="promptText"
            class="rounded-xl border border-amber-300 bg-amber-50 px-6 py-3 text-center"
          >
            <p class="text-base font-medium text-amber-700">{{ promptText }}</p>
            <p class="mt-1 text-xs text-amber-600/70">计时仍在继续，请手动暂停。</p>
          </div>
        </transition>

        <div class="mt-4 flex flex-col items-center gap-3">
          <button v-if="phase === 'focus'" class="pomodoro-btn px-10" @click="finishFocus">
            ⏸ 暂停，去休息
          </button>
          <template v-else>
            <button class="pomodoro-btn px-10" @click="finishRest">⏸ 暂停，去学习</button>
            <button class="pomodoro-btn-ghost px-10" @click="exit">🚪 退出番茄钟</button>
          </template>
        </div>
      </div>
    </main>
  </div>
</template>
