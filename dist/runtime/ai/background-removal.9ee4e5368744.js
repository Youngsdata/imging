/* 图映 · 浏览器本地 AI 抠图加载器
 * 模型优先从固定版本 CDN 下载并由当前站点兜底；原图与蒙版只在浏览器内存中处理。
 */
(function(){
  'use strict';
  var ownScript=document.currentScript;
  var BASE=new URL('./',ownScript&&ownScript.src||location.href).href;
  var RUNTIME_BASE=window.TY_AI_RUNTIME_BASE||BASE;
  var LANGUAGE=((document.documentElement&&document.documentElement.lang)||'zh-CN').toLowerCase();
  function copy(zh,en){ return typeof window.TYTr==='function'?window.TYTr(zh,en):(LANGUAGE.indexOf('zh')===0?zh:en); }
  var CACHE_NAME='tuying-ai-model-v1'; // 保留 v1，避免已下载的快速模型在升级后重下。
  var MODEL_RELEASE='v1.0.0';
  var MODEL_CDN_BASE='https://modelscope.cn/models/dragonsoar/imging-background-removal/resolve/'+MODEL_RELEASE+'/';
  var MODELS={
    quick:{
      id:'quick',label:copy('快速 AI','Fast AI'),technicalName:'ISNet INT8',
      description:copy('通用主体识别，下载小、速度快','Fast general subject recognition; recommended for CPU and entry-level devices'),sizeText:copy('约 42 MB','About 42 MB'),
      file:'isnet-general-int8.onnx',sha256:'3b21a6706dc8d6e4ba9f5b31ebc6940f6c785b58862e27bb25daa9dd4424b87f',
      bytes:44229662,inputSize:1024,normalize:'isnet'
    },
    hd:{
      id:'hd',label:copy('高清 AI','HD AI'),technicalName:'ISNet FP16',
      description:copy('边缘与半透明层次更细腻，支持 WebGPU 的设备推荐','More detailed edges and translucent layers; recommended for WebGPU devices'),sizeText:copy('约 88 MB','About 88 MB'),
      file:'isnet-general-fp16.onnx',sha256:'0857167263ad816d67c26852b99c2861e46a86c9a889527061a5eb2a6f90d32c',
      bytes:88141111,inputSize:1024,normalize:'isnet'
    },
    professional:{
      id:'professional',label:copy('专业 AI','Pro AI'),technicalName:'BEN2 FP16',
      description:copy('发丝、半透明材质与复杂边缘','Hair, translucent materials and complex edges'),sizeText:copy('约 219 MB','About 219 MB'),
      file:'ben2-fp16.onnx',sha256:'dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1',
      bytes:219121675,inputSize:1024,normalize:'imagenet'
    },
    ultimate:{
      id:'ultimate',label:copy('骨灰级 AI','Ultimate AI'),technicalName:'BiRefNet HR-Matting FP16',
      description:copy('2048 高分辨率；发丝、薄纱、玻璃与半透明边缘；最稳、最接近原始效果','2048 resolution for hair, veils, glass and translucent edges; closest to original detail'),sizeText:copy('约 447 MB','About 447 MB'),
      file:'birefnet-hr-matting-fp16.onnx',sha256:'0d3bdc77d5e83133e169ac9b6e2850a10a8e8fbbf9c76d2cf86caca77611b2fe',
      bytes:447261189,inputSize:2048,normalize:'imagenet'
    }
  };
  Object.keys(MODELS).forEach(function(id){
    var model=MODELS[id];
    model.url=MODEL_CDN_BASE+model.file;
    model.localUrl=new URL('../models/background-removal/'+model.file,BASE).href+'?sha='+model.sha256.slice(0,12);
    model.sources=[
      {id:'modelscope',label:copy('ModelScope CDN','ModelScope CDN'),url:model.url,credentials:'omit'},
      {id:'local',label:copy('本站备用地址','site fallback'),url:model.localUrl,credentials:'same-origin'}
    ];
  });
  var runtimePromise=null,runtimeScript=null,sessionPromises={},sessionBuildTails={},backends={},inferenceTail=Promise.resolve(),inferencePending=0;

  function emit(fn,data){ if(typeof fn==='function') fn(data); }
  function abortError(){ var e=new Error(copy('任务已停止','The task was stopped'));e.name='AbortError';return e; }
  function throwIfAborted(signal){ if(signal&&signal.aborted)throw abortError(); }
  function guarded(promise,ms,message,signal,onTimeout){
    return new Promise(function(resolve,reject){
      var done=false,t=ms>0?setTimeout(function(){if(done)return;done=true;cleanup();try{if(onTimeout)onTimeout();}catch(_e){}reject(new Error(message));},ms):null;
      function cleanup(){if(t)clearTimeout(t);if(signal)signal.removeEventListener('abort',onAbort);}
      function onAbort(){if(done)return;done=true;cleanup();reject(abortError());}
      if(signal){if(signal.aborted){onAbort();return;}signal.addEventListener('abort',onAbort,{once:true});}
      Promise.resolve(promise).then(function(v){if(done)return;done=true;cleanup();resolve(v);},function(e){if(done)return;done=true;cleanup();reject(e);});
    });
  }
  function yieldToUI(){ return new Promise(function(resolve){var done=false,t=setTimeout(finish,120);function finish(){if(done)return;done=true;clearTimeout(t);resolve();}if(typeof requestAnimationFrame==='function')requestAnimationFrame(function(){requestAnimationFrame(finish);});else finish();}); }
  function initTimeout(model){ return model.id==='ultimate'?600000:(model.id==='professional'?360000:240000); }
  function inferenceTimeout(model){ return model.id==='ultimate'?360000:(model.id==='professional'?240000:180000); }
  function buildOrtSession(ort,bytes,options,model,signal,message){
    var expired=false,prior=sessionBuildTails[model.id]||Promise.resolve();
    var raw=prior.catch(function(){}).then(async function(){throwIfAborted(signal);var session=await ort.InferenceSession.create(bytes,options);if(expired||(signal&&signal.aborted)){try{if(session&&session.release)await session.release();}catch(_e){}throw abortError();}return session;});
    sessionBuildTails[model.id]=raw.then(function(){},function(){});
    return guarded(raw,initTimeout(model),message,signal,function(){expired=true;});
  }
  function getModel(id){ return MODELS[id]||MODELS.quick; }
  function publicModel(model){ return {id:model.id,label:model.label,technicalName:model.technicalName,description:model.description,sizeText:model.sizeText,bytes:model.bytes,sha256:model.sha256,release:MODEL_RELEASE,url:model.url,fallbackUrl:model.localUrl}; }
  function listModels(){ return Object.keys(MODELS).map(function(id){return publicModel(MODELS[id]);}); }
  function deviceProfile(){
    var nav=typeof navigator==='object'&&navigator?navigator:{},ua=String(nav.userAgent||''),platform=String(nav.platform||''),touch=+nav.maxTouchPoints||0;
    var ios=/iPhone|iPad|iPod/i.test(ua)||(platform==='MacIntel'&&touch>1),android=/Android/i.test(ua),mobile=ios||android||/Mobile|Windows Phone/i.test(ua);
    var wechat=/MicroMessenger/i.test(ua),memory=Math.max(0,+nav.deviceMemory||0);
    // 微信 iOS 使用 WKWebView；它通常会在 JS 收到可捕获异常前直接终止高内存页面。
    // 这里给最终透明画布留出模型、原图解码、运行时和浏览器自身所需的内存空间。
    var maxOutputPixels=ios&&wechat?8000000:(wechat?10000000:(mobile?(memory>=8?16000000:12000000):0));
    return {ios:ios,android:android,mobile:mobile,wechat:wechat,memory:memory,webgpu:!!nav.gpu,maxOutputPixels:maxOutputPixels};
  }
  function modelSupport(modelId){
    var model=getModel(modelId),profile=deviceProfile(),supported=true,reason='';
    if(typeof WebAssembly!=='object'){
      supported=false;reason=copy('当前浏览器不支持本地 AI 所需的 WebAssembly，请使用最新版 Chrome、Edge 或 Safari','This browser does not support the WebAssembly required by local AI. Use the latest Chrome, Edge or Safari.');
    }else if(profile.mobile&&model.id!=='quick'){
      supported=false;reason=profile.wechat
        ?copy('微信手机端为避免内存不足导致页面退出，仅开放快速 AI；专业 AI 与骨灰级 AI 请使用电脑端 Chrome 或 Edge','To prevent the page closing when memory runs low, WeChat mobile only enables Fast AI. Use desktop Chrome or Edge for Pro AI and Ultimate AI.')
        :copy('手机端为保证稳定性仅开放快速 AI；专业 AI 与骨灰级 AI 请使用电脑端 Chrome、Edge 或 Safari','For reliable processing, mobile devices only enable Fast AI. Use desktop Chrome, Edge or Safari for Pro AI and Ultimate AI.');
    }
    return {supported:supported,reason:reason,model:model.id,profile:profile,recommended:profile.mobile?'quick':model.id};
  }
  function cacheKey(model){ return model.localUrl; }
  function verifiedKey(model){ return CACHE_NAME+':verified:'+model.id; }
  function isVerified(model){ try{return localStorage.getItem(verifiedKey(model))===model.sha256;}catch(_e){return false;} }
  function markVerified(model,ok){ try{if(ok)localStorage.setItem(verifiedKey(model),model.sha256);else localStorage.removeItem(verifiedKey(model));}catch(_e){} }
  function hex(bytes){return Array.prototype.map.call(new Uint8Array(bytes),function(v){return v.toString(16).padStart(2,'0');}).join('');}
  async function verifyModel(buffer,model,onProgress,signal,sourceLabel){
    throwIfAborted(signal);
    emit(onProgress,{model:model.id,phase:'verify',loaded:buffer.byteLength,total:model.bytes,sourceLabel:sourceLabel,text:copy(model.label+' 下载完成，正在校验精确大小与 SHA-256','The '+model.label+' download is complete; verifying its exact size and SHA-256')});
    if(buffer.byteLength!==model.bytes) throw new Error(copy(model.label+'模型大小不正确（应为 '+model.bytes+' 字节，实际 '+buffer.byteLength+' 字节）',model.label+' has the wrong size (expected '+model.bytes+' bytes, received '+buffer.byteLength+')'));
    if(!(window.crypto&&window.crypto.subtle)) throw new Error(copy('当前浏览器不支持模型 SHA-256 完整性校验','This browser does not support SHA-256 model integrity checks'));
    var digest=await guarded(window.crypto.subtle.digest('SHA-256',buffer),Math.max(120000,Math.ceil(model.bytes/1048576)*800),copy(model.label+'完整性校验超时，请重试',model.label+' integrity verification timed out; retry'),signal);
    if(hex(digest)!==model.sha256) throw new Error(copy(model.label+'模型 SHA-256 校验失败，已拒绝使用该文件',model.label+' failed SHA-256 verification and was rejected'));
    emit(onProgress,{model:model.id,phase:'verified',loaded:model.bytes,total:model.bytes,sourceLabel:sourceLabel,text:copy(model.label+' 模型完整性校验成功','The '+model.label+' model passed integrity verification')});
  }

  function loadRuntime(onProgress,signal){
    throwIfAborted(signal);
    if(window.ort){emit(onProgress,{phase:'runtime-ready',text:copy('本地 AI 运行时已就绪','The local AI runtime is ready')});return Promise.resolve(window.ort);}
    emit(onProgress,{phase:'runtime',text:copy('正在加载本地 AI 运行时','Loading the local AI runtime')});
    if(!runtimePromise){
      runtimeScript=document.createElement('script');runtimeScript.src=new URL('ort.webgpu.min.js',RUNTIME_BASE).href;runtimeScript.async=true;
      var raw=new Promise(function(resolve,reject){
        runtimeScript.onload=function(){if(!window.ort)reject(new Error(copy('AI 运行时未正确加载','The AI runtime did not load correctly')));else resolve(window.ort);};
        runtimeScript.onerror=function(){reject(new Error(copy('无法加载本地 AI 运行时','Could not load the local AI runtime')));};document.head.appendChild(runtimeScript);
      });
      runtimePromise=guarded(raw,30000,copy('AI 运行时加载超时，请检查网络后重试','AI runtime loading timed out; check the network and retry'),null,function(){if(runtimeScript&&runtimeScript.parentNode)runtimeScript.parentNode.removeChild(runtimeScript);})
        .catch(function(e){runtimePromise=null;if(runtimeScript&&runtimeScript.parentNode)runtimeScript.parentNode.removeChild(runtimeScript);runtimeScript=null;throw e;});
    }
    return guarded(runtimePromise,0,'',signal).then(function(ort){emit(onProgress,{phase:'runtime-ready',text:copy('本地 AI 运行时加载完成','The local AI runtime has loaded')});return ort;});
  }

  async function responseBuffer(res,total,onProgress,model,signal,onStall,source){
    if(!(res.body&&res.body.getReader)) return guarded(res.arrayBuffer(),Math.max(120000,Math.ceil(model.bytes/1048576)*2500),copy(model.label+'模型下载超时，请重试',model.label+' model download timed out; retry'),signal,onStall);
    var reader=res.body.getReader(),loaded=0,known=total>0,newBuffer=known?new Uint8Array(total):null,parts=known?null:[];
    try{while(true){
      throwIfAborted(signal);
      var item=await guarded(reader.read(),30000,copy(model.label+'模型下载长时间没有数据，请检查网络后重试',model.label+' model download stalled; check the network and retry'),signal,onStall); if(item.done) break;
      if(known){
        if(loaded+item.value.byteLength>newBuffer.byteLength){
          var grown=new Uint8Array(Math.max(loaded+item.value.byteLength,newBuffer.byteLength*2)); grown.set(newBuffer); newBuffer=grown;
        }
        newBuffer.set(item.value,loaded);
      } else parts.push(item.value);
      loaded+=item.value.byteLength;
      emit(onProgress,{model:model.id,phase:'download',loaded:loaded,total:total||model.bytes,source:source.id,sourceLabel:source.label,text:copy('正在从 '+source.label+' 下载 '+model.label+'模型','Downloading the '+model.label+' model from '+source.label)});
    }}catch(e){try{await reader.cancel();}catch(_e){}throw e;}
    if(known&&loaded===newBuffer.byteLength) return newBuffer.buffer;
    var merged=new Uint8Array(loaded),off=0;
    if(known) merged.set(newBuffer.subarray(0,loaded));
    else parts.forEach(function(p){merged.set(p,off);off+=p.byteLength;});
    return merged.buffer;
  }

  async function readModel(model,onProgress,signal){
    throwIfAborted(signal);
    emit(onProgress,{model:model.id,phase:'cache-check',loaded:0,total:model.bytes,text:copy('正在检查 '+model.label+'本地缓存','Checking the local '+model.label+' cache')});
    var cache=null;
    if('caches' in window)try{cache=await guarded(caches.open(CACHE_NAME),10000,copy('浏览器模型缓存响应超时','The browser model cache did not respond'),signal);}catch(e){if(e&&e.name==='AbortError')throw e;cache=null;}
    if(cache){
      var hit=null;try{hit=await guarded(cache.match(cacheKey(model)),10000,copy('读取模型缓存超时','Reading the model cache timed out'),signal);}catch(e){if(e&&e.name==='AbortError')throw e;}
      if(hit){
        emit(onProgress,{model:model.id,phase:'cache',loaded:model.bytes,total:model.bytes,text:copy('已从浏览器缓存读取 '+model.label+'模型','Loaded '+model.label+' from the browser cache')});
        try{
          var cachedBuffer=await guarded(hit.arrayBuffer(),Math.max(120000,Math.ceil(model.bytes/1048576)*1500),copy('读取缓存模型超时，将重新下载','Reading the cached model timed out; it will be downloaded again'),signal);
          if(cachedBuffer.byteLength===model.bytes&&isVerified(model)) return cachedBuffer;
          await verifyModel(cachedBuffer,model,onProgress,signal,copy('浏览器缓存','browser cache'));
          markVerified(model,true);return cachedBuffer;
        }catch(e){if(e&&e.name==='AbortError')throw e;}
        markVerified(model,false);try{await cache.delete(cacheKey(model));}catch(_e){}
      }
    }
    var errors=[];
    for(var sourceIndex=0;sourceIndex<model.sources.length;sourceIndex++){
      var source=model.sources[sourceIndex],controller=new AbortController(),relay=function(){controller.abort();};if(signal)signal.addEventListener('abort',relay,{once:true});
      var cacheResponse=null;
      try{
        emit(onProgress,{model:model.id,phase:'download',loaded:0,total:model.bytes,source:source.id,sourceLabel:source.label,text:copy('正在连接 '+source.label+' 下载 '+model.label+'模型','Connecting to '+source.label+' for the '+model.label+' model')});
        var res=await guarded(fetch(source.url,{credentials:source.credentials,mode:'cors',signal:controller.signal}),30000,copy(source.label+'连接超时','Connection to '+source.label+' timed out'),signal,function(){controller.abort();});
        if(!res.ok)throw new Error(copy(source.label+'返回 HTTP '+res.status,source.label+' returned HTTP '+res.status));
        var total=+(res.headers.get('content-length')||model.bytes);cacheResponse=cache?res.clone():null;
        var buffer=await responseBuffer(res,total,onProgress,model,signal,function(){controller.abort();},source);
        await verifyModel(buffer,model,onProgress,signal,source.label);
        if(cache&&cacheResponse){
          emit(onProgress,{model:model.id,phase:'cache-save',loaded:model.bytes,total:model.bytes,source:source.id,sourceLabel:source.label,text:copy('校验成功，正在保存浏览器缓存','Verification succeeded; saving the browser cache')});
          try{await guarded(cache.put(cacheKey(model),cacheResponse),Math.max(30000,Math.ceil(model.bytes/1048576)*700),copy('保存模型缓存超时','Saving the model cache timed out'),signal);markVerified(model,true);}catch(e){if(e&&e.name==='AbortError')throw e;markVerified(model,false);}
        }
        return buffer;
      }catch(e){
        if(e&&e.name==='AbortError')throw e;
        errors.push(source.label+': '+(e&&e.message||e));markVerified(model,false);
        if(cache)try{await cache.delete(cacheKey(model));}catch(_e){}
        if(cacheResponse&&cacheResponse.body)try{await cacheResponse.body.cancel();}catch(_e){}
        if(sourceIndex+1<model.sources.length)emit(onProgress,{model:model.id,phase:'source-fallback',loaded:0,total:model.bytes,source:source.id,text:copy(source.label+' 不可用，正在自动切换本站备用地址',source.label+' is unavailable; switching automatically to the site fallback')});
      }finally{if(signal)signal.removeEventListener('abort',relay);}
    }
    throw new Error(copy(model.label+'模型下载或校验失败：',model.label+' model download or verification failed: ')+errors.join('；'));
  }

  async function createSession(modelId,onProgress,options){
    var model=getModel(modelId);
    var signal=options&&options.signal;throwIfAborted(signal);
    var support=modelSupport(model.id);
    if(!support.supported){var unsupported=new Error(support.reason);unsupported.code='MODEL_UNSUPPORTED';throw unsupported;}
    if(sessionPromises[model.id]) return guarded(sessionPromises[model.id],0,'',signal);
    sessionPromises[model.id]=(async function(){
      var ort=await loadRuntime(onProgress,signal);
      ort.env.logLevel='error'; ort.env.wasm.wasmPaths=RUNTIME_BASE; ort.env.wasm.numThreads=!support.profile.mobile&&self.crossOriginIsolated&&navigator.hardwareConcurrency?Math.min(4,navigator.hardwareConcurrency):1;
      var bytes=await readModel(model,onProgress,signal),sessionOptions={graphOptimizationLevel:'all',executionMode:'sequential',logSeverityLevel:3};
      emit(onProgress,{model:model.id,phase:'init',loaded:model.bytes,total:model.bytes,text:copy('正在初始化 '+model.label,'Initialising '+model.label)});
      if(navigator.gpu){
        try{ sessionOptions.executionProviders=['webgpu']; var gpu=await buildOrtSession(ort,bytes,sessionOptions,model,signal,copy(model.label+' WebGPU 初始化超时',model.label+' WebGPU initialisation timed out')); backends[model.id]='WebGPU'; return gpu; }
        catch(e){ if(e&&e.name==='AbortError')throw e;emit(onProgress,{model:model.id,phase:'fallback',loaded:model.bytes,total:model.bytes,text:copy(model.label+' WebGPU 不兼容，切换 WASM',model.label+' is not compatible with WebGPU; switching to WASM')}); }
      }
      if(model.id==='hd') emit(onProgress,{model:model.id,phase:'fallback',loaded:model.bytes,total:model.bytes,text:copy('当前设备使用 CPU 运行高清 AI；轻量设备建议选择快速 AI','This device is running HD AI on the CPU; Fast AI is recommended for entry-level devices')});
      sessionOptions.executionProviders=['wasm']; var wasm=await buildOrtSession(ort,bytes,sessionOptions,model,signal,copy(model.label+' WASM 初始化超时，请重试',model.label+' WASM initialisation timed out; retry')); backends[model.id]='WASM'; return wasm;
    })().catch(function(e){ delete sessionPromises[model.id]; throw e; });
    return guarded(sessionPromises[model.id],0,'',signal);
  }

  function makeInput(source,model){
    var size=model.inputSize,c=document.createElement('canvas'); c.width=c.height=size;
    var g=c.getContext('2d',{willReadFrequently:true}); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high'; g.drawImage(source,0,0,size,size);
    var d=g.getImageData(0,0,size,size).data,n=size*size,out=new Float32Array(n*3),means=[.485,.456,.406],stds=[.229,.224,.225];
    for(var i=0;i<n;i++){
      var p=i*4;
      if(model.normalize==='imagenet'){
        out[i]=(d[p]/255-means[0])/stds[0]; out[n+i]=(d[p+1]/255-means[1])/stds[1]; out[n*2+i]=(d[p+2]/255-means[2])/stds[2];
      } else {
        out[i]=(d[p]-128)/256; out[n+i]=(d[p+1]-128)/256; out[n*2+i]=(d[p+2]-128)/256;
      }
    }
    // 推理只需要 Float32 输入；立即释放临时 RGBA 画布，降低移动端峰值内存。
    d=null;g=null;c.width=c.height=1;c=null;
    return out;
  }

  function halfToFloat(h){
    var s=(h&0x8000)?-1:1,e=(h>>10)&31,f=h&1023;
    if(e===0) return s*Math.pow(2,-14)*(f/1024);
    if(e===31) return f?NaN:s*Infinity;
    return s*Math.pow(2,e-15)*(1+f/1024);
  }

  async function segment(source,modelId,onProgress,options){
    if(typeof modelId==='function'){ onProgress=modelId; modelId='quick'; }
    var signal=options&&options.signal;throwIfAborted(signal);
    var model=getModel(modelId),session=await createSession(model.id,onProgress,options),size=model.inputSize;
    emit(onProgress,{model:model.id,phase:'prepare',loaded:model.bytes,total:model.bytes,text:copy(model.label+' 正在分析主体与背景',model.label+' is analysing the subject and background')});
    await yieldToUI();throwIfAborted(signal);
    var input=makeInput(source,model),tensor=new ort.Tensor('float32',input,[1,3,size,size]);
    var feeds={}; feeds[session.inputNames[0]]=tensor;
    var wanted=session.outputNames.indexOf('output')>=0?'output':session.outputNames[0];
    if(inferencePending>0)emit(onProgress,{model:model.id,phase:'queue',loaded:model.bytes,total:model.bytes,text:copy('正在等待上一项本地 AI 计算结束','Waiting for the previous local AI task to finish')});
    inferencePending++;
    var scheduled=inferenceTail.then(async function(){throwIfAborted(signal);emit(onProgress,{model:model.id,phase:'infer',loaded:model.bytes,total:model.bytes,text:copy(model.label+' 正在运行本地推理',model.label+' is running local inference')});await yieldToUI();return session.run(feeds,[wanted]);}).finally(function(){inferencePending--;});
    // 队列只保留“已结束”信号，不能把上一次输出张量长期挂在全局 Promise 上。
    inferenceTail=scheduled.then(function(){},function(){});
    var results=await guarded(scheduled,inferenceTimeout(model),copy(model.label+'推理超时，请重试或改用快速 AI',model.label+' inference timed out; retry or use Fast AI'),signal),result=results[wanted],raw=result.data,dims=result.dims||[],mh=dims[dims.length-2]||size,mw=dims[dims.length-1]||size,count=mw*mh;
    input=null;tensor=null;feeds=null;results=null;
    emit(onProgress,{model:model.id,phase:'mask',loaded:model.bytes,total:model.bytes,text:copy('推理完成，正在生成透明蒙版','Inference is complete; generating the transparency mask')});
    await yieldToUI();throwIfAborted(signal);
    if(raw.length<count) throw new Error(copy(model.label+' 返回的蒙版尺寸异常',model.label+' returned an invalid mask size'));
    var isHalf=result.type==='float16',logits=false,min=Infinity,max=-Infinity;
    for(var k=0;k<count;k++){ var sample=isHalf?halfToFloat(raw[k]):raw[k]; if(sample<min)min=sample;if(sample>max)max=sample;if(sample<0||sample>1)logits=true; }
    var mask=new Uint8ClampedArray(count),span=max-min;
    for(var i=0;i<count;i++){
      var v=isHalf?halfToFloat(raw[i]):raw[i];
      if(logits) v=1/(1+Math.exp(-v));
      // 极端退化输出才做归一化；正常 AI 模型输出保留原始半透明置信度。
      if(!isFinite(v))v=0;
      mask[i]=Math.max(0,Math.min(255,Math.round(v*255)));
    }
    if(span<1e-7) mask.fill(max>.5?255:0);
    emit(onProgress,{model:model.id,phase:'done',loaded:model.bytes,total:model.bytes,text:copy(model.label+' 抠图完成',model.label+' background removal complete')});
    return {mask:mask,width:mw,height:mh,backend:backends[model.id],model:model.id,modelLabel:model.label};
  }

  async function isCached(modelId){ var model=getModel(modelId); if(!('caches' in window)) return false;try{var c=await guarded(caches.open(CACHE_NAME),10000,copy('模型缓存响应超时','The model cache timed out'));return !!(await guarded(c.match(cacheKey(model)),10000,copy('读取模型缓存超时','Reading the model cache timed out')));}catch(_e){return false;} }
  async function cachedModels(){ var out={}; await Promise.all(Object.keys(MODELS).map(async function(id){out[id]=await isCached(id);})); return out; }
  async function removeCached(modelId){ var model=getModel(modelId);markVerified(model,false);if(!('caches' in window)) return false;try{var c=await guarded(caches.open(CACHE_NAME),10000,copy('模型缓存响应超时','The model cache timed out'));return await guarded(c.delete(cacheKey(model)),10000,copy('删除模型缓存超时','Removing the model cache timed out'));}catch(_e){return false;} }
  function status(modelId){ var model=getModel(modelId); return {model:model.id,sessionReady:!!sessionPromises[model.id],backend:backends[model.id]||''}; }
  window.TYBG={segment:segment,load:createSession,isCached:isCached,cachedModels:cachedModels,removeCached:removeCached,status:status,support:modelSupport,deviceProfile:deviceProfile,getModel:function(id){return publicModel(getModel(id));},models:listModels(),modelRelease:MODEL_RELEASE,modelBytes:MODELS.quick.bytes,modelUrl:MODELS.quick.url};
})();
