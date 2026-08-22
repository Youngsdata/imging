# AI 商品素材生成提示词集

生成工具：OpenAI 内置图像生成工具。每个品类使用一次独立生成任务，之后通过图映本地 ISNet 模型生成真实 Alpha 通道。

## 统一主提示词

> High-end commercial studio product photograph of a single [PRODUCT], generic unbranded packaging, front three-quarter view, centered, fully visible with generous margin, realistic premium materials and controlled softbox lighting, crisp clean silhouette, no logo, no brand name, no readable text, no watermark, no props, no hands, no people, isolated product intended for a genuinely transparent background, high resolution ecommerce cutout.

[PRODUCT] 依次替换为：

1. ivory serum pump bottle
2. amber glass dropper serum bottle
3. ivory champagne cream jar
4. sand beige sunscreen squeeze tube
5. milky white cleanser pump bottle
6. pale blue toner bottle
7. pearl white eye cream tube
8. aqua facial mist spray bottle
9. blush sheet mask pouch
10. blush body lotion pump bottle
11. amber shampoo pump bottle
12. blush glass perfume bottle
13. neutral foundation pump bottle
14. rose lipstick with cap beside it
15. rose lip gloss with applicator
16. black and gold mascara with wand
17. ivory cushion compact

## 透明通道处理

图像生成结果未直接作为透明素材交付。所有商品随后在本地运行图映自带的 ISNet General INT8 抠图模型，按主体蒙版生成 RGBA PNG，并逐项检查 PNG Alpha、边缘与彩色背景下的残留。
