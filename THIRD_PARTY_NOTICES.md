# Third-Party Notices

本发行包包含以下第三方组件。各组件仍适用其各自许可证；图映自身的授权范围见 `DISTRIBUTION-NOTICE.md`。

## 阿里妈妈数黑体 (Alimama ShuHeiTi)

- 文件：`fonts/AlimamaShuHeiTi-Bold.woff2`（678,632 字节，WOFF2）
- 出品方：阿里妈妈智造字（Alibaba Group）
- 授权：免费商用普通许可，允许以 webfont 形式嵌入网页；禁止仿制、反编译、单独出售或暗示与阿里妈妈存在合作关系
- 用途：水印图层的可选字体之一，用户选中时才按需下载
- 说明：字形数据未作任何修改；图映不就该字体向用户收费
- 完整声明见 `licenses/Alimama-ShuHeiTi-LICENSE.txt`

## Noto Sans / Noto Sans CJK

- 文件：`fonts/NotoSans-Variable.ttf`（2,049,096 字节）、`fonts/NotoSansJP-Regular.otf`（4,533,028 字节）、`fonts/NotoSansKR-Regular.otf`（4,644,748 字节）
- 出品方：The Noto Project Authors / Google
- 授权：SIL Open Font License 1.1
- 用途：图片水印、在线做图文字图层和专业精修文字水印的拉丁、日文与韩文字体；用户选择后按需下载
- 说明：字体不会默认整包下载；选中的字体会在浏览器本地加载，并用于预览、工程恢复和最终导出
- 许可证副本：`licenses/Noto-SIL-OFL-1.1.txt`
- 上游与文件来源说明：`licenses/Noto-Fonts-NOTICE.txt`

## @jsquash/avif 2.1.1

- 用途：浏览器端 AVIF 编码与解码
- 许可证：Apache License 2.0
- 上游项目：<https://github.com/jamsinclair/jSquash>
- 许可证副本：`codecs/avif/LICENSE`

## @jsquash/webp 1.5.0

- 用途：iPhone 微信 / Safari 缺少 Canvas WebP 编码时的浏览器端 WebP 编码与解码兜底
- 许可证：Apache License 2.0；内含 libwebp 的 BSD 风格许可证
- 上游项目：<https://github.com/jamsinclair/jSquash>
- 许可证副本：`codecs/webp/LICENSE`
- libwebp 许可证副本：`codecs/webp/CODEC-LICENSE.txt`

## wasm-feature-detect 1.8.0

- 用途：浏览器 WASM 能力检测
- 许可证：Apache License 2.0
- 上游项目：<https://github.com/GoogleChromeLabs/wasm-feature-detect>
- 许可证副本：`licenses/wasm-feature-detect-Apache-2.0.txt`
- 发行文件 SHA-256：`879dd39c8d9ebd5a3c64d1f18955b047907c677ca3b71865e2497264107e3aef`

## libheif-js 1.19.8

- 用途：浏览器端 HEIC / HEIF 解码
- 许可证：GNU Lesser General Public License v3.0
- 上游项目：<https://github.com/catdad-experiments/libheif-js/tree/1.19.8>
- LGPL 许可证副本：`licenses/libheif-js-LGPL-3.0.txt`
- WASM 第三方声明：`licenses/libheif-wasm-NOTICES.txt`
- 发行文件：`codecs/heic/libheif-bundle.mjs`
- 发行文件 SHA-256：`8363e27add6c587b20f183fb746a583f97f28e8641f12955a1a550c38a4f9969`

本发行包中的 `libheif-bundle.mjs` 是上述版本的未修改发行文件，可由使用者用同版本上游文件替换。

## ISNet General ONNX INT8

- 用途：浏览器本地通用主体识别与背景蒙版生成
- 许可证：MIT License
- 上游模型：<https://huggingface.co/xrds/isnet-general-onnx-int8>
- 许可证副本：`licenses/ISNet-General-ONNX-INT8-LICENSE.txt`
- 模型文件：`models/background-removal/isnet-general-int8.onnx`
- 模型 SHA-256：`3b21a6706dc8d6e4ba9f5b31ebc6940f6c785b58862e27bb25daa9dd4424b87f`

## ONNX Runtime Web 1.27.0

- 用途：在浏览器 WebGPU / WASM 中运行本地抠图模型
- 许可证：MIT License
- 上游项目：<https://github.com/microsoft/onnxruntime>
- 许可证副本：`licenses/ONNX-Runtime-LICENSE.txt`
- WASM 文件 SHA-256：`7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a`

## ISNet General ONNX FP16

- 用途：浏览器本地高清主体识别与半透明背景蒙版生成
- 许可证：Apache License 2.0
- 上游模型：<https://huggingface.co/Ko033/isnet-general-use-onnx>
- 上游版本：`5349b617911fd60c619b52f32e2b593517b78df3`
- 原始项目：<https://github.com/xuebinqin/DIS>
- Apache-2.0 许可证全文：`licenses/wasm-feature-detect-Apache-2.0.txt`
- 模型文件：`models/background-removal/isnet-general-fp16.onnx`
- 模型 SHA-256：`0857167263ad816d67c26852b99c2861e46a86c9a889527061a5eb2a6f90d32c`

## BEN2 FP16 ONNX

- 用途：浏览器本地高精度主体蒙版生成，用于发丝、半透明材质与复杂边缘
- 许可证：MIT License
- 上游项目：<https://github.com/PramaLLC/BEN2>
- 浏览器 ONNX 模型：<https://huggingface.co/onnx-community/BEN2-ONNX>
- 许可证副本：`licenses/BEN2-LICENSE.txt`
- 模型文件：`models/background-removal/ben2-fp16.onnx`
- 模型 SHA-256：`dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1`

## BiRefNet HR-Matting FP16 ONNX

- 用途：浏览器本地 2048×2048 高分辨率蒙版生成，用于发丝、薄纱、玻璃与半透明边缘
- 许可证：MIT License
- 上游项目：<https://github.com/ZhengPeng7/BiRefNet>
- 官方模型：<https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting>
- 官方模型版本：`5d6b6f8adcb5b417c871b1d84ceaae9871355b7f`
- 官方 FP16 权重 SHA-256：`a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55`
- 许可证副本：`licenses/BiRefNet-LICENSE.txt`
- 模型文件：`models/background-removal/birefnet-hr-matting-fp16.onnx`
- 浏览器 ONNX SHA-256：`0d3bdc77d5e83133e169ac9b6e2850a10a8e8fbbf9c76d2cf86caca77611b2fe`
- 转换说明：保留官方 FP16 权重和 2048×2048 输入；仅将推理态 BatchNorm 等价折叠为仿射运算，并将 DeformConv 等价展开为标准 ONNX `GridSample` + `MatMul`，便于 ONNX Runtime Web 执行

## Robust Video Matting v1.0.0

- 用途：浏览器本地视频时序抠像，利用循环状态保持前后帧边缘稳定
- 许可证：GNU General Public License v3.0
- 上游项目：<https://github.com/PeterL1n/RobustVideoMatting>
- 许可证副本：`licenses/Robust-Video-Matting-GPL-3.0.txt`
- 模型文件：`models/video-matting/rvm-mobilenetv3-fp16.onnx`、`models/video-matting/rvm-resnet50-fp16.onnx`
- MobileNetV3 SHA-256：`6a0d5ce6cc17702613be548559879b4521ed424cfe14ddc48d1acaa44d616f64`
- ResNet50 浏览器版 SHA-256：`6ab2e8530a3f5decb3d7b2b40e09e213b0f0cd0e138570284b83654500848b5e`
- ResNet50 浏览器兼容说明：保留官方 FP16 权重和计算图，仅给四组不同缩放的循环输入 / 输出分配唯一 ONNX 符号尺寸，避免 ONNX Runtime Web 把不同尺寸误判为必须相同

## Mediabunny 1.55.1

- 用途：浏览器本地视频拆帧、WebCodecs 编码、音频保留和 MP4 / WebM 重封装
- 许可证：Mozilla Public License 2.0
- 上游项目：<https://github.com/Vanilagy/mediabunny>
- 许可证副本：`licenses/Mediabunny-MPL-2.0.txt`
- 发行文件：`video/mediabunny-1.55.1.min.js`
- 发行文件 SHA-256：`3c3bda64c0bf9a14b0dad219097818d5b2d8166749741315248e67b03d9399f4`

## Nginx

容器镜像基于 Nginx 官方镜像。其软件及基础镜像中的第三方组件按照镜像内附带的各自许可证提供：

- <https://hub.docker.com/_/nginx>
- <https://nginx.org/LICENSE>
