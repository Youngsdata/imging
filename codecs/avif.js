/* 图映 · AVIF 浏览器端编解码(@jsquash/avif = libavif WASM,自托管) */
import encode, { init as initEncoder } from './avif/encode.js';
import decode from './avif/decode.js';

// “加载完成”必须包含真正的 libavif WASM 下载、编译与初始化，不能只代表胶水模块已注册。
window.TYCODECS.onPrepare('avif', async function(onProgress){
  if(onProgress) onProgress({name:'avif',phase:'wasm',text:'AVIF 模块下载完成，正在编译本地编码核心'});
  await initEncoder();
});

window.TYCODECS.onEnc('image/avif', async function(imageData, quality){
  var ui = (quality != null ? quality : 0.62);                 // UI 质量,0~1
  // 质量值与界面保持一致；页面已把 UI 100 封顶为 0.99，避免触发编码器的特殊满质量档。
  var q = Math.max(1, Math.min(99, Math.round(ui * 100)));
  var W = imageData.width, H = imageData.height, mp = W * H;
  // 大图分块 → 多线程(MT)版才能并行提速(需页面 cross-origin isolated,见 serve.mjs 的 COOP/COEP)。
  // 小图不分块(分块有轻微体积开销)。
  var tcol = W >= 2600 ? 2 : (W >= 1400 ? 1 : 0);
  var trow = H >= 2600 ? 2 : (H >= 1400 ? 1 : 0);
  // 速度自适应:libavif speed 越低越慢但越小。常见 12MP 手机图用 7 换取更高压缩率；仅超大图保留 8，避免等待和内存压力失控。
  var speed = mp > 16000000 ? 8 : (mp > 6000000 ? 7 : 6);
  var ab = await encode(imageData, { quality: q, speed: speed, subsample: 1, tileColsLog2: tcol, tileRowsLog2: trow });
  return new Uint8Array(ab);
});

window.TYCODECS.onDec('image/avif', async function(arrayBuffer){
  return await decode(arrayBuffer);   // 返回 ImageData
});
