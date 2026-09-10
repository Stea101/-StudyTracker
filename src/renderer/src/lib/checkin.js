// 打卡计划：重复规则判定、时间段状态、统计聚合。
// 数据模型（存于 data.json）：
//   checkinPlans: [{ id, name, repeat, customDays[], startDate, endDate, slots[{ id, name, start, end }], createdAt }]
//   checkinLogs:  { [planId]: { [YYYY-MM-DD]: { [slotId]: { at: 'HH:mm', ts: 1700000000000 } } } }
// 约定：customDays 使用 JS getDay() 取值 —— 0=周日，1=周一 … 6=周六。

import {
  fmtDate,
  parseDate,
  addDays,
  timeToMinutes,
  minutesOfDay,
  diffDays,
  formatMinutes,
  WEEKDAY_LABELS
} from './date'
import { isStatutoryWorkday } from './workday'

// 统计时最多回看的天数，避免计划起始日过早导致超长循环
const MAX_LOOKBACK_DAYS = 730

export const REPEAT_OPTIONS = [
  { id: 'daily', label: '每天', desc: '每天都打卡，不区分工作日与周末' },
  { id: 'weekdays', label: '周一至周五', desc: '每周一至周五打卡' },
  { id: 'workdays', label: '法定工作日', desc: '按国家法定工作日，自动跳过节假日、包含调休上班日' },
  { id: 'weekends', label: '周末', desc: '每周六、周日打卡' },
  { id: 'custom', label: '自定义星期', desc: '自行勾选每周需要打卡的日子' }
]

export function repeatLabel(plan) {
  const days = Array.isArray(plan.customDays) ? [...plan.customDays].sort((a, b) => a - b) : []
  switch (plan.repeat) {
    case 'weekdays':
      return '周一至周五'
    case 'weekends':
      return '周末（周六、周日）'
    case 'workdays':
      return '法定工作日（含调休上班日）'
    case 'custom':
      return days.length ? `自定义：${days.map((d) => WEEKDAY_LABELS[d] || '?').join('、')}` : '自定义（未选择）'
    case 'daily':
    default:
      return '每天'
  }
}

export function scheduleLabel(plan) {
  const from = plan.startDate || '不限'
  const to = plan.endDate || '长期有效'
  return `${from} ~ ${to}`
}

/** 计划在指定日期是否需要打卡（同时校验生效区间与重复规则） */
export function planAppliesOn(plan, date) {
  const key = fmtDate(date)
  if (plan.startDate && key < plan.startDate) return false
  if (plan.endDate && key > plan.endDate) return false
  const dow = date.getDay()
  switch (plan.repeat) {
    case 'weekdays':
      return dow >= 1 && dow <= 5
    case 'weekends':
      return dow === 0 || dow === 6
    case 'workdays':
      return isStatutoryWorkday(date)
    case 'custom':
      return Array.isArray(plan.customDays) && plan.customDays.includes(dow)
    case 'daily':
    default:
      return true
  }
}

/**
 * 单个打卡项在某天的状态。
 * @returns {{key:'done'|'active'|'upcoming'|'missed', done:object|null, startsIn?:number, endsIn?:number, progress?:number}}
 */
export function slotStatus(slot, dateKey, dateObj, dayLogs, now) {
  const record = dayLogs && dayLogs[slot.id] ? dayLogs[slot.id] : null
  if (record) return { key: 'done', done: record }

  const todayKey = fmtDate(now)
  if (dateKey !== todayKey) {
    return { key: dateKey < todayKey ? 'missed' : 'upcoming' }
  }

  const start = timeToMinutes(slot.start)
  const end = timeToMinutes(slot.end)
  const cur = minutesOfDay(now)
  if (start === null || end === null) return { key: 'upcoming' }
  if (cur < start) return { key: 'upcoming', startsIn: start - cur }
  if (cur <= end) return { key: 'active', endsIn: end - cur, progress: end > start ? (cur - start) / (end - start) : 1 }
  return { key: 'missed' }
}

const STATUS_ORDER = { active: 0, missed: 1, upcoming: 2, done: 3 }

/** 今天所有计划里需要打卡的时段（含状态），用于首页一键打卡 */
export function todayTasks(plans, logs, now) {
  const dateKey = fmtDate(now)
  const tasks = []
  for (const plan of plans || []) {
    if (!planAppliesOn(plan, now)) continue
    const dayLogs = (logs && logs[plan.id] && logs[plan.id][dateKey]) || null
    for (const slot of plan.slots || []) {
      const st = slotStatus(slot, dateKey, now, dayLogs, now)
      tasks.push({
        planId: plan.id,
        planName: plan.name,
        slot,
        dateKey,
        status: st.key,
        done: st.done || null,
        startsIn: st.startsIn,
        endsIn: st.endsIn,
        progress: st.progress
      })
    }
  }
  return tasks.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (timeToMinutes(a.slot.start) ?? 0) - (timeToMinutes(b.slot.start) ?? 0)
  )
}

export function slotStatusText(task) {
  switch (task.status) {
    case 'done':
      return `已于 ${task.done && task.done.at ? task.done.at : '--:--'} 打卡`
    case 'active':
      return `进行中 · 剩余 ${formatMinutes(task.endsIn)}`
    case 'upcoming':
      return task.startsIn != null ? `未开始 · ${formatMinutes(task.startsIn)}后开始` : '未开始'
    case 'missed':
      return '已错过打卡时段'
    default:
      return ''
  }
}

/** 计划起始日：优先 startDate，其次最早的打卡记录，最后今天 */
function planStartKey(plan, logs, todayKey) {
  if (plan.startDate && /^\d{4}-\d{2}-\d{2}$/.test(plan.startDate)) return plan.startDate
  const keys = Object.keys((logs && logs[plan.id]) || {}).sort()
  return keys.length ? keys[0] : todayKey
}

/**
 * 单个计划的统计：累计打卡次数、完成率、连续达标天数、每日趋势、各时段完成率。
 * @param {string} todayKey 'YYYY-MM-DD'
 */
export function planStats(plan, logs, todayKey, trendDays = 14) {
  const today = parseDate(todayKey)
  const planLogs = (logs && logs[plan.id]) || {}
  const slots = Array.isArray(plan.slots) ? plan.slots : []

  const startKey = planStartKey(plan, logs, todayKey)
  const start = parseDate(startKey)
  const lastDay = plan.endDate && plan.endDate < todayKey ? parseDate(plan.endDate) : today
  // 起始日过早时限定期最多回看 MAX_LOOKBACK_DAYS 天
  const loopStart = diffDays(start, lastDay) > MAX_LOOKBACK_DAYS ? addDays(lastDay, -MAX_LOOKBACK_DAYS) : start

  const perSlotDone = new Map(slots.map((s) => [s.id, 0]))
  let expected = 0
  let completed = 0
  let activeDays = 0
  let perfectDays = 0

  for (let cursor = new Date(loopStart); cursor <= lastDay; cursor = addDays(cursor, 1)) {
    if (!planAppliesOn(plan, cursor)) continue
    activeDays += 1
    expected += slots.length
    const dayLogs = planLogs[fmtDate(cursor)] || {}
    let doneToday = 0
    for (const slot of slots) {
      if (dayLogs[slot.id]) {
        doneToday += 1
        perSlotDone.set(slot.id, (perSlotDone.get(slot.id) || 0) + 1)
      }
    }
    completed += doneToday
    if (slots.length > 0 && doneToday === slots.length) perfectDays += 1
  }

  const completionRate = expected ? Math.min(100, Math.round((completed / expected) * 100)) : 0

  // 连续达标：从今天（今天未全部完成则从昨天）往回数连续「全部完成」的生效日
  const fullyDone = (day) => {
    if (slots.length === 0) return false
    const dayLogs = planLogs[fmtDate(day)] || {}
    return slots.every((s) => !!dayLogs[s.id])
  }
  let streak = 0
  let cursor = new Date(today)
  if (planAppliesOn(plan, cursor) && !fullyDone(cursor)) cursor = addDays(cursor, -1)
  for (let i = 0; i < MAX_LOOKBACK_DAYS && cursor >= start; i++) {
    if (planAppliesOn(plan, cursor)) {
      if (!fullyDone(cursor)) break
      streak += 1
    }
    cursor = addDays(cursor, -1)
  }

  const trend = []
  for (let i = trendDays - 1; i >= 0; i--) {
    const day = addDays(today, -i)
    const key = fmtDate(day)
    const applies = planAppliesOn(plan, day)
    const dayLogs = planLogs[key] || {}
    trend.push({
      key,
      label: key.slice(5),
      applies,
      done: slots.filter((s) => dayLogs[s.id]).length,
      expected: applies ? slots.length : 0
    })
  }

  const slotStats = slots.map((slot) => {
    const done = perSlotDone.get(slot.id) || 0
    return {
      slot,
      done,
      expected: activeDays,
      rate: activeDays ? Math.min(100, Math.round((done / activeDays) * 100)) : 0
    }
  })

  const todayApplies = planAppliesOn(plan, today)
  const todayLogs = planLogs[todayKey] || {}

  return {
    startKey,
    activeDays,
    expected,
    completed,
    completionRate,
    perfectDays,
    streak,
    trend,
    slotStats,
    todayApplies,
    todayDone: slots.filter((s) => todayLogs[s.id]).length,
    todayExpected: slots.length
  }
}

/** 某天该计划的完成情况，用于计划列表卡片上的「今日 n/N」 */
export function planDayProgress(plan, logs, dateKey) {
  const dayLogs = (logs && logs[plan.id] && logs[plan.id][dateKey]) || {}
  const slots = Array.isArray(plan.slots) ? plan.slots : []
  return { done: slots.filter((s) => dayLogs[s.id]).length, total: slots.length }
}

/** 最近的打卡明细（用于计划详情页的「最近打卡记录」） */
export function recentCheckinRecords(plan, logs, limit = 8) {
  const planLogs = (logs && logs[plan.id]) || {}
  const byId = new Map((plan.slots || []).map((s) => [s.id, s]))
  const rows = []
  for (const [date, dayLogs] of Object.entries(planLogs)) {
    for (const [slotId, rec] of Object.entries(dayLogs || {})) {
      const slot = byId.get(slotId)
      rows.push({
        date,
        slotId,
        slotName: slot ? slot.name : '（打卡项已删除）',
        at: (rec && rec.at) || '',
        ts: (rec && rec.ts) || 0
      })
    }
  }
  rows.sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1))
  return rows.slice(0, limit)
}
