<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import AnswerEditor from './AnswerEditor.vue'

// 「做个决定」：随机转盘抽签工具。
// 结构：转盘展示 + 当前决定编辑 + 模板库（系统模板 / 自定义模板）。
// 数据通过主进程 data.json 的 decision 字段持久化（自定义模板 + 当前决定）。
const emit = defineEmits(['back'])

// ---------- 常量 ----------
// 系统模板：不计入数量限制，不可修改 / 删除，仅作快捷预设
const SYSTEM_TEMPLATES = [
  { id: 'sys-food', name: '今天吃什么？', answers: ['火锅', '烧烤', '拉面', '米饭', '汉堡', '饺子'] },
  { id: 'sys-dice', name: '摇个骰子', answers: ['1点', '2点', '3点', '4点', '5点', '6点'] },
  { id: 'sys-book', name: '看什么类型的书', answers: ['小说', '历史', '科技', '哲学', '经济', '心理学'] }
]

const MAX_USER_TEMPLATES = 10
const MAX_ANSWERS = 20
const MIN_ANSWERS = 2

// 转盘配色：均为中等明度莫兰迪色，保证白色文字可读
const PALETTE = [
  '#6b9cbd', '#5a8f8f', '#c78a7a', '#b98a4a', '#7b8fb5',
  '#a06d84', '#6f9e6f', '#c17f59', '#5f8fb0', '#8a7ab5',
  '#4f8f9b', '#b0a15f', '#9b7a8a', '#5f9e8f', '#b57f66',
  '#7f9e6f', '#a3846f', '#6f9aaf', '#aa7a9b', '#7a97b0'
]

// 转盘几何（viewBox 320×320，中心 160）
const C = 160
const R = 148

// ---------- 状态 ----------
const question = ref('')
const answers = ref([]) // 当前决定的答案（可含空白，转盘使用时过滤）
const templates = ref([]) // 用户自定义模板

const spinning = ref(false)
const rotation = ref(0)
const resultIndex = ref(-1)
const showResult = ref(false)

const showTemplates = ref(false)
const editing = ref(null) // 非空时处于「新建 / 编辑模板」表单
const templateError = ref('')

const spinDuration = ref(4000)
let spinTimer = null
let pendingResult = -1
let persistTimer = null
let idSeq = 0

// ---------- 计算 ----------
const activeAnswers = computed(() => answers.value.map((a) => a.trim()).filter(Boolean))
const count = computed(() => activeAnswers.value.length)
const canSpin = computed(() => count.value >= MIN_ANSWERS && !spinning.value)

const labelFontSize = computed(() => {
  const n = count.value
  if (n <= 6) return 14
  if (n <= 10) return 12
  if (n <= 16) return 10
  return 8
})

const segments = computed(() => {
  const n = count.value
  if (n === 0) return []
  const s = 360 / n
  const list = []
  for (let i = 0; i < n; i++) {
    const mid = i * s // 从正上方（12 点）起顺时针的角度
    const a0 = ((mid - s / 2 - 90) * Math.PI) / 180
    const a1 = ((mid + s / 2 - 90) * Math.PI) / 180
    const x0 = C + R * Math.cos(a0)
    const y0 = C + R * Math.sin(a0)
    const x1 = C + R * Math.cos(a1)
    const y1 = C + R * Math.sin(a1)

    const labelA = ((mid - 90) * Math.PI) / 180
    const lx = C + R * 0.6 * Math.cos(labelA)
    const ly = C + R * 0.6 * Math.sin(labelA)

    list.push({
      index: i,
      path: `M ${C} ${C} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`,
      color: PALETTE[i % PALETTE.length],
      labelX: lx,
      labelY: ly,
      text: shorten(activeAnswers.value[i])
    })
  }
  return list
})

const resultText = computed(() => {
  if (!showResult.value || resultIndex.value < 0 || resultIndex.value >= count.value) return ''
  return activeAnswers.value[resultIndex.value]
})

// 旋转作用于整个 SVG 元素（HTML 盒子），默认绕其中心旋转，避免 SVG transform-box 兼容性问题
const wheelStyle = computed(() => ({
  transform: `rotate(${rotation.value}deg)`,
  transition: spinning.value
    ? `transform ${spinDuration.value}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
    : 'none'
}))

// ---------- 工具 ----------
function shorten(text) {
  const t = String(text || '')
  return t.length > 7 ? `${t.slice(0, 6)}…` : t
}

function genId() {
  idSeq += 1
  return `tpl-${Date.now().toString(36)}-${idSeq}-${Math.random().toString(36).slice(2, 6)}`
}

// ---------- 转盘 ----------
function spin() {
  if (!canSpin.value) return
  const n = count.value
  const s = 360 / n
  const win = Math.floor(Math.random() * n)

  // 让选中扇区的中心正好停到顶部指针处，再叠加若干整圈形成自然的加速 - 减速过程
  const base = (360 - ((win * s) % 360)) % 360
  const turns = 5 + Math.floor(Math.random() * 4) // 5 ~ 8 圈
  const delta = (base - (rotation.value % 360) + 360) % 360
  const target = rotation.value + turns * 360 + delta
  const duration = 3200 + Math.floor(Math.random() * 1600) // 3.2 ~ 4.8 秒

  pendingResult = win
  resultIndex.value = -1
  showResult.value = false
  spinning.value = true

  requestAnimationFrame(() => {
    spinDuration.value = duration
    rotation.value = target
  })

  clearTimeout(spinTimer)
  spinTimer = setTimeout(() => {
    spinning.value = false
    resultIndex.value = pendingResult
    showResult.value = true
  }, duration + 120)
}

// ---------- 编辑 ----------
function saveCurrentAsTemplate() {
  if (count.value < MIN_ANSWERS) return
  editing.value = { id: '', name: question.value, answers: [...answers.value] }
  templateError.value = ''
  showTemplates.value = true
}

// ---------- 模板 ----------
function openTemplates() {
  editing.value = null
  templateError.value = ''
  showTemplates.value = true
}

function closeTemplates() {
  showTemplates.value = false
  editing.value = null
  templateError.value = ''
}

function loadTemplate(tpl) {
  question.value = tpl.name
  answers.value = tpl.answers.map((a) => String(a))
  resultIndex.value = -1
  showResult.value = false
  rotation.value = 0
  closeTemplates()
  persist()
}

function newTemplate() {
  editing.value = { id: '', name: '', answers: ['', ''] }
  templateError.value = ''
}

function editTemplate(tpl) {
  editing.value = { id: tpl.id, name: tpl.name, answers: tpl.answers.map((a) => String(a)) }
  templateError.value = ''
}

function cancelEdit() {
  editing.value = null
  templateError.value = ''
}

async function saveTemplate() {
  const t = editing.value
  if (!t) return
  const name = (t.name || '').trim()
  const rawAnswers = t.answers.map((a) => String(a))

  if (!name) {
    templateError.value = '请输入模板名称'
    return
  }
  if (rawAnswers.length < MIN_ANSWERS) {
    templateError.value = `至少需要 ${MIN_ANSWERS} 个答案`
    return
  }
  if (rawAnswers.length > MAX_ANSWERS) {
    templateError.value = `最多 ${MAX_ANSWERS} 个答案`
    return
  }
  if (rawAnswers.some((a) => !a.trim())) {
    templateError.value = '存在空白答案，请填写或删除后再保存'
    return
  }

  const cleanAnswers = rawAnswers.map((a) => a.trim())

  if (t.id) {
    templates.value = templates.value.map((x) =>
      x.id === t.id ? { ...x, name, answers: cleanAnswers } : x
    )
  } else {
    if (templates.value.length >= MAX_USER_TEMPLATES) {
      templateError.value = `最多保存 ${MAX_USER_TEMPLATES} 个自定义模板`
      return
    }
    templates.value = [...templates.value, { id: genId(), name, answers: cleanAnswers }]
  }

  templateError.value = ''
  editing.value = null
  await persist()
}

async function deleteTemplate(tpl) {
  templates.value = templates.value.filter((x) => x.id !== tpl.id)
  if (editing.value && editing.value.id === tpl.id) editing.value = null
  await persist()
}

// ---------- 持久化 ----------
async function persist() {
  try {
    await window.api.writeData({
      decision: {
        templates: templates.value.map((t) => ({ id: t.id, name: t.name, answers: [...t.answers] })),
        current: { question: question.value, answers: [...answers.value] }
      }
    })
  } catch (err) {
    console.error('保存「做个决定」数据失败:', err)
  }
}

function schedulePersist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 300)
}

// 当前决定内容变化时自动保存（answer 编辑以新数组抛出，浅监听即可触发）
watch(question, schedulePersist)
watch(answers, schedulePersist)

// ---------- 初始化 ----------
onMounted(async () => {
  try {
    const data = await window.api.readData()
    const d = (data && data.decision) || {}

    if (Array.isArray(d.templates)) {
      templates.value = d.templates
        .filter((t) => t && typeof t.name === 'string' && t.name.trim() && Array.isArray(t.answers))
        .map((t) => ({ id: t.id, name: t.name.trim(), answers: t.answers.map((a) => String(a)) }))
        .filter((t) => t.answers.length >= MIN_ANSWERS)
    }

    const cur = d.current || {}
    if (typeof cur.question === 'string' && Array.isArray(cur.answers) && cur.answers.length > 0) {
      question.value = cur.question
      answers.value = cur.answers.map((a) => String(a))
    } else {
      // 首次使用：预置第一个系统模板
      question.value = SYSTEM_TEMPLATES[0].name
      answers.value = [...SYSTEM_TEMPLATES[0].answers]
    }
  } catch (err) {
    console.error('读取「做个决定」数据失败:', err)
    question.value = SYSTEM_TEMPLATES[0].name
    answers.value = [...SYSTEM_TEMPLATES[0].answers]
  }
})

onUnmounted(() => {
  clearTimeout(spinTimer)
  clearTimeout(persistTimer)
  persist()
})
</script>

<template>
  <div class="fixed inset-0 z-40 flex select-none flex-col bg-oat-100 text-ink">
    <!-- 顶部导航栏 -->
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <button class="nav-btn" @click="emit('back')">← 返回工具</button>
      <h1 class="text-2xl font-semibold tracking-wide">🎡 做个决定</h1>
      <div class="flex w-28 justify-end">
        <button class="nav-btn" @click="openTemplates">📁 模板库</button>
      </div>
    </header>

    <main class="flex flex-1 flex-col overflow-y-auto px-8 py-6">
      <div class="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-[minmax(320px,420px)_1fr]">
        <!-- 左：转盘 -->
        <section class="card flex flex-col items-center gap-4">
          <h2 class="text-lg font-medium">🎡 随机转盘</h2>

          <div class="flex min-h-[3rem] items-center justify-center text-center">
            <p v-if="question" class="text-xl font-semibold text-ink">{{ question }}</p>
            <p v-else class="text-xl text-ink/40">还没有问题，先填写一个吧～</p>
          </div>

          <!-- 转盘 -->
          <div class="relative h-72 w-72 sm:h-80 sm:w-80">
            <svg viewBox="0 0 320 320" class="h-full w-full" :style="wheelStyle">
              <g>
                <path
                  v-for="seg in segments"
                  :key="seg.index"
                  :d="seg.path"
                  :fill="seg.color"
                  :opacity="showResult && resultIndex !== seg.index ? 0.45 : 1"
                  :stroke="showResult && resultIndex === seg.index ? '#3f4a52' : '#ffffff'"
                  :stroke-width="showResult && resultIndex === seg.index ? 2.5 : 1"
                />
                <text
                  v-for="seg in segments"
                  :key="'label-' + seg.index"
                  :x="seg.labelX"
                  :y="seg.labelY"
                  text-anchor="middle"
                  dominant-baseline="central"
                  :font-size="showResult && resultIndex === seg.index ? labelFontSize + 2 : labelFontSize"
                  :font-weight="showResult && resultIndex === seg.index ? 700 : 500"
                  fill="#ffffff"
                >
                  {{ seg.text }}
                </text>
              </g>
              <circle cx="160" cy="160" r="148" fill="none" stroke="#e7ded2" stroke-width="3" />
            </svg>

            <!-- 顶部指针（不随转盘旋转） -->
            <div
              class="pointer-events-none absolute left-1/2 top-[-10px] z-10 -translate-x-1/2"
            >
              <div
                class="h-0 w-0 border-l-[14px] border-r-[14px] border-t-[26px] border-l-transparent border-r-transparent border-t-[#3f4a52]"
              ></div>
            </div>

            <!-- 中心按钮 -->
            <button
              class="absolute left-1/2 top-1/2 z-10 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-full bg-white text-ink shadow-lg ring-1 ring-oat-200 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="!canSpin"
              @click="spin"
            >
              <span class="text-2xl leading-none">{{ spinning ? '🌀' : '🎯' }}</span>
              <span class="text-sm font-semibold">{{ spinning ? '转动中…' : '开始' }}</span>
            </button>
          </div>

          <!-- 结果展示 -->
          <div class="flex min-h-[3rem] items-center justify-center">
            <transition name="fade">
              <div v-if="showResult && resultText" class="result-pop rounded-xl bg-calm/10 px-6 py-2 text-center">
                <p class="text-sm text-ink/60">🎉 就决定是：</p>
                <p class="text-lg font-semibold text-calm-dark">{{ resultText }}</p>
              </div>
            </transition>
          </div>

          <p v-if="count < MIN_ANSWERS" class="text-center text-sm text-amber-600/80">
            ⚠️ 至少需要 {{ MIN_ANSWERS }} 个有效答案才能转动转盘
          </p>
        </section>

        <!-- 右：决定内容编辑 -->
        <section class="card flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium">✏️ 决定内容</h2>
            <span class="rounded-full bg-oat-100 px-2.5 py-0.5 text-xs text-ink/50">
              当前 {{ count }} 个有效答案
            </span>
          </div>

          <div>
            <label class="mb-1 block text-sm text-ink/70">问题名称</label>
            <input
              v-model="question"
              type="text"
              class="w-full rounded-xl border border-oat-200 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-calm focus:ring-2 focus:ring-calm/20"
              placeholder="例如：今天午饭吃什么？"
              spellcheck="false"
            />
          </div>

          <div>
            <label class="mb-2 block text-sm text-ink/70">答案列表（至少 {{ MIN_ANSWERS }} 个，最多 {{ MAX_ANSWERS }} 个）</label>
            <AnswerEditor v-model="answers" :min="MIN_ANSWERS" :max="MAX_ANSWERS" />
          </div>

          <div class="mt-auto flex items-center gap-3 pt-2">
            <button
              class="save-btn"
              :disabled="count < MIN_ANSWERS"
              :class="{ 'save-btn-disabled': count < MIN_ANSWERS }"
              @click="saveCurrentAsTemplate"
            >
              💾 保存为模板
            </button>
            <button class="history-btn" @click="openTemplates">📁 使用模板</button>
          </div>
        </section>
      </div>
    </main>

    <!-- 模板库弹窗 -->
    <div
      v-if="showTemplates"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      @click.self="closeTemplates"
    >
      <div class="flex max-h-[85%] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <!-- 列表模式 -->
        <template v-if="!editing">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-xl font-semibold">📁 模板库</h3>
            <button class="text-2xl leading-none text-ink/50 transition hover:text-ink" @click="closeTemplates">×</button>
          </div>

          <!-- 系统模板 -->
          <p class="mb-2 text-xs font-medium text-ink/50">系统模板（不计入数量限制）</p>
          <div class="mb-5 flex flex-col gap-2">
            <div
              v-for="tpl in SYSTEM_TEMPLATES"
              :key="tpl.id"
              class="flex items-center gap-3 rounded-xl border border-oat-200 bg-oat-50/60 px-4 py-3"
            >
              <span class="text-xl">🎁</span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium text-ink">{{ tpl.name }}</span>
                <span class="block truncate text-xs text-ink/50">{{ tpl.answers.join('、') }}</span>
              </span>
              <button class="nav-btn-primary shrink-0 px-3 py-1.5 text-sm" @click="loadTemplate(tpl)">使用</button>
            </div>
          </div>

          <!-- 用户模板 -->
          <div class="mb-2 flex items-center justify-between">
            <p class="text-xs font-medium text-ink/50">
              我的模板（{{ templates.length }}/{{ MAX_USER_TEMPLATES }}）
            </p>
            <button
              class="rounded-lg px-2 py-1 text-sm font-medium text-calm transition hover:bg-calm/10 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="templates.length >= MAX_USER_TEMPLATES"
              @click="newTemplate"
            >
              ＋ 新建模板
            </button>
          </div>

          <p v-if="templates.length === 0" class="py-6 text-center text-sm text-ink/50">
            还没有自定义模板，点击「新建模板」或在上方「保存为模板」创建。
          </p>

          <div v-else class="flex flex-col gap-2">
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="flex items-center gap-3 rounded-xl border border-oat-200 bg-white px-4 py-3"
            >
              <span class="text-xl">📄</span>
              <span class="min-w-0 flex-1">
                <span class="block font-medium text-ink">{{ tpl.name }}</span>
                <span class="block truncate text-xs text-ink/50">{{ tpl.answers.join('、') }}</span>
              </span>
              <button class="nav-btn-primary shrink-0 px-3 py-1.5 text-sm" @click="loadTemplate(tpl)">使用</button>
              <button class="history-btn shrink-0 px-3 py-1.5 text-sm" @click="editTemplate(tpl)">编辑</button>
              <button
                class="shrink-0 rounded-xl px-3 py-1.5 text-sm text-red-500/80 transition hover:bg-red-50 hover:text-red-600"
                @click="deleteTemplate(tpl)"
              >
                删除
              </button>
            </div>
          </div>
        </template>

        <!-- 新建 / 编辑模板 -->
        <template v-else>
          <div class="mb-4 flex items-center gap-3">
            <button class="nav-btn shrink-0" @click="cancelEdit">← 返回</button>
            <h3 class="flex-1 text-center text-xl font-semibold">
              {{ editing.id ? '✏️ 编辑模板' : '✨ 新建模板' }}
            </h3>
            <button class="shrink-0 text-2xl leading-none text-ink/50 transition hover:text-ink" @click="closeTemplates">×</button>
          </div>

          <div class="flex flex-col gap-4">
            <div>
              <label class="mb-1 block text-sm text-ink/70">模板名称</label>
              <input
                v-model="editing.name"
                type="text"
                class="w-full rounded-xl border border-oat-200 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-calm focus:ring-2 focus:ring-calm/20"
                placeholder="例如：周末去哪玩？"
                spellcheck="false"
              />
            </div>

            <div>
              <label class="mb-2 block text-sm text-ink/70">
                模板答案（至少 {{ MIN_ANSWERS }} 个，最多 {{ MAX_ANSWERS }} 个）
              </label>
              <AnswerEditor v-model="editing.answers" :min="MIN_ANSWERS" :max="MAX_ANSWERS" />
            </div>

            <p v-if="templateError" class="text-sm text-red-500">⚠️ {{ templateError }}</p>

            <div class="flex items-center gap-3">
              <button class="save-btn" @click="saveTemplate">💾 保存模板</button>
              <button class="history-btn" @click="cancelEdit">取消</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-pop {
  animation: decision-pop 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes decision-pop {
  0% {
    transform: scale(0.85);
    opacity: 0;
  }
  60% {
    transform: scale(1.06);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
