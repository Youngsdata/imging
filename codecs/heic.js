// codecs/heic.js —— HEIC / HEIF 浏览器端【解码】胶水(libheif-js 1.19.x WASM)。
// 读:Chrome 内核原生读不了 HEIC,这里用自托管的 libheif WASM 在本地解成 ImageData。
// 写:不做——HEIC 走 HEVC,专利+体积在浏览器端不现实,交服务端(JDeli)。
//
// libheif-bundle.mjs 已把 wasm 内联成 base64,单文件自包含,不需 importmap、不额外 fetch .wasm。
// 页面通过 TYCODECS.load('heic') 动态 <script type="module"> 拉取本文件 → 注册解码器 →
// 上传 HEIC 时若原生解不了,点"加载解码器"即在本地读出。

import libheifFactory from './heic/libheif-bundle.mjs';

var _lib = null;
async function getLib(){
  if(!_lib){
    var m = libheifFactory();                       // emscripten 工厂,可能同步返回、也可能是 Promise
    if(m && typeof m.then === 'function') m = await m;
    _lib = m;
  }
  return _lib;
}

// 预先完成内联 WASM 的解码库初始化；之后界面显示“已就绪”时就真的可以开始解码。
window.TYCODECS.onPrepare('heic', async function(onProgress){
  if(onProgress) onProgress({name:'heic',phase:'wasm',text:'HEIC 模块下载完成，正在初始化本地解码核心'});
  await getLib();
});

// arrayBuffer(HEIC 字节) → ImageData(RGBA)。约定:解码器返回 ImageData,页面自己 putImageData 到 canvas。
async function decodeHeic(arrayBuffer){
  var lib = await getLib();
  var decoder = new lib.HeifDecoder();
  var imgs = decoder.decode(arrayBuffer);
  if(!imgs || !imgs.length) throw new Error('HEIC 无可解码图像');
  var img = imgs[0];                                 // 多图 HEIC(实况/连拍)取主图
  var w = img.get_width(), h = img.get_height();
  var id = new ImageData(w, h);
  await new Promise(function(res, rej){
    // display(imageData, cb):把 RGBA 填进 id.data,成功回传 id、失败回传 null/undefined
    img.display(id, function(d){ d ? res() : rej(new Error('HEIC 渲染失败')); });
  });
  return id;
}

window.TYCODECS.onDec('image/heic', decodeHeic);
window.TYCODECS.onDec('image/heif', decodeHeic);
