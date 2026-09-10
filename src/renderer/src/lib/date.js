// 日期 / 时间小工具（渲染进程内共用，纯函数、无副作用）
export const pad = (n) => String(n).padStart(2, '0')

// Date -> 'YYYY-MM-DD'（本地时区，作为记录 key）
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 'YYYY-MM-DD' -> Date（本地零点）
export const parseDate = (str) => {
  const [y, m, d] = String(str).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export const addDays = (d, n) => {
  const x = startOfDay(d)
  x.setDate(x.getDate() + n)
  return x
}

// 相差天数（b - a，按自然日计算）
export const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000)

// 'HH:mm' -> 当日分钟数（0~1439）；非法输入返回 null
export const timeToMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// Date -> 当日分钟数（含秒的小数部分，便于做秒级倒计时）
export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60

// 分钟数 -> 'HH:mm'
export const minutesToTime = (min) => {
  const m = Math.max(0, Math.min(1439, Math.round(min)))
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

// 分钟数 -> 人类可读文案（用于倒计时 / 时长展示）
export const formatMinutes = (min) => {
  const s = Math.max(0, Math.round(min))
  const h = Math.floor(s / 60)
  const m = s % 60
  if (h && m) return `${h} 小时 ${m} 分钟`
  if (h) return `${h} 小时`
  return `${m} 分钟`
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

// 生成唯一 id（计划 / 打卡项）
export const makeId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
