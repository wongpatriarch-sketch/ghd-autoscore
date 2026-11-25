import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 正式打包时给页面加一条"内容安全策略"（CSP）。它相当于页面的白名单声明：
// 只允许加载和页面同源的脚本、样式、图片，不允许执行任何外来脚本，也不允许把表单提交到别处。
// 这样即使积分表或导入文件里被人塞了恶意内容，页面也不会替它运行代码。
//   - 样式保留 unsafe-inline：榜单里固定列（名次 / 姓名 / 汇总）的宽度和吸左、吸右位置，
//     是程序运行时直接写在单元格上的"内联样式"，关掉它表格会错位；
//   - 只在 build 时注入：开发模式下页面要连 Vite 的热更新服务器（WebSocket），这条策略会把它拦掉。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

const injectCsp = () => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml () {
    return [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }
    ]
  }
})

export default defineConfig({
  plugins: [react(), injectCsp()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' }
})
