/* 图映 · WebP 浏览器端编解码（@jsquash/webp 1.5.0 / libwebp WASM，自托管） */
import encode, { init as initEncoder } from './webp/encode.js';
import decode from './webp/decode.js';
let webpEncoderReady;
function ensureWebPEncoder(){
  if(!webpEncoderReady) webpEncoderReady = initEncoder().catch(function(error){ webpEncoderReady = null; throw error; });
  return webpEncoderReady;
}

// iOS / 微信 WebView 能读取 WebP，但较旧的系统 WebKit 不一定开放 Canvas WebP 编码。
// 这里只在原生探测失败且用户实际选择 WebP 时按需初始化，不增加首页首屏下载。
window.TYCODECS.onPrepare('webp', async function(onProgress){
  if(onProgress) onProgress({name:'webp',phase:'wasm',text:'WebP 模块下载完成，正在编译本地 libwebp 核心'});
  await ensureWebPEncoder();
});

window.TYCODECS.onEnc('image/webp', async function(imageData, quality){
  await ensureWebPEncoder();
  var ui = quality != null ? quality : 0.8;
  var q = Math.max(1, Math.min(99, Math.round(ui * 100)));
  var pixels = imageData.width * imageData.height;
  var ab = await encode(imageData, {
    quality: q,
    method: pixels > 16000000 ? 3 : 4,
    alpha_quality: 100,
    alpha_compression: 1,
    alpha_filtering: 1,
    exact: 0,
    low_memory: pixels > 12000000 ? 1 : 0,
    use_sharp_yuv: pixels <= 12000000 ? 1 : 0
  });
  return new Uint8Array(ab);
});

window.TYCODECS.onDec('image/webp', async function(arrayBuffer){
  return await decode(arrayBuffer);
});
