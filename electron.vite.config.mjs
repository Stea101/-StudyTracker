import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  // 新闻 API 密钥不写进源码：从项目根的 .env 读取（.env 已加入 .gitignore），
  // 构建时注入主进程，源码与仓库里都不会出现真实密钥。
  const env = loadEnv(mode, process.cwd(), '')
  const showapiKey = env.SHOWAPI_KEY || ''

  return {
    main: {
      define: {
        __SHOWAPI_KEY__: JSON.stringify(showapiKey)
      }
    },
    preload: {},
    renderer: {
      plugins: [vue()]
    }
  }
})
