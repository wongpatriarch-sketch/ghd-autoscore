/*
 * 从队徽原图生成软件需要的图标：  node scripts/make-icons.cjs <队徽原图.png> [--preview 预览图.png]
 *
 * 生成两个文件：
 *   build/icon.png       1024×1024。打包时 electron-builder 把它转成 exe、安装包、卸载程序用的图标
 *                        （桌面快捷方式、开始菜单、任务栏显示的就是它）
 *   src/assets/logo.png   256×256。欢迎页左上角和侧边栏里显示的小徽标
 *
 * 为什么要处理：原图是白底的圆形队徽。软件界面是深色的，Windows 任务栏也可能是深色的，
 * 直接拿原图当图标的话，圆形外面会带着一圈白色的直角。所以要把圆形以外的部分做成透明，
 * 并且把圆形边缘上"黑边和白底混在一起"的灰色像素还原成黑色，否则图标外面会出现一圈浅色毛边。
 *
 * 做法：
 *   1. 在原图上从四面八方朝圆心看过去，找出黑色外圈在每个角度上的准确半径（原图的圆并不是数学上完美的圆）；
 *   2. 以圆心为中心裁出一个正方形（四周留一点边），缩放到目标尺寸；
 *   3. 按第 1 步量出的半径给每个像素算透明度：圆外全透明，圆内不透明，正好压在边上的按覆盖比例半透明。
 *
 * 缩放用的是 Electron 自带的 nativeImage（Chromium 的图像引擎），不需要再装别的图像库。
 * 所以本文件被 node 运行时会用 Electron 重新启动自己，由 runInElectron 真正干活。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '..')

if (process.versions.electron && process.type === 'browser') {
  runInElectron()
} else {
  runInNode()
}

// ---------- 用 node 运行时：解析参数，调用 Electron 执行后半段 ----------
function runInNode () {
  const args = process.argv.slice(2)
  const source = args.find(a => !a.startsWith('--') && !isOptionValue(args, a))
  const previewIdx = args.indexOf('--preview')
  const preview = previewIdx >= 0 ? args[previewIdx + 1] : null
  if (!source || !fs.existsSync(source)) {
    console.error('用法：node scripts/make-icons.cjs <队徽原图.png> [--preview 预览图.png]')
    process.exit(2)
  }
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (!fs.existsSync(electron)) {
    console.error('找不到 Electron（请先执行 npm install）：', electron)
    process.exit(2)
  }

  // 这个小工具本身也是个 Electron 程序，会往"用户数据目录"写一点缓存。
  // 把目录指到临时文件夹，免得碰到软件真正在用的那个目录。
  const tag = `ghd-icons-${process.pid}`
  const userData = path.join(os.tmpdir(), `${tag}-userdata`)
  const resultFile = path.join(os.tmpdir(), `${tag}.json`)
  fs.mkdirSync(userData, { recursive: true })

  const r = spawnSync(electron,
    [`--user-data-dir=${userData}`, __filename, path.resolve(source), root, preview ? path.resolve(preview) : '', resultFile],
    { encoding: 'utf8' })

  try { fs.rmSync(userData, { recursive: true, force: true }) } catch (_) {}
  let result = null
  try { result = JSON.parse(fs.readFileSync(resultFile, 'utf-8')) } catch (_) {}
  try { fs.unlinkSync(resultFile) } catch (_) {}
  if (!result || !result.ok) {
    console.error('图标生成失败：', result ? result.error : `Electron 没有给出结果（退出码 ${r.status}）${r.stderr ? `\n${r.stderr}` : ''}`)
    process.exit(1)
  }
  delete result.ok
  for (const f of result.files) console.log(`  ${f.path}  ${f.width}×${f.height}  ${(f.bytes / 1024).toFixed(0)} KB`)
  console.log(`  圆心 (${result.circle.cx}, ${result.circle.cy})，半径 ${result.circle.rMin.toFixed(1)}~${result.circle.rMax.toFixed(1)} 像素（原图 ${result.source.width}×${result.source.height}）`)
  if (result.preview) console.log('  预览：', result.preview)
}

// "--preview" 后面跟的那个值是参数值，不是原图路径
function isOptionValue (args, a) {
  const i = args.indexOf(a)
  return i > 0 && args[i - 1] === '--preview'
}

// ---------- 用 Electron 运行时：真正生成图标 ----------
function runInElectron () {
  const { app, nativeImage } = require('electron')
  // node 传进来的参数：原图、工程根目录、预览图路径（没有就是空串）、结果文件。
  // 命令行开关（如 --user-data-dir）也会留在 argv 里，所以从"本文件的路径"往后取，不按固定位置数
  const args = process.argv.slice(process.argv.indexOf(__filename) + 1)
  const [source, root, preview, resultFile] = args
  const finish = result => {
    try { fs.writeFileSync(resultFile, JSON.stringify(result), 'utf-8') } catch (_) {}
    app.exit(result.ok ? 0 : 1)
  }
  app.whenReady().then(() => {
    try {
      finish({ ok: true, ...generate(source, root, preview, nativeImage) })
    } catch (e) {
      finish({ ok: false, error: e && e.stack ? e.stack : String(e) })
    }
  })
}

function generate (source, root, preview, nativeImage) {
  const original = nativeImage.createFromPath(source)
  const { width: W, height: H } = original.getSize()
  if (!W || !H) throw new Error(`读不出图片：${source}`)
  if (W !== H) throw new Error(`原图不是正方形（${W}×${H}），请先裁成正方形`)

  const circle = measureCircle(original, W)
  const pad = Math.round(circle.rMax * 0.06) // 圆外留 6% 的边，图标显得不挤
  const side = Math.ceil((circle.rMax + pad) * 2)
  const x0 = Math.round(circle.cx - side / 2)
  const y0 = Math.round(circle.cy - side / 2)

  const files = []
  for (const [rel, size] of [['build/icon.png', 1024], ['src/assets/logo.png', 256]]) {
    const image = render(original, circle, x0, y0, side, size, nativeImage)
    const png = image.toPNG()
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, png)
    files.push({ path: rel, width: size, height: size, bytes: png.length })
  }

  let previewPath = null
  if (preview) {
    const sheet = makePreview(path.join(root, 'build/icon.png'), nativeImage)
    fs.writeFileSync(preview, sheet.toPNG())
    previewPath = preview
  }
  return { source: { width: W, height: H }, circle: { cx: +circle.cx.toFixed(1), cy: +circle.cy.toFixed(1), rMin: circle.rMin, rMax: circle.rMax }, files, preview: previewPath }
}

// 第 1 步：量出圆心和每个角度上黑边外沿的半径
function measureCircle (image, W) {
  const bmp = image.toBitmap() // 每个像素 4 个字节，顺序是 B、G、R、A
  // 按小数坐标取亮度（双线性插值）。取样点落在图外时按图边上的像素算
  const lumAt = (x, y) => {
    const x0 = Math.min(Math.max(Math.floor(x), 0), W - 2)
    const y0 = Math.min(Math.max(Math.floor(y), 0), W - 2)
    const fx = Math.min(Math.max(x - x0, 0), 1)
    const fy = Math.min(Math.max(y - y0, 0), 1)
    const lum = (px, py) => {
      const i = (py * W + px) * 4
      return (bmp[i] * 114 + bmp[i + 1] * 587 + bmp[i + 2] * 299) / 1000
    }
    return (lum(x0, y0) * (1 - fx) + lum(x0 + 1, y0) * fx) * (1 - fy) + (lum(x0, y0 + 1) * (1 - fx) + lum(x0 + 1, y0 + 1) * fx) * fy
  }

  // 黑边很暗，先找出所有"暗像素"的范围，圆心就在这个范围的中心
  let minX = W; let minY = W; let maxX = -1; let maxY = -1
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      // 原图不透明，A 恒为 255，这里顺便排除掉可能存在的透明像素
      if (bmp[i + 3] > 0 && Math.max(bmp[i], bmp[i + 1], bmp[i + 2]) < 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('原图里找不到深色的外圈，请确认是白底的圆形队徽')
  const cx = (minX + maxX + 1) / 2
  const cy = (minY + maxY + 1) / 2
  const rFar = Math.max(maxX - minX + 1, maxY - minY + 1) / 2

  // 每 0.25 度量一次：从圆外朝圆心走，记下亮度降到 128 以下的位置（黑边的外沿），
  // 并在相邻两个取样点之间线性插值，得到亚像素级别的位置
  const N = 1440
  const edge = new Float64Array(N)
  const step = 0.5
  for (let k = 0; k < N; k++) {
    const cs = Math.cos((k / N) * 2 * Math.PI)
    const sn = Math.sin((k / N) * 2 * Math.PI)
    let prev = lumAt(cx + cs * (rFar + 3), cy + sn * (rFar + 3))
    let at = rFar - 1
    for (let d = rFar + 3 - step; d > rFar - 80; d -= step) {
      const l = lumAt(cx + cs * d, cy + sn * d)
      if (l < 128) { at = d + step * ((128 - l) / (prev - l || 1)); break }
      prev = l
    }
    edge[k] = at
  }
  // 圆周上相邻角度的半径做一点平均，抹掉图像噪点带来的小抖动
  const smooth = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let s = 0
    for (let j = -4; j <= 4; j++) s += edge[(k + j + N) % N]
    smooth[k] = s / 9
  }
  let rMin = Infinity; let rMax = 0
  for (const r of smooth) { if (r < rMin) rMin = r; if (r > rMax) rMax = r }
  return { cx, cy, edge: smooth, n: N, rMin, rMax }
}

// 按角度取黑边外沿的半径（相邻两个角度之间线性插值）
function radiusAt (circle, theta) {
  const u = (((theta / (2 * Math.PI)) * circle.n) % circle.n + circle.n) % circle.n
  const k = Math.floor(u)
  const f = u - k
  return circle.edge[k] * (1 - f) + circle.edge[(k + 1) % circle.n] * f
}

// 第 2、3 步：裁剪并缩放到目标尺寸，再按量出的半径把圆外做成透明
function render (original, circle, x0, y0, side, size, nativeImage) {
  const scaled = original.crop({ x: x0, y: y0, width: side, height: side }).resize({ width: size, height: size, quality: 'best' })
  const bmp = scaled.toBitmap() // BGRA；输入是不透明图，所以每个像素的 A 都是 255
  const k = size / side // 目标图上的 1 个像素 = 原图上的 1/k 个像素
  const half = 0.5 / k
  for (let j = 0; j < size; j++) {
    const sy = y0 + (j + 0.5) / k - circle.cy
    for (let i = 0; i < size; i++) {
      const sx = x0 + (i + 0.5) / k - circle.cx
      // 覆盖比例：像素中心离圆边还有多远。≥1 完全在圆内，≤0 完全在圆外
      const cover = radiusAt(circle, Math.atan2(sy, sx)) - Math.hypot(sx, sy) + half
      if (cover >= 1) continue
      const p = (j * size + i) * 4
      if (cover <= 0) { bmp[p] = 0; bmp[p + 1] = 0; bmp[p + 2] = 0; bmp[p + 3] = 0; continue }
      // 压在边上的像素：颜色 = 黑边 × cover + 白底 × (1 - cover)。
      // 把白底的那一份减掉，就还原出黑边本身（位图里颜色是按透明度预先乘过的，所以减掉白底后正好就是该存的值）
      const white = Math.round((1 - cover) * 255)
      bmp[p] = Math.max(0, bmp[p] - white)
      bmp[p + 1] = Math.max(0, bmp[p + 1] - white)
      bmp[p + 2] = Math.max(0, bmp[p + 2] - white)
      bmp[p + 3] = Math.round(cover * 255)
    }
  }
  return nativeImage.createFromBitmap(Buffer.from(bmp), { width: size, height: size })
}

// 效果预览：把图标缩成几种实际会显示的大小，分别放在深色和浅色底上，拼成一张图
function makePreview (iconFile, nativeImage) {
  const icon = nativeImage.createFromPath(iconFile)
  const sizes = [256, 64, 48, 32, 16]
  const gap = 24
  const left = 32
  const rowH = 288
  const width = left + sizes.reduce((s, v) => s + v + gap, 0) + 40
  const height = rowH * 2
  const bgs = [[32, 32, 36], [236, 236, 236]]
  const out = Buffer.alloc(width * height * 4)
  const put = (idx, r, g, b) => { out[idx] = b; out[idx + 1] = g; out[idx + 2] = r; out[idx + 3] = 255 }
  const blend = (idx, r, g, b, a) => {
    put(idx, (r * a + out[idx + 2] * (1 - a)), (g * a + out[idx + 1] * (1 - a)), (b * a + out[idx] * (1 - a)))
  }
  for (let row = 0; row < 2; row++) {
    for (let y = row * rowH; y < (row + 1) * rowH; y++) {
      for (let x = 0; x < width; x++) put((y * width + x) * 4, bgs[row][0], bgs[row][1], bgs[row][2])
    }
    let x = left
    for (const s of sizes) {
      const small = icon.resize({ width: s, height: s, quality: 'best' }).toBitmap()
      const y0 = row * rowH + (rowH - s >> 1)
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          const p = (j * s + i) * 4
          const a = small[p + 3] / 255
          if (a === 0) continue
          blend(((y0 + j) * width + x + i) * 4, small[p + 2] / a, small[p + 1] / a, small[p] / a, a)
        }
      }
      x += s + gap
    }
  }
  return nativeImage.createFromBitmap(out, { width, height })
}
