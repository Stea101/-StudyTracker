import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join, basename } from 'path'
import { promises as fs, existsSync } from 'fs'
import { request as httpsRequest } from 'https'
import { execFile, spawn } from 'child_process'
import { release as osRelease } from 'os'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// 数据固定存放在用户文档目录：~/Documents/StudyTracker/data.json
const dataDir = () => join(app.getPath('documents'), 'StudyTracker')
const dataFile = () => join(dataDir(), 'data.json')

async function ensureDataFile() {
  await fs.mkdir(dataDir(), { recursive: true })
  try {
    await fs.access(dataFile())
  } catch {
    await fs.writeFile(
      dataFile(),
      JSON.stringify(
        {
          motto: '',
          records: {},
          pomodoro: {},
          pomodoroSettings: { focusMinutes: 25, restMinutes: 5 },
          newsApiKeyEnc: '',
          decision: { templates: [], current: { question: '', answers: [] } },
          checkinPlans: [],
          checkinLogs: {}
        },
        null,
        2
      ),
      'utf-8'
    )
  }
}

// 「做个决定」数据归一化：自定义模板（最多 10 个，每项至少 2 个答案）+ 当前编辑中的决定
function normalizeDecision(d) {
  const templates = Array.isArray(d && d.templates)
    ? d.templates
        .filter(
          (t) =>
            t &&
            typeof t === 'object' &&
            typeof t.name === 'string' &&
            t.name.trim() &&
            Array.isArray(t.answers)
        )
        .map((t) => ({
          id:
            typeof t.id === 'string' && t.id
              ? t.id
              : `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: t.name.trim(),
          answers: t.answers.map((a) => String(a).trim()).filter((a) => a.length > 0)
        }))
        .filter((t) => t.answers.length >= 2)
        .slice(0, 10)
    : []

  const current =
    d && d.current && typeof d.current === 'object'
      ? {
          question: typeof d.current.question === 'string' ? d.current.question : '',
          answers: Array.isArray(d.current.answers)
            ? d.current.answers.map((a) => String(a)).slice(0, 20)
            : []
        }
      : { question: '', answers: [] }

  return { templates, current }
}

// ---------- 打卡计划 / 打卡记录 数据归一化 ----------
// 渲染进程是打卡计划的唯一写入方，这里只做防御性清洗：
// 过滤明显的脏数据、补全缺失 id / 时间格式，避免手改 data.json 后界面崩溃。
const REPEAT_IDS = ['daily', 'weekdays', 'workdays', 'weekends', 'custom']
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const rnd = () => Math.random().toString(36).slice(2, 8)

function normalizeCheckinPlans(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `plan-${Date.now()}-${rnd()}`,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '未命名打卡计划',
      repeat: REPEAT_IDS.includes(p.repeat) ? p.repeat : 'daily',
      customDays: Array.isArray(p.customDays)
        ? [...new Set(p.customDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
            (a, b) => a - b
          )
        : [1, 2, 3, 4, 5],
      startDate: typeof p.startDate === 'string' && DATE_RE.test(p.startDate) ? p.startDate : '',
      endDate: typeof p.endDate === 'string' && DATE_RE.test(p.endDate) ? p.endDate : '',
      slots: (Array.isArray(p.slots) ? p.slots : [])
        .filter((s) => s && typeof s === 'object')
        .slice(0, 12)
        .map((s) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `slot-${Date.now()}-${rnd()}`,
          name: typeof s.name === 'string' ? s.name.trim() : '',
          start: typeof s.start === 'string' && TIME_RE.test(s.start) ? s.start : '08:00',
          end: typeof s.end === 'string' && TIME_RE.test(s.end) ? s.end : '09:00'
        })),
      createdAt: Number(p.createdAt) || 0
    }))
    .slice(0, 30)
}

function normalizeCheckinLogs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [planId, days] of Object.entries(value)) {
    if (!planId || !days || typeof days !== 'object' || Array.isArray(days)) continue
    const dayOut = {}
    for (const [date, slots] of Object.entries(days)) {
      if (!DATE_RE.test(date) || !slots || typeof slots !== 'object' || Array.isArray(slots)) continue
      const slotOut = {}
      for (const [slotId, rec] of Object.entries(slots)) {
        if (!slotId || !rec || typeof rec !== 'object') continue
        slotOut[slotId] = {
          at: typeof rec.at === 'string' && TIME_RE.test(rec.at) ? rec.at : '',
          ts: Number(rec.ts) || 0
        }
      }
      if (Object.keys(slotOut).length) dayOut[date] = slotOut
    }
    if (Object.keys(dayOut).length) out[planId] = dayOut
  }
  return out
}

async function readData() {
  await ensureDataFile()
  try {
    const raw = await fs.readFile(dataFile(), 'utf-8')
    const data = JSON.parse(raw)
    return {
      motto: data && typeof data.motto === 'string' ? data.motto : '',
      records: data && data.records && typeof data.records === 'object' ? data.records : {},
      pomodoro: data && data.pomodoro && typeof data.pomodoro === 'object' ? data.pomodoro : {},
      pomodoroSettings:
        data && data.pomodoroSettings && typeof data.pomodoroSettings === 'object'
          ? {
              focusMinutes:
                Number(data.pomodoroSettings.focusMinutes) > 0
                  ? Number(data.pomodoroSettings.focusMinutes)
                  : 25,
              restMinutes:
                Number(data.pomodoroSettings.restMinutes) > 0
                  ? Number(data.pomodoroSettings.restMinutes)
                  : 5
            }
          : { focusMinutes: 25, restMinutes: 5 },
      newsApiKeyEnc: data && typeof data.newsApiKeyEnc === 'string' ? data.newsApiKeyEnc : '',
      decision: normalizeDecision(data),
      checkinPlans: normalizeCheckinPlans(data && data.checkinPlans),
      checkinLogs: normalizeCheckinLogs(data && data.checkinLogs)
    }
  } catch (err) {
    console.error('读取数据失败:', err)
    return {
      motto: '',
      records: {},
      pomodoro: {},
      pomodoroSettings: { focusMinutes: 25, restMinutes: 5 },
      newsApiKeyEnc: '',
      decision: { templates: [], current: { question: '', answers: [] } },
      checkinPlans: [],
      checkinLogs: {}
    }
  }
}

async function writeData(data) {
  await ensureDataFile()
  // 合并写入：未提供的字段沿用现有值，避免渲染进程的局部写入覆盖掉 API 密钥等其它数据
  const current = await readData()
  const payload = {
    motto: data && typeof data.motto === 'string' ? data.motto : current.motto,
    records: data && data.records && typeof data.records === 'object' ? data.records : current.records,
    pomodoro:
      data && data.pomodoro && typeof data.pomodoro === 'object' ? data.pomodoro : current.pomodoro,
    pomodoroSettings:
      data && data.pomodoroSettings && typeof data.pomodoroSettings === 'object'
        ? data.pomodoroSettings
        : current.pomodoroSettings,
    newsApiKeyEnc:
      data && typeof data.newsApiKeyEnc === 'string' ? data.newsApiKeyEnc : current.newsApiKeyEnc,
    decision:
      data && data.decision && typeof data.decision === 'object'
        ? data.decision
        : current.decision,
    checkinPlans:
      data && Array.isArray(data.checkinPlans)
        ? normalizeCheckinPlans(data.checkinPlans)
        : current.checkinPlans,
    checkinLogs:
      data && data.checkinLogs && typeof data.checkinLogs === 'object'
        ? normalizeCheckinLogs(data.checkinLogs)
        : current.checkinLogs
  }
  // 先写临时文件再原子重命名，避免写入中断导致数据损坏
  const tmpFile = dataFile() + '.tmp'
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(tmpFile, dataFile())
  return true
}

// ---------- 新闻 API 密钥（加密存储） ----------
// 默认密钥绝不硬编码在源码里：
// 1. 构建期由 electron.vite.config.mjs 从项目根 .env 读取 SHOWAPI_KEY 并注入（.env 已被 .gitignore 忽略）；
// 2. 也可在运行时用同名环境变量 SHOWAPI_KEY 覆盖（便于 CI / 免重新构建地更换密钥）。
// 两者都没有时为 ""，此时「今日新闻」会提示用户去「设置 → 新闻 API 密钥」填写自己的密钥。
const DEFAULT_SHOWAPI_KEY = (() => {
  const injected = typeof __SHOWAPI_KEY__ === 'string' ? __SHOWAPI_KEY__.trim() : ''
  return injected || (process.env.SHOWAPI_KEY || '').trim()
})()

// 本地静止数据加密：密钥持久化到 data.json 时以 AES-256-GCM 密文保存，
// 避免明文密钥直接暴露在磁盘文件中（本机数据的轻度混淆防护）。
// 密钥派生自固定口令与盐，不随机器变化，便于 data.json 整体迁移。
const API_KEY_SECRET = 'StudyTracker.newsApiKey.local.v1'
const API_KEY_SALT = 'StudyTracker.newsApiKey.salt.v1'
const API_KEY_CRYPTO = scryptSync(API_KEY_SECRET, API_KEY_SALT, 32)

function encryptApiKey(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', API_KEY_CRYPTO, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

function decryptApiKey(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('密钥密文格式无效')
  const decipher = createDecipheriv('aes-256-gcm', API_KEY_CRYPTO, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}

function getEffectiveApiKey(data) {
  if (data && data.newsApiKeyEnc) {
    try {
      return decryptApiKey(data.newsApiKeyEnc)
    } catch (err) {
      console.error('解密 API 密钥失败，回退到默认密钥:', err)
      return DEFAULT_SHOWAPI_KEY
    }
  }
  return DEFAULT_SHOWAPI_KEY
}

// 仅显示首尾各 4 个字符，中间以 **** 遮掩（密钥完整值只在输入时可见）
function maskApiKey(key) {
  const k = key || ''
  if (!k) return ''
  if (k.length <= 8) return `${k.slice(0, 2)}****${k.slice(-2)}`
  return `${k.slice(0, 4)}****${k.slice(-4)}`
}

// ---------- 新闻接口（万维易源 ShowAPI） ----------
function requestHotNews(apiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://route.showapi.com/109-37?appKey=${encodeURIComponent(apiKey)}`)
    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk) => (raw += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            reject(new Error('响应解析失败'))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    req.end()
  })
}

async function fetchHotNews() {
  try {
    const data = await readData()
    const apiKey = getEffectiveApiKey(data)
    if (!apiKey) {
      return { ok: false, error: '未配置新闻 API 密钥，请在「设置 → 新闻 API 密钥」中填写' }
    }
    const json = await requestHotNews(apiKey)
    if (json.showapi_res_code !== 0) {
      return { ok: false, error: json.showapi_res_error || '接口调用失败' }
    }
    const body = json.showapi_res_body || {}
    if (body.ret_code !== 0 && body.ret_code !== '0') {
      return { ok: false, error: body.remark || '新闻数据获取失败' }
    }
    return {
      ok: true,
      top: Array.isArray(body.top) ? body.top : [],
      hot: Array.isArray(body.hot) ? body.hot : []
    }
  } catch (err) {
    const detail =
      err && err.message === '请求超时' ? '请求超时，请稍后重试' : (err && err.message) || '网络请求失败'
    return { ok: false, error: `新闻加载失败：${detail}` }
  }
}

// ---------- 问题反馈（拉取系统默认邮件客户端） ----------
// 开发者邮箱：反馈邮件的收件人，同时作为拉起失败时展示给用户的兜底信息
const FEEDBACK_EMAIL = 'dev@example.com'

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 检测系统是否注册了 mailto 协议处理器。
// 未注册时 shell.openExternal 在 Windows 上不一定报错（可能只弹出「你要如何打开？」选择框），
// 因此这里先查注册表预检，好给用户一个明确的失败提示。
function hasMailtoHandler() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(true)
    execFile(
      'reg.exe',
      ['query', 'HKCR\\mailto\\shell\\open\\command'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(false)
        resolve(typeof stdout === 'string' && /REG_(SZ|EXPAND_SZ)/i.test(stdout))
      }
    )
  })
}

function withTimeout(promise, ms, message) {
  let timer = null
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
  ])
}

// 邮件正文：用户填写的内容 + 应用版本 / 系统环境（便于定位问题）
function composeFeedbackBody(content) {
  const now = new Date()
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  const text = typeof content === 'string' ? content.trim() : ''
  return [
    text || '（请在这里描述你发现的问题或建议）',
    '',
    '------------------------------',
    `应用版本：${app.getVersion()}`,
    `系统环境：${process.platform === 'win32' ? 'Windows' : process.platform} ${osRelease()} (${process.arch})`,
    `反馈时间：${stamp}`
  ].join('\r\n')
}

// mailto 链接：收件人 + 主题 + 正文（正文换行统一为 CRLF，兼容各邮件客户端）
function buildMailtoUrl(to, subject, body) {
  const parts = []
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`)
  if (body) parts.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${to}${parts.length ? `?${parts.join('&')}` : ''}`
}

// ---------- 枚举本机已安装的邮件客户端 ----------
// Windows 把已注册的邮件客户端登记在注册表 Clients\Mail 下（每个客户端带一条
// shell\open\command 命令行模板，%1 即 mailto 链接）。枚举出来后由用户每次自行选择，
// 从而绕开「Windows 会把 mailto 默认程序记住、之后不再询问」的限制。
let lastMailClients = []

// PowerShell 脚本：以 UTF-8 输出 JSON，避免中文客户端名称乱码。
// 两个来源合并（顺序很重要：先取传统注册方式，它的显示名更干净）：
//   1) Clients\Mail\<客户端>\Protocols\mailto\shell\open\command —— 传统邮件客户端注册
//   2) RegisteredApplications -> Capabilities\URLAssociations\mailto -> ProgId 的
//      shell\open\command —— 现代注册方式（浏览器等也在这里，可用于网页邮箱）
const PS_LIST_MAIL_CLIENTS = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$list = New-Object System.Collections.ArrayList

function Add-Entry($name, $command) {
  if ([string]::IsNullOrWhiteSpace($command)) { return }
  # 跳过 rundll32 之类的系统垫片：它们不是用户可感知的邮件软件
  if ($command -match '(?i)rundll32\\.exe') { return }
  $null = $list.Add([pscustomobject]@{ name = "$name"; command = "$command" })
}

# 1) 传统注册方式
foreach ($root in @('HKLM:\\SOFTWARE\\Clients\\Mail','HKCU:\\SOFTWARE\\Clients\\Mail','HKLM:\\SOFTWARE\\WOW6432Node\\Clients\\Mail')) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  foreach ($item in @(Get-ChildItem -LiteralPath $root)) {
    $cmdPath = $item.PSPath + '\\Protocols\\mailto\\shell\\open\\command'
    if (-not (Test-Path -LiteralPath $cmdPath)) { continue }
    $cmd = (Get-Item -LiteralPath $cmdPath).GetValue('')
    $display = (Get-Item -LiteralPath $item.PSPath).GetValue('')
    if ([string]::IsNullOrWhiteSpace($display)) { $display = $item.PSChildName }
    Add-Entry $display $cmd
  }
}

# 2) 现代注册方式
foreach ($appName in (Get-Item -LiteralPath 'HKLM:\\SOFTWARE\\RegisteredApplications').GetValueNames()) {
  $cap = (Get-Item -LiteralPath 'HKLM:\\SOFTWARE\\RegisteredApplications').GetValue($appName)
  if ([string]::IsNullOrWhiteSpace($cap)) { continue }
  $assoc = "HKLM:\\$cap\\URLAssociations"
  if (-not (Test-Path -LiteralPath $assoc)) { continue }
  $progId = (Get-ItemProperty -LiteralPath $assoc).mailto
  if ([string]::IsNullOrWhiteSpace($progId)) { continue }
  $cmdKey = "Registry::HKEY_CLASSES_ROOT\\$progId\\shell\\open\\command"
  if (-not (Test-Path -LiteralPath $cmdKey)) { continue }
  $cmd = (Get-Item -LiteralPath $cmdKey).GetValue('')
  $display = (Get-ItemProperty -LiteralPath "HKLM:\\$cap" -Name 'ApplicationName').ApplicationName
  # ApplicationName 可能是 @dll,-123 形式的间接资源串，这种就用注册项名字兜底
  if ([string]::IsNullOrWhiteSpace($display) -or $display.StartsWith('@')) { $display = $appName }
  Add-Entry $display $cmd
}

ConvertTo-Json -InputObject @($list) -Compress -Depth 4
`

function runPowerShell(script, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const options = {
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      options,
      (err, stdout) => {
        if (err && err.code === 'ENOENT') {
          // 极少数环境只装了 PowerShell 7
          execFile(
            'pwsh.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            options,
            (err2, stdout2) => (err2 ? reject(err2) : resolve(stdout2))
          )
          return
        }
        if (err) return reject(err)
        resolve(stdout)
      }
    )
  })
}

// 展开命令行模板里的 %SystemRoot% 之类环境变量
function expandEnvVars(text) {
  return String(text).replace(/%([^%]+)%/g, (whole, name) => {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === String(name).toLowerCase())
    return key ? process.env[key] : whole
  })
}

// 解析注册表里的命令行模板，例如：
//   "C:\Program Files\...\OUTLOOK.EXE" -c IPM.Note /mailto "%1"
// 拆成 { exe, args }，参数中的引号会被去掉，交给 spawn 重新做转义
function parseCommandTemplate(template) {
  const text = expandEnvVars(String(template || '').trim())
  if (!text) return null
  let exe = ''
  let rest = ''
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    if (end === -1) return null
    exe = text.slice(1, end)
    rest = text.slice(end + 1).trim()
  } else {
    const sp = text.search(/\s/)
    if (sp === -1) {
      exe = text
    } else {
      exe = text.slice(0, sp)
      rest = text.slice(sp + 1).trim()
    }
  }
  if (!exe) return null
  const args = []
  const re = /"([^"]*)"|(\S+)/g
  let m
  while ((m = re.exec(rest)) !== null) args.push(m[1] !== undefined ? m[1] : m[2])
  return { exe, args }
}

// 把 mailto 链接填进参数模板；模板里没有 %1 这类占位符时追加到末尾
function buildClientArgs(args, url) {
  const out = []
  let filled = false
  for (const raw of args) {
    if (/%[1lL]/.test(raw)) {
      filled = true
      out.push(raw.replace(/%[1lL]/g, () => url))
    } else {
      out.push(raw)
    }
  }
  if (!filled) out.push(url)
  return out
}

// 「@dll,-123」这类间接资源串不适合直接展示给用户
function isIndirectName(name) {
  const text = String(name || '').trim()
  if (!text) return true
  return text.startsWith('@') || /\.Application\.\d+$/i.test(text)
}

async function queryMailClients() {  if (process.platform !== 'win32') return []
  let stdout = ''
  try {
    stdout = await runPowerShell(PS_LIST_MAIL_CLIENTS)
  } catch (err) {
    console.error('枚举本机邮件客户端失败:', err)
    return []
  }
  const text = String(stdout || '').trim()
  if (!text) return []
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const seen = new Map()
  const clients = []
  for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!item || typeof item.command !== 'string' || !item.command.trim()) continue
    const parsedCmd = parseCommandTemplate(item.command)
    if (!parsedCmd) continue
    // 程序已被卸载 / 路径失效的注册项直接跳过
    if (process.platform === 'win32' && !existsSync(parsedCmd.exe)) continue
    const name = String(item.name || '').trim() || basename(parsedCmd.exe, '.exe')
    // 同一个程序可能被多个注册方式重复登记，按命令行去重
    const dedupeKey = `${parsedCmd.exe.toLowerCase()}|${parsedCmd.args.join(' ').toLowerCase()}`
    if (seen.has(dedupeKey)) {
      // 名称更干净的那条胜出（避免显示成 @dll,-123 这类间接资源串）
      const existing = clients[seen.get(dedupeKey)]
      if (existing && isIndirectName(existing.name) && !isIndirectName(name)) existing.name = name
      continue
    }
    seen.set(dedupeKey, clients.length)
    clients.push({
      id: `mail-${clients.length}`,
      name,
      exeName: basename(parsedCmd.exe),
      command: item.command
    })
  }
  return clients
}

async function listMailClients() {
  lastMailClients = await queryMailClients()
  return lastMailClients
}

// 用指定客户端启动邮件撰写窗口（不走系统默认程序，因此不受「记住上次选择」影响）
function launchMailClient(client, url) {
  return new Promise((resolve, reject) => {
    const parsed = parseCommandTemplate(client.command)
    if (!parsed) return reject(new Error('邮件软件的命令行无法解析'))
    if (process.platform === 'win32' && !existsSync(parsed.exe)) {
      return reject(new Error(`未找到邮件软件程序：${parsed.exe}`))
    }
    const args = buildClientArgs(parsed.args, url)
    let child
    try {
      child = spawn(parsed.exe, args, { detached: true, stdio: 'ignore' })
    } catch (err) {
      return reject(err)
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.unref()
      } catch {
        /* ignore */
      }
      resolve()
    }, 4000)
    child.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.unref()
      resolve()
    })
  })
}

async function openFeedbackMail(payload) {
  const raw = payload && typeof payload.content === 'string' ? payload.content : ''
  const content = raw.slice(0, 4000)
  const clientId = payload && typeof payload.clientId === 'string' ? payload.clientId : 'default'
  const body = composeFeedbackBody(content)
  const url = buildMailtoUrl(FEEDBACK_EMAIL, '【极简学习打卡器】问题反馈', body)

  // 用户明确指定了某个邮件软件：直接用该软件打开，每次都按用户当次的选择执行
  if (clientId !== 'default') {
    const client = lastMailClients.find((c) => c.id === clientId)
    if (!client) {
      return { ok: false, reason: 'client-missing', email: FEEDBACK_EMAIL, body }
    }
    try {
      await launchMailClient(client, url)
      return { ok: true, email: FEEDBACK_EMAIL, body, clientName: client.name }
    } catch (err) {
      return {
        ok: false,
        reason: 'client-launch-failed',
        error: (err && err.message) || '未知错误',
        email: FEEDBACK_EMAIL,
        body,
        clientName: client.name
      }
    }
  }

  if (!(await hasMailtoHandler())) {
    return { ok: false, reason: 'no-mail-client', email: FEEDBACK_EMAIL, body }
  }
  try {
    await withTimeout(shell.openExternal(url), 8000, '拉起邮件客户端超时')
    return { ok: true, email: FEEDBACK_EMAIL, body }
  } catch (err) {
    return {
      ok: false,
      reason: 'open-failed',
      error: (err && err.message) || '未知错误',
      email: FEEDBACK_EMAIL,
      body
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 640,
    minHeight: 520,
    resizable: true,
    center: true,
    show: false,
    autoHideMenuBar: true,
    title: '📚 极简学习打卡器',
    backgroundColor: '#f5f0eb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 开发模式走 dev server，生产模式加载打包后的 HTML
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('data:read', () => readData())
  ipcMain.handle('data:write', (_event, data) => writeData(data))
  ipcMain.handle('news:fetch', () => fetchHotNews())
  ipcMain.handle('news:open', (_event, url) => {
    // 仅允许打开 http/https 链接，防止任意协议注入
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return shell.openExternal(url)
    }
    return false
  })

  // 设置：查看 API 密钥（仅返回脱敏后的首尾字符，完整值不出主进程）
  ipcMain.handle('settings:getApiKey', async () => {
    const data = await readData()
    const key = getEffectiveApiKey(data)
    return { masked: maskApiKey(key), hasKey: !!key }
  })

  // 设置：保存新 API 密钥（加密后覆盖旧密钥）
  ipcMain.handle('settings:saveApiKey', async (_event, newKey) => {
    if (typeof newKey !== 'string' || !newKey.trim()) {
      return { ok: false, error: 'API 密钥不能为空' }
    }
    const trimmed = newKey.trim()
    const newsApiKeyEnc = encryptApiKey(trimmed)
    await writeData({ newsApiKeyEnc })
    return { ok: true, masked: maskApiKey(trimmed) }
  })

  // 设置 → 问题反馈：一键拉起系统默认邮件客户端，收件人预填开发者邮箱
  ipcMain.handle('feedback:openMail', (_event, payload) => openFeedbackMail(payload))

  // 设置 → 问题反馈：枚举本机已安装的邮件客户端（供每次发送前的选择窗口使用）
  ipcMain.handle('feedback:listMailClients', () => listMailClients())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
