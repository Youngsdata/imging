/* 图映 · AVIF 浏览器端编解码(@jsquash/avif = libavif WASM,自托管) */
import encode from './avif/encode.js';
import decode from './avif/decode.js';

window.TYCODECS.onEnc('image/avif', async function(imageData, quality){
  var ui = (quality != null ? quality : 0.62);                 // UI 质量,0~1
  // AVIF 质量刻度比 WebP/JPEG "更狠":同数值码率更高 → 纹理图会比 WebP 还大。
  // 实测:UI 82 直接喂 libavif 82 时 detail 图 181KB@42dB(WebP@82 只 145KB@37dB,画质过头);
  // 映射到 ~64 后 130KB@37dB —— 既比 WebP 小、画质又不输。故整体乘 0.78 下调。
  var q = Math.max(15, Math.min(95, Math.round(ui * 100 * 0.78)));
  var W = imageData.width, H = imageData.height, mp = W * H;
  // 大图分块 → 多线程(MT)版才能并行提速(需页面 cross-origin isolated,见 serve.mjs 的 COOP/COEP)。
  // 小图不分块(分块有轻微体积开销)。
  var tcol = W >= 2600 ? 2 : (W >= 1400 ? 1 : 0);
  var trow = H >= 2600 ? 2 : (H >= 1400 ? 1 : 0);
  // 速度自适应:libavif speed 越低越慢但越小。大图(手机 20MP)用高 speed 提速,小图保持 6 求最小。
  var speed = mp > 6000000 ? 8 : (mp > 2000000 ? 7 : 6);
  var ab = await encode(imageData, { quality: q, speed: speed, subsample: 1, tileColsLog2: tcol, tileRowsLog2: trow });
  return new Uint8Array(ab);
});

window.TYCODECS.onDec('image/avif', async function(arrayBuffer){
  return await decode(arrayBuffer);   // 返回 ImageData
});
