<script setup>
// 可复用的「答案列表编辑器」：新增 / 删除 / 修改 / 上下调整顺序。
// 通过 v-model 双向绑定一个字符串数组；不直接修改 props，统一以新数组向上抛出。
const props = defineProps({
  modelValue: { type: Array, required: true },
  min: { type: Number, default: 2 },
  max: { type: Number, default: 20 }
})
const emit = defineEmits(['update:modelValue'])

function setValue(next) {
  emit('update:modelValue', next)
}

function update(i, val) {
  const next = props.modelValue.map((a, idx) => (idx === i ? val : a))
  setValue(next)
}

function add() {
  if (props.modelValue.length >= props.max) return
  setValue([...props.modelValue, ''])
}

function remove(i) {
  if (props.modelValue.length <= props.min) return
  setValue(props.modelValue.filter((_, idx) => idx !== i))
}

function move(i, dir) {
  const j = i + dir
  if (j < 0 || j >= props.modelValue.length) return
  const next = [...props.modelValue]
  ;[next[i], next[j]] = [next[j], next[i]]
  setValue(next)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(answer, i) in modelValue"
      :key="i"
      class="flex items-center gap-2 rounded-xl border border-oat-200 bg-oat-50/60 px-2 py-1.5"
    >
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-ink/60"
      >
        {{ i + 1 }}
      </span>

      <input
        :value="answer"
        type="text"
        class="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink outline-none transition focus:border-calm focus:bg-white"
        :placeholder="`答案 ${i + 1}`"
        spellcheck="false"
        @input="update(i, $event.target.value)"
      />

      <div class="flex shrink-0 items-center gap-1">
        <button
          class="stepper-btn h-7 w-7"
          title="上移"
          :disabled="i === 0"
          @click="move(i, -1)"
        >
          ↑
        </button>
        <button
          class="stepper-btn h-7 w-7"
          title="下移"
          :disabled="i === modelValue.length - 1"
          @click="move(i, 1)"
        >
          ↓
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-oat-200 bg-white text-base text-ink/60 transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          title="删除"
          :disabled="modelValue.length <= min"
          @click="remove(i)"
        >
          ×
        </button>
      </div>
    </div>

    <button
      class="rounded-xl border border-dashed border-calm/40 bg-calm/5 px-4 py-2.5 text-sm font-medium text-calm transition hover:border-calm hover:bg-calm/10 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="modelValue.length >= max"
      @click="add"
    >
      ＋ 新增答案（{{ modelValue.length }}/{{ max }}）
    </button>
  </div>
</template>
