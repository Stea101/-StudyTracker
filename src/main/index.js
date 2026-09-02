import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { request as httpsRequest } from 'https'
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
          newsApiKeyEnc: ''
        },
        null,
        2
      ),
      'utf-8'
    )
  }
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
      newsApiKeyEnc: data && typeof data.newsApiKeyEnc === 'string' ? data.newsApiKeyEnc : ''
    }
  } catch (err) {
    console.error('读取数据失败:', err)
    return {
      motto: '',
      records: {},
      pomodoro: {},
      pomodoroSettings: { focusMinutes: 25, restMinutes: 5 },
      newsApiKeyEnc: ''
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
      data && typeof data.newsApiKeyEnc === 'string' ? data.newsApiKeyEnc : current.newsApiKeyEnc
  }
  // 先写临时文件再原子重命名，避免写入中断导致数据损坏
  const tmpFile = dataFile() + '.tmp'
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(tmpFile, dataFile())
  return true
}

// ---------- 新闻 API 密钥（加密存储） ----------
// 默认密钥：仅当用户尚未在设置中保存过自己的密钥时作为兜底使用
const DEFAULT_SHOWAPI_KEY = ''

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
    const json = await requestHotNews(getEffectiveApiKey(data))
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
