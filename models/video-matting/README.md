# 图映视频抠像模型

本目录固定使用 Robust Video Matting v1.0.0 的两个 FP16 ONNX 权重。网页会在使用前同时校验精确字节数和 SHA-256，校验通过后才写入浏览器 Cache Storage。

- `rvm-mobilenetv3-fp16.onnx`：兼容模式，7,503,483 字节。
- `rvm-resnet50-fp16.onnx`：质量优先，53,752,558 字节。

ResNet50 保留官方 FP16 权重和计算图，仅把四组循环输入 / 输出分别改为唯一的 ONNX 符号尺寸。上游文件把不同缩放层共用为同一个 `height` / `width`，ONNX Runtime Web 在真实帧上会拒绝这种互相矛盾的张量尺寸；本清单的字节数与 SHA-256 对这项仅元数据修正后的浏览器版本进行固定校验。

模型按 GPL-3.0 发布，完整许可证见 `licenses/Robust-Video-Matting-GPL-3.0.txt`。上游项目：https://github.com/PeterL1n/RobustVideoMatting
