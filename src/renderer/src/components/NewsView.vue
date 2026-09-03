<script setup>
import { ref, onMounted } from 'vue'

// 今日新闻（全屏）：从工具菜单进入，拉取 ShowAPI 热搜新闻。
const emit = defineEmits(['back'])

const loading = ref(false)
const error = ref('')
const data = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await window.api.fetchNews()
    if (result && result.ok) {
      data.value = { top: result.top || [], hot: result.hot || [] }
    } else {
      error.value = (result && result.error) || '新闻加载失败，请稍后重试'
    }
  } catch (err) {
    console.error('新闻加载失败:', err)
    error.value = '新闻加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

function openLink(url) {
  if (url) window.api.openExternal(url)
}

onMounted(load)
</script>

<template>
  <div class="fixed inset-0 z-40 flex select-none flex-col bg-oat-100 text-ink">
    <header
      class="flex items-center justify-between border-b border-oat-200 bg-white/70 px-8 py-4 shadow-sm backdrop-blur"
    >
      <button class="nav-btn" @click="emit('back')">← 返回</button>
      <h1 class="text-2xl font-semibold tracking-wide">📰 今日新闻</h1>
      <div class="w-24"></div>
    </header>

    <main class="flex flex-1 flex-col overflow-y-auto px-8 py-8">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div
          v-if="loading"
          class="flex flex-col items-center justify-center gap-3 py-20 text-ink/50"
        >
          <div class="h-8 w-8 animate-spin rounded-full border-2 border-calm border-t-transparent"></div>
          <p class="text-sm">正在加载新闻…</p>
        </div>

        <div v-else-if="error" class="flex flex-col items-center gap-4 py-20 text-center">
          <p class="text-4xl">😢</p>
          <p class="text-sm text-ink/70">{{ error }}</p>
          <button class="nav-btn-primary" @click="load">🔄 重试</button>
        </div>

        <div v-else-if="data" class="flex flex-col gap-4">
          <div v-if="data.top.length" class="rounded-xl border border-calm/30 bg-calm/10 p-4">
            <h4 class="mb-2 text-sm font-medium text-calm">🔝 置顶新闻</h4>
            <ul class="flex flex-col gap-2">
              <li v-for="(item, i) in data.top" :key="'top' + i">
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
                v-for="(item, i) in data.hot"
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

        <p v-else class="py-20 text-center text-ink/50">暂无新闻</p>
      </div>
    </main>
  </div>
</template>
