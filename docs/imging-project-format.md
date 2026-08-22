# 图映开放工程格式（`.imging`）v3

图映开放工程格式用于保存可继续编辑的多页设计。v3 支持多个独立页面、图片图层、多语言文字图层和矢量形状图层，并继续读取 v1 图片工程与 v2 文字工程。文件扩展名为 `.imging`，MIME 类型为 `application/vnd.imging.project+zip`，容器采用标准 ZIP。任何 ZIP 工具都可以解包查看其中的 JSON、原始图片和预览图。

## 设计原则

- 原始素材按导入时的字节保存，不重新编码、不降低画质。
- 工程结构使用 UTF-8 JSON 描述，不将图片编码成 Base64。
- 图层坐标、缩放、透明度和层级含义明确，第三方实现可以直接解析。
- 图层与整体画布的调色、美颜参数以非破坏式 `adjustments` 保存，原始素材不被烘焙或替换。
- 文字内容、字体标识、字号、颜色、对齐、行高与 2.5D 参数保持可编辑，不栅格化进原始素材。
- 每个页面独立保存画布尺寸、背景、整体滤镜、图层和编辑视图；页面不会被隐式拼接或缩放。
- 矩形、圆角矩形、椭圆、三角形、菱形、星形、直线和箭头保存为可读矢量参数，不栅格化进工程。
- ZIP 条目使用 CRC32；运行环境支持 Web Crypto 时，素材清单同时写入 SHA-256。
- 读取器必须先完整验证工程，再替换当前文档，避免半成品状态。

## 包结构

```text
example.imging
├── manifest.json
├── README.txt
├── preview.png
└── assets/
    ├── asset-0001.png
    └── asset-0002.jpg
```

`manifest.json` 必须存在。`preview.png` 和 `README.txt` 是便于人类查看的辅助文件；`assets/` 中的文件由清单引用。

图映 v3 写入不压缩（ZIP method 0）的条目，因为 PNG、JPEG、WebP、GIF 和 AVIF 本身已经压缩，这样保存更快且便于流式读取。读取器同时接受 method 0 和 Deflate（method 8）。ZIP64、分卷和加密 ZIP 不属于 v3。

## 清单语义

新工程清单遵循 [`imging-project-v3.schema.json`](imging-project-v3.schema.json)；旧版 [`imging-project-v1.schema.json`](imging-project-v1.schema.json) 与 [`imging-project-v2.schema.json`](imging-project-v2.schema.json) 仍永久保留。关键约定如下：

- `format` 固定为 `imging-project`。
- 新写入的 `formatVersion` 固定为整数 `3`；读取器接受 `1`、`2` 和 `3`。
- `pages` 按页面顺序保存 1–24 页；每页的 `canvas` 画布单位固定为像素。
- 坐标原点位于画布中心，X 轴向右，Y 轴向下。
- 图层数组从后向前绘制：数组第一项是最底层，最后一项是最顶层。
- `opacity` 范围为 `0` 到 `1`。
- `transform.scale` 中 `1` 表示原始像素尺寸，`0.5` 表示 50%。
- 图片与文字图层都支持等比缩放与任意角度旋转；`rotation` 使用角度制，正值为顺时针，规范写入范围为 `-180` 到 `180`。
- 文字图层的 `text.value` 保存 UTF-8 原文，`fontId` 保存图映稳定字体标识，`fontFamily` 为第三方读取器提供可读的字体族提示；字号单位为画布像素。
- `text.align` 为 `left`、`center` 或 `right`，`lineHeight` 为字号倍数；`effect` 为 `flat` 或 `soft3d`，后者通过 `depth` 保存立体深度。
- `shape.kind` 可为 `rect`、`round`、`ellipse`、`triangle`、`diamond`、`star`、`line` 或 `arrow`；形状同时保存独立宽高、填充色、描边色、线宽和圆角参数。
- 根 `editor.activePageId` 保存当前页面；每页 `editor` 保存选中图层、视图缩放和平移，它们不影响最终导出像素。
- 图片图层可带可选的 `adjustments`。它在图层缩放、旋转和定位前作用于原始图层像素；未提供时等同于全部参数为零。
- `page.canvas.adjustments` 是可选的整体调整，在该页背景与所有图层完成合成后应用。这样既能为单独的透明图层调色，也能统一处理整张画布。
- `adjustments` 包括启用状态、预设标识、0–100 的混合强度，以及曝光、对比度、高光、阴影、饱和度、自然饱和度、色温、色调、色相、肤色磨皮、肤色提亮、红润、清晰度、锐化、褪色、暗角和颗粒。第三方读取器可以忽略不认识的可选参数，但应保留它们。
- 图层滤镜和整体滤镜都必须保持输入 Alpha；磨皮只改变检测到的肤色 RGB，不扩张、不收缩透明轮廓。
- `exportSettings` 只是上次使用的导出偏好，不改变文档内容；有损格式可用 `qualityMode: "auto" | "manual"` 区分按最终画面重新推荐，还是保留创作者指定的画质。
- `exportSettings.quality` 使用界面 1–100 刻度；无损 PNG 写为 `null`。`pngMode` 为 `truecolor` 或 `indexed`，后者同时记录 4–256 的 `pngColors` 和 `pngDither`。

## 兼容与安全限制

图映当前最多读取 24 个页面、每页 24 个图层、工程合计 576 个素材、8192 × 8192 的单页画布、4800 万单页画布像素以及 512 MB 的工程包。同一素材被多页复用时只保存一份。文字内容最多 500 个 Unicode 字符、24 行。读取时会拒绝目录穿越路径、重复路径、加密条目、异常尺寸、未知字体标识和校验失败的素材。

第三方程序可以忽略自己不认识的可选字段，但不得改变已定义字段的含义。未来不兼容变更将提升 `formatVersion`。
