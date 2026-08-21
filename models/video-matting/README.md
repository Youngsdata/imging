# 图映浏览器端视频抠像模型

本仓库为「图映」视频抠像 Beta 提供浏览器端 ONNX 时序抠像权重。模型下载后完全在用户浏览器本地推理，原视频不会因模型推理而上传。

> **授权提示：** Robust Video Matting 权重按 GPL-3.0 发布；MatAnyone2 权重按 S-Lab License 1.0 发布，**仅允许非商业使用与再分发**。商业用途必须另行取得 MatAnyone2 上游作者授权。不同目录适用各自许可证，不得把仓库页面显示的单一许可证标签理解为覆盖全部文件。

网页会在使用前同时校验每个文件的精确字节数和 SHA-256，校验通过后才写入浏览器 Cache Storage。下载顺序固定为 ModelScope CDN 优先、图映本站同路径备用；CDN 不可用时自动切换，不要求用户重试。

## Robust Video Matting 兼容模型

固定使用 Robust Video Matting v1.0.0 的两个 FP16 ONNX 权重：

- `rvm-mobilenetv3-fp16.onnx`：兼容模式，7,503,483 字节。
- `rvm-resnet50-fp16.onnx`：质量优先，53,752,558 字节。

ResNet50 保留官方 FP16 权重和计算图，仅把四组循环输入 / 输出分别改为唯一的 ONNX 符号尺寸。上游文件把不同缩放层共用为同一个 `height` / `width`，ONNX Runtime Web 在真实帧上会拒绝这种互相矛盾的张量尺寸；本清单的字节数与 SHA-256 对这项仅元数据修正后的浏览器版本进行固定校验。

当前网页固定使用 ONNX Runtime Web WASM 后端执行这两个 FP16 模型。实测中 WebGPU 后端可以完成会话初始化且不报错，但会在部分 Chrome / GPU 组合上静默返回空或近空蒙版。未经真实人物帧的像素级回归验证，不应重新开启 WebGPU。

模型按 GPL-3.0 发布，完整许可证见仓库根目录 `LICENSE-RVM-GPL-3.0.txt`。上游项目：https://github.com/PeterL1n/RobustVideoMatting

## MatAnyone2 高质量模型

隐藏的 `?video=1` 工作台提供 FP32 的 MatAnyone2 高质量档，并按输入比例自动选择横屏 1280×720、方形 960×960 或竖屏 720×1280 三个固定分析画布中有效像素最多的一套。常见 16:9、1:1 与 9:16 视频都能完整使用约 92 万分析像素；其他比例按比例缩放并在短边留黑，不拉伸、不裁切，输出蒙版只裁取有效画面区域再恢复到原始尺寸和比例。

每套比例模型都按顺序加载 `image_key`、`mask_memory`、`first_frame_refine` 与融合的 `step_update` 四个子图，单次按需下载约 307,843,860 字节；切换到尚未缓存的比例档时才会下载对应文件。浏览器逐文件校验 SHA-256，优先使用 WebGPU，失败时回退 WASM；切换比例档会释放上一套推理会话，避免三套大型模型同时占用 GPU 内存。首帧进行 10 次稳定精修，传播时保留首帧和最近帧组成的 5 帧工作记忆，每 5 帧更新一次，不再把上一帧蒙版错误叠加到当前预测。第一帧先由现有 ISNet-General 自动生成蒙版，未识别主体时用 RVM MobileNetV3 补救；镜头切换后重新播种。

十二个权重按分析画布分别放在：

- `matanyone2-1280x720/`：横屏模型，307,843,860 字节。
- `matanyone2-960x960/`：方形模型，307,843,858 字节。
- `matanyone2-720x1280/`：竖屏模型，307,843,860 字节。

每套目录均包含 `matanyone2_image_key.onnx`、`matanyone2_mask_memory.onnx`、`matanyone2_first_frame_refine.onnx` 与 `matanyone2_step_update.onnx`。准确的文件大小与 SHA-256 以各目录的 `model-manifest.json` 为准。

MatAnyone2 完整许可证见仓库根目录 `LICENSE-MATANYONE2-S-LAB-1.0.txt`。上游项目：https://github.com/pq-yang/MatAnyone2

## CDN 地址

当前不可变发布版本为 `v1.1.0-web`：

```text
https://modelscope.cn/models/dragonsoar/imging-video-matting/resolve/v1.1.0-web/
```

本站备用地址保持完全相同的目录结构：

```text
/models/video-matting/
```
