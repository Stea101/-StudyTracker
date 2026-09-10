<script setup>
import { computed } from 'vue'
import { todayTasks, slotStatusText } from '../lib/checkin'

// 首页「今日打卡任务」区块：到了打卡时段就出现一键打卡按钮（显示该时段打卡名称）。
const props = defineProps({
  plans: { type: Array, default: () => [] },
  logs: { type: Object, default: () => ({}) },
  now: { type: Date, required: true }
})
const emit = defineEmits(['checkin', 'open-plans'])

const tasks = computed(() => todayTasks(props.plans, props.logs, props.now))
const activeCount = computed(() => tasks.value.filter((t) => t.status === 'active').length)
const doneCount = computed(() => tasks.value.filter((t) => t.status === 'done').length)

const CARD_CLASS = {
  active: 'border-calm bg-calm/10 ring-1 ring-calm/30',
  missed: 'border-blush/60 bg-blush/10',
  upcoming: 'border-oat-200 bg-white/70',
  done: 'border-oat-200 bg-white/50'
}

function onCheckin(task) {
  emit('checkin', { planId: task.planId, slotId: task.slot.id, date: task.dateKey })
}
</script>

<template>
  <section
    v-if="tasks.length || plans.length"
    class="rounded-2xl border border-oat-200 bg-white/60 px-5 py-4"
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-ink/80">⏰ 今日打卡任务</span>
        <span
          v-if="activeCount"
          class="animate-pulse rounded-full bg-calm px-2 py-0.5 text-[11px] font-medium text-white"
        >
          {{ activeCount }} 项进行中
        </span>
        <span v-else-if="tasks.length" class="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-ink/50">
          已完成 {{ doneCount }}/{{ tasks.length }}
        </span>
      </div>
      <button class="history-btn !px-3 !py-1.5 !text-xs" @click="emit('open-plans')">
        ⚙️ 管理打卡计划
      </button>
    </div>

    <p v-if="!tasks.length" class="text-sm text-ink/50">
      今天没有需要打卡的任务（已有 {{ plans.length }} 个打卡计划，今日均不在生效范围内）。
    </p>

    <div v-else class="flex flex-col gap-2">
      <div
        v-for="task in tasks"
        :key="`${task.planId}-${task.slot.id}`"
        class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition"
        :class="CARD_CLASS[task.status]"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span
              class="truncate font-medium"
              :class="task.status === 'done' ? 'text-ink/50 line-through' : 'text-ink'"
            >
              {{ task.slot.name }}
            </span>
            <span class="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-ink/50">
              {{ task.planName }}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-ink/55">
            🕒 {{ task.slot.start }} – {{ task.slot.end }} · {{ slotStatusText(task) }}
          </p>
        </div>

        <button
          v-if="task.status === 'active'"
          class="nav-btn-primary shrink-0 !px-5 !py-2"
          @click="onCheckin(task)"
        >
          ✅ 一键打卡
        </button>
        <button
          v-else-if="task.status === 'missed'"
          class="history-btn shrink-0 !text-xs"
          @click="onCheckin(task)"
        >
          补打卡
        </button>
        <span v-else-if="task.status === 'done'" class="shrink-0 text-sm text-emerald-600">
          ✓ 已打卡
        </span>
        <span v-else class="shrink-0 text-xs text-ink/40">未开始</span>
      </div>
    </div>
  </section>
</template>
