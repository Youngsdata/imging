# 图映视频抠像模型

本目录固定使用 Robust Video Matting v1.0.0 的两个 FP16 ONNX 权重。网页会在使用前同时校验精确字节数和 SHA-256，校验通过后才写入浏览器 Cache Storage。

- `rvm-mobilenetv3-fp16.onnx`：兼容模式，7,503,483 字节。
- `rvm-resnet50-fp16.onnx`：质量优先，53,752,558 字节。

ResNet50 保留官方 FP16 权重和计算图，仅把四组循环输入 / 输出分别改为唯一的 ONNX 符号尺寸。上游文件把不同缩放层共用为同一个 `height` / `width`，ONNX Runtime Web 在真实帧上会拒绝这种互相矛盾的张量尺寸；本清单的字节数与 SHA-256 对这项仅元数据修正后的浏览器版本进行固定校验。

当前网页固定使用 ONNX Runtime Web WASM 后端执行这两个 FP16 模型。实测中 WebGPU 后端可以完成会话初始化且不报错，但会在部分 Chrome / GPU 组合上静默返回空或近空蒙版。未经真实人物帧的像素级回归验证，不应重新开启 WebGPU。

模型按 GPL-3.0 发布，完整许可证见 `licenses/Robust-Video-Matting-GPL-3.0.txt`。上游项目：https://github.com/PeterL1n/RobustVideoMatting

## 内部 MatAnyone2 ONNX 质量验证

隐藏的 `?video=1` 工作台还提供 FP32 的 MatAnyone2 ONNX 实验档，并按输入比例自动选择横屏 1280×720、方形 960×960 或竖屏 720×1280 三个固定分析画布中有效像素最多的一套。常见 16:9、1:1 与 9:16 视频都能完整使用约 92 万分析像素；其他比例按比例缩放并在短边留黑，不拉伸、不裁切，输出蒙版只裁取有效画面区域再恢复到原始尺寸和比例。

每套比例模型都按顺序加载 `image_key`、`mask_memory`、`first_frame_refine` 与融合的 `step_update` 四个子图，单次按需下载约 307,843,860 字节；切换到尚未缓存的比例档时才会下载对应文件。浏览器逐文件校验 SHA-256，优先使用 WebGPU，失败时回退 WASM；切换比例档会释放上一套推理会话，避免三套大型模型同时占用 GPU 内存。首帧进行 10 次稳定精修，传播时保留首帧和最近帧组成的 5 帧工作记忆，每 5 帧更新一次，不再把上一帧蒙版错误叠加到当前预测。第一帧先由现有 ISNet-General 自动生成蒙版，未识别主体时用 RVM MobileNetV3 补救；镜头切换后重新播种。

十二个权重不进入 Git，开发机分别放在 `models/video-matting/matanyone2-1280x720/`、`models/video-matting/matanyone2-960x960/` 和 `models/video-matting/matanyone2-720x1280/`，站点部署时由同路径模型资源提供。模型仅用于内部验证，许可证见 `licenses/MatAnyone2-S-Lab-1.0.txt`；未经上游商业授权不得随公开发行包发布。
