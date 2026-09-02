/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // 深墨色文字
        ink: '#3f4a52',
        // 舒缓的浅蓝色系（保存按钮 / 强调）
        calm: {
          DEFAULT: '#6b9cbd',
          dark: '#587f9b',
          light: '#eaf1f6'
        },
        // 燕麦 / 暖白背景色系
        oat: {
          50: '#faf7f2',
          100: '#f5f0eb',
          200: '#e7ded2'
        },
        // 莫兰迪点缀色
        sage: '#a8c3b8',
        blush: '#d8b4a0'
      }
    }
  },
  plugins: []
}
