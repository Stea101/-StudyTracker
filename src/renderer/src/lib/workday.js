// 中国大陆「法定工作日」判定（含法定节假日与调休上班日）。
//
// 数据来源：国务院办公厅《关于部分节假日安排的通知》
//   · 2024 年：国办发明电〔2023〕7 号 https://www.gov.cn/zhengce/content/202310/content_6911527.htm
//   · 2025 年：国办发明电〔2024〕7 号（2024-11-12 发布，新华社受权发布）
//   · 2026 年：国办发明电〔2025〕7 号 https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
//
// 说明：本文件是纯本地静态数据，不含任何网络请求。若某一年份尚未收录
// （每年 11 月左右国务院才公布次年安排），isStatutoryWorkday 会退化为
// 「周一~周五算工作日」，并通过 isCalendarCovered 暴露该信息，界面据此给出提示。

import { fmtDate, parseDate } from './date'

// 已收录官方安排的年份
export const COVERED_YEARS = [2024, 2025, 2026]

// 法定放假日（区间，含首尾；落在周一~周五时也不上班）
const HOLIDAY_RANGES = [
  // ---- 2024 ----
  ['2024-01-01', '2024-01-01'], // 元旦（与周末连休）
  ['2024-02-10', '2024-02-17'], // 春节
  ['2024-04-04', '2024-04-06'], // 清明
  ['2024-05-01', '2024-05-05'], // 劳动节
  ['2024-06-10', '2024-06-10'], // 端午
  ['2024-09-15', '2024-09-17'], // 中秋
  ['2024-10-01', '2024-10-07'], // 国庆
  // ---- 2025 ----
  ['2025-01-01', '2025-01-01'], // 元旦
  ['2025-01-28', '2025-02-04'], // 春节（除夕起 8 天）
  ['2025-04-04', '2025-04-06'], // 清明
  ['2025-05-01', '2025-05-05'], // 劳动节
  ['2025-05-31', '2025-06-02'], // 端午
  ['2025-10-01', '2025-10-08'], // 国庆 + 中秋
  // ---- 2026 ----
  ['2026-01-01', '2026-01-03'], // 元旦（1/4 周日上班）
  ['2026-02-15', '2026-02-23'], // 春节（9 天）
  ['2026-04-04', '2026-04-06'], // 清明
  ['2026-05-01', '2026-05-05'], // 劳动节
  ['2026-06-19', '2026-06-21'], // 端午
  ['2026-09-25', '2026-09-27'], // 中秋
  ['2026-10-01', '2026-10-07'] // 国庆
]

// 调休上班日（即使落在周六 / 周日也上班）
const MAKEUP_WORKDAY_LIST = [
  // ---- 2024 ----
  '2024-02-04', '2024-02-18', // 春节调休
  '2024-04-07', // 清明调休
  '2024-04-28', '2024-05-11', // 劳动节调休
  '2024-09-14', // 中秋调休
  '2024-09-29', '2024-10-12', // 国庆调休
  // ---- 2025 ----
  '2025-01-26', '2025-02-08', // 春节调休
  '2025-04-27', // 劳动节调休
  '2025-09-28', '2025-10-11', // 国庆调休
  // ---- 2026 ----
  '2026-01-04', // 元旦调休
  '2026-02-14', '2026-02-28', // 春节调休
  '2026-05-09', // 劳动节调休
  '2026-09-20', '2026-10-10' // 国庆调休
]

function expandRanges(ranges) {
  const set = new Set()
  for (const [from, to] of ranges) {
    const cursor = parseDate(from)
    const last = parseDate(to)
    while (cursor <= last) {
      set.add(fmtDate(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return set
}

const HOLIDAYS = expandRanges(HOLIDAY_RANGES)
const MAKEUP_WORKDAYS = new Set(MAKEUP_WORKDAY_LIST)

const toKey = (date) => (typeof date === 'string' ? date : fmtDate(date))

/** 是否为法定放假日（元旦 / 春节 / 清明 / 劳动节 / 端午 / 中秋 / 国庆） */
export function isHoliday(date) {
  return HOLIDAYS.has(toKey(date))
}

/** 是否为调休上班日（周末但需要上班） */
export function isMakeupWorkday(date) {
  return MAKEUP_WORKDAYS.has(toKey(date))
}

/** 是否为法定工作日：调休上班日算上班；法定放假日不算；其余按周一~周五 */
export function isStatutoryWorkday(date) {
  const key = toKey(date)
  if (MAKEUP_WORKDAYS.has(key)) return true
  if (HOLIDAYS.has(key)) return false
  const dow = (typeof date === 'string' ? parseDate(date) : date).getDay()
  return dow >= 1 && dow <= 5
}

/** 该日期所属年份是否已有官方节假日安排数据 */
export function isCalendarCovered(date) {
  const year = (typeof date === 'string' ? parseDate(date) : date).getFullYear()
  return COVERED_YEARS.includes(year)
}
