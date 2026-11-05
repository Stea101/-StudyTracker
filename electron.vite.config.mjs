import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  // 密钥与个人信息都不写进源码：从项目根的 .env 读取（.env 已加入 .gitignore），
  // 构建时注入主进程，源码与仓库里都不会出现真实值。
  const env = loadEnv(mode, process.cwd(), '')
  const showapiKey = env.SHOWAPI_KEY || ''
  const feedbackEmail = env.FEEDBACK_EMAIL || ''

  return {
    main: {
      define: {
        __SHOWAPI_KEY__: JSON.stringify(showapiKey),
        __FEEDBACK_EMAIL__: JSON.stringify(feedbackEmail)
      }
    },
    preload: {},
    renderer: {
      plugins: [vue()]
    }
  }
})
