/* 图映 · 浏览器本地视频抠像加载器
 * RVM 以跨帧循环状态保持人物边缘稳定；视频帧与蒙版始终留在浏览器内。
 */
(function(){
  'use strict';
  var ownScript=document.currentScript;
  var BASE=new URL('./',ownScript&&ownScript.src||location.href).href;
  var EN=(((document.documentElement&&document.documentElement.lang)||'').toLowerCase().indexOf('en')===0);
  function copy(zh,en){return EN?en:zh;}
  var CACHE_NAME='tuying-video-matting-v2';
  var MODEL_RELEASE='v1.0.1-web';
  var MODEL_CDN_BASE='https://modelscope.cn/models/dragonsoar/imging-video-matting/resolve/'+MODEL_RELEASE+'/';
  var MODELS={
    balanced:{
      id:'balanced',label:copy('兼容模式','Compatible'),technicalName:'RVM MobileNetV3 FP16',
      description:copy('下载小，适合普通电脑和较长视频','Small download for typical computers and longer videos'),
      file:'rvm-mobilenetv3-fp16.onnx',bytes:7503483,sha256:'6a0d5ce6cc17702613be548559879b4521ed424cfe14ddc48d1acaa44d616f64',analysisSide:512
    },
    quality:{
      id:'quality',label:copy('质量优先','Quality first'),technicalName:'RVM ResNet50 FP16',
      description:copy('细节更稳，下载和计算时间更长','More stable detail with a larger download and longer processing time'),
      file:'rvm-resnet50-fp16.onnx',bytes:53752558,sha256:'6ab2e8530a3f5decb3d7b2b40e09e213b0f0cd0e138570284b83654500848b5e',analysisSide:640
    }
  };
  Object.keys(MODELS).forEach(function(id){
    var model=MODELS[id];
    model.url=MODEL_CDN_BASE+model.file;
    model.localUrl=new URL('../models/video-matting/'+model.file,BASE).href+'?sha='+model.sha256.slice(0,12);
    var cdn={id:'modelscope',label:'ModelScope CDN',url:model.url,credentials:'omit'};
    var local={id:'local',label:copy('本站高速资源','site model asset'),url:model.localUrl,credentials:'same-origin'};
    model.sources=[local,cdn];
  });

  var runtimePromise=null,runtimeScript=null,sessionPromises={},backends={};
  var halfTable=new Uint16Array(256);

  function abortError(){var e=new Error(copy('任务已停止','The task was stopped'));e.name='AbortError';return e;}
  function throwIfAborted(signal){if(signal&&signal.aborted)throw abortError();}
  function emit(fn,data){if(typeof fn==='function')fn(data);}
  function publicModel(model){return{id:model.id,label:model.label,technicalName:model.technicalName,description:model.description,bytes:model.bytes,sizeText:formatBytes(model.bytes),sha256:model.sha256,release:MODEL_RELEASE,url:model.url,fallbackUrl:model.localUrl};}
  function getModel(id){return MODELS[id]||MODELS.balanced;}
  function formatBytes(bytes){return bytes>=1048576?(bytes/1048576).toFixed(bytes>=10485760?1:2)+' MB':Math.round(bytes/1024)+' KB';}
  function formatSeconds(seconds){seconds=Math.max(0,Math.round(seconds||0));if(seconds<60)return seconds+' '+copy('秒','sec');var m=Math.floor(seconds/60),s=seconds%60;return m+' '+copy('分','min')+(s?' '+s+' '+copy('秒','sec'):'');}
  function cacheKey(model){return model.localUrl;}
  function verifiedKey(model){return CACHE_NAME+':verified:'+model.id;}
  function isVerified(model){try{return localStorage.getItem(verifiedKey(model))===model.sha256;}catch(_e){return false;}}
  function markVerified(model,ok){try{if(ok)localStorage.setItem(verifiedKey(model),model.sha256);else localStorage.removeItem(verifiedKey(model));}catch(_e){}}
  function hex(buffer){return Array.prototype.map.call(new Uint8Array(buffer),function(v){return v.toString(16).padStart(2,'0');}).join('');}
  function guarded(promise,ms,message,signal,onTimeout){
    return new Promise(function(resolve,reject){
      var done=false,t=ms?setTimeout(function(){if(done)return;done=true;cleanup();try{if(onTimeout)onTimeout();}catch(_e){}reject(new Error(message));},ms):null;
      function cleanup(){if(t)clearTimeout(t);if(signal)signal.removeEventListener('abort',onAbort);}
      function onAbort(){if(done)return;done=true;cleanup();reject(abortError());}
      if(signal){if(signal.aborted){onAbort();return;}signal.addEventListener('abort',onAbort,{once:true});}
      Promise.resolve(promise).then(function(value){if(done)return;done=true;cleanup();resolve(value);},function(error){if(done)return;done=true;cleanup();reject(error);});
    });
  }
  function yieldToUI(){return new Promise(function(resolve){var done=false,t=setTimeout(finish,100);function finish(){if(done)return;done=true;clearTimeout(t);resolve();}requestAnimationFrame(function(){requestAnimationFrame(finish);});});}

  function loadRuntime(onProgress,signal){
    throwIfAborted(signal);
    if(window.ort){emit(onProgress,{phase:'runtime-ready',text:copy('本地 AI 运行时已就绪','Local AI runtime is ready')});return Promise.resolve(window.ort);}
    emit(onProgress,{phase:'runtime',text:copy('正在加载本地 AI 运行时','Loading the local AI runtime')});
    if(!runtimePromise){
      runtimeScript=document.createElement('script');runtimeScript.src=new URL('ort.webgpu.min.js',BASE).href;runtimeScript.async=true;
      runtimePromise=guarded(new Promise(function(resolve,reject){runtimeScript.onload=function(){window.ort?resolve(window.ort):reject(new Error(copy('AI 运行时未正确加载','AI runtime did not load correctly')));};runtimeScript.onerror=function(){reject(new Error(copy('无法加载本地 AI 运行时','Could not load the local AI runtime')));};document.head.appendChild(runtimeScript);}),30000,copy('AI 运行时加载超时','AI runtime loading timed out'),null).catch(function(error){runtimePromise=null;if(runtimeScript&&runtimeScript.parentNode)runtimeScript.parentNode.removeChild(runtimeScript);runtimeScript=null;throw error;});
    }
    return guarded(runtimePromise,0,'',signal).then(function(ort){emit(onProgress,{phase:'runtime-ready',text:copy('本地 AI 运行时加载完成','Local AI runtime loaded')});return ort;});
  }

  async function verifyModel(buffer,model,onProgress,signal,sourceLabel){
    throwIfAborted(signal);
    emit(onProgress,{model:model.id,phase:'verify',loaded:buffer.byteLength,total:model.bytes,percent:100,sourceLabel:sourceLabel,text:copy('下载完成，正在校验模型完整性','Download complete; verifying model integrity')});
    if(buffer.byteLength!==model.bytes)throw new Error(copy('模型大小不正确：应为 '+model.bytes+' 字节，实际 '+buffer.byteLength+' 字节','Incorrect model size'));
    if(!(window.crypto&&window.crypto.subtle))throw new Error(copy('当前浏览器不能进行 SHA-256 完整性校验','This browser cannot perform SHA-256 verification'));
    var digest=await guarded(window.crypto.subtle.digest('SHA-256',buffer),120000,copy('模型完整性校验超时','Model integrity verification timed out'),signal);
    if(hex(digest)!==model.sha256)throw new Error(copy('模型 SHA-256 校验失败，已拒绝使用','Model SHA-256 verification failed'));
    emit(onProgress,{model:model.id,phase:'verified',loaded:model.bytes,total:model.bytes,percent:100,sourceLabel:sourceLabel,text:copy('模型完整性校验成功','Model integrity verified')});
  }

  async function responseBuffer(res,model,onProgress,signal,source,controller){
    if(!(res.body&&res.body.getReader))return guarded(res.arrayBuffer(),300000,copy('模型下载超时','Model download timed out'),signal,function(){controller.abort();});
    var reader=res.body.getReader(),loaded=0,total=+(res.headers.get('content-length')||model.bytes),parts=[],started=performance.now(),lastAt=started,lastLoaded=0,smoothSpeed=0;
    try{
      while(true){
        throwIfAborted(signal);
        var item=await guarded(reader.read(),30000,copy('模型下载长时间没有数据，请检查网络后重试','Model download stalled; check the network and retry'),signal,function(){controller.abort();});
        if(item.done)break;
        parts.push(item.value);loaded+=item.value.byteLength;
        var now=performance.now(),elapsed=Math.max(.001,(now-lastAt)/1000),instant=(loaded-lastLoaded)/elapsed;
        if(now-lastAt>=350){smoothSpeed=smoothSpeed?smoothSpeed*.68+instant*.32:instant;lastAt=now;lastLoaded=loaded;}
        var speed=smoothSpeed||loaded/Math.max(.001,(now-started)/1000),eta=speed>0?(total-loaded)/speed:0;
        emit(onProgress,{model:model.id,phase:'download',loaded:loaded,total:total,percent:Math.min(100,loaded/total*100),speedBps:speed,etaSeconds:eta,source:source.id,sourceLabel:source.label,text:copy('正在从 '+source.label+' 下载 '+model.label,'Downloading '+model.label+' from '+source.label),detail:formatBytes(loaded)+' / '+formatBytes(total)+' · '+formatBytes(speed)+'/s'+(eta>0?' · '+copy('约还需 ','about ')+formatSeconds(eta):'')});
      }
    }catch(error){try{await reader.cancel();}catch(_e){}throw error;}
    var merged=new Uint8Array(loaded),offset=0;parts.forEach(function(part){merged.set(part,offset);offset+=part.byteLength;});return merged.buffer;
  }

  async function readModel(model,onProgress,signal){
    throwIfAborted(signal);
    var cache=null;
    if('caches' in window)try{cache=await caches.open(CACHE_NAME);}catch(_e){}
    if(cache){
      var hit=null;try{hit=await cache.match(cacheKey(model));}catch(_e){}
      if(hit){
        emit(onProgress,{model:model.id,phase:'cache',loaded:model.bytes,total:model.bytes,percent:100,text:copy('已从浏览器缓存读取 '+model.label,'Loaded '+model.label+' from browser cache')});
        try{var cached=await hit.arrayBuffer();if(cached.byteLength===model.bytes&&isVerified(model))return cached;await verifyModel(cached,model,onProgress,signal,copy('浏览器缓存','browser cache'));markVerified(model,true);return cached;}catch(error){if(error&&error.name==='AbortError')throw error;markVerified(model,false);try{await cache.delete(cacheKey(model));}catch(_e){}}
      }
    }
    var errors=[];
    for(var i=0;i<model.sources.length;i++){
      var source=model.sources[i],controller=new AbortController(),relay=function(){controller.abort();};if(signal)signal.addEventListener('abort',relay,{once:true});
      try{
        emit(onProgress,{model:model.id,phase:'connect',loaded:0,total:model.bytes,percent:0,source:source.id,sourceLabel:source.label,text:copy('正在连接 '+source.label,'Connecting to '+source.label)});
        var response=await guarded(fetch(source.url,{mode:'cors',credentials:source.credentials,signal:controller.signal}),30000,copy(source.label+' 连接超时',source.label+' connection timed out'),signal,function(){controller.abort();});
        if(!response.ok)throw new Error('HTTP '+response.status);
        var buffer=await responseBuffer(response,model,onProgress,signal,source,controller);
        await verifyModel(buffer,model,onProgress,signal,source.label);
        if(cache)try{await cache.put(cacheKey(model),new Response(buffer,{headers:{'content-type':'application/octet-stream','content-length':String(buffer.byteLength)}}));markVerified(model,true);}catch(_e){markVerified(model,false);}
        return buffer;
      }catch(error){
        if(error&&error.name==='AbortError')throw error;
        errors.push(source.label+': '+(error&&error.message||error));
        if(i+1<model.sources.length)emit(onProgress,{model:model.id,phase:'source-fallback',loaded:0,total:model.bytes,percent:0,text:copy(source.label+' 不可用，正在切换备用地址',source.label+' unavailable; switching source')});
      }finally{if(signal)signal.removeEventListener('abort',relay);}
    }
    throw new Error(copy(model.label+' 下载失败：',model.label+' download failed: ')+errors.join('；'));
  }

  async function createSession(modelId,onProgress,options){
    var model=getModel(modelId),signal=options&&options.signal;throwIfAborted(signal);
    if(sessionPromises[model.id])return guarded(sessionPromises[model.id],0,'',signal);
    sessionPromises[model.id]=(async function(){
      var ort=await loadRuntime(onProgress,signal);ort.env.logLevel='error';ort.env.wasm.wasmPaths=BASE;ort.env.wasm.numThreads=(self.crossOriginIsolated&&navigator.hardwareConcurrency)?Math.min(4,navigator.hardwareConcurrency):1;
      var bytes=await readModel(model,onProgress,signal),sessionOptions={graphOptimizationLevel:'all',executionMode:'sequential',logSeverityLevel:3};
      emit(onProgress,{model:model.id,phase:'init',loaded:model.bytes,total:model.bytes,percent:100,text:copy('模型已下载，正在初始化 '+model.label,'Model downloaded; initialising '+model.label)});await yieldToUI();
      if(navigator.gpu&&isSecureContext){
        try{sessionOptions.executionProviders=['webgpu'];var gpu=await guarded(ort.InferenceSession.create(bytes,sessionOptions),300000,copy('WebGPU 初始化超时','WebGPU initialisation timed out'),signal);backends[model.id]='WebGPU';emit(onProgress,{model:model.id,phase:'ready',percent:100,text:copy(model.label+' 已就绪，正在开始抠像',model.label+' is ready; starting matting')});return gpu;}
        catch(error){if(error&&error.name==='AbortError')throw error;emit(onProgress,{model:model.id,phase:'fallback',percent:100,text:copy('当前 WebGPU 不兼容此模型，正在切换 WASM','WebGPU is incompatible; switching to WASM')});}
      }
      sessionOptions.executionProviders=['wasm'];var wasm=await guarded(ort.InferenceSession.create(bytes,sessionOptions),300000,copy('WASM 初始化超时','WASM initialisation timed out'),signal);backends[model.id]='WASM';emit(onProgress,{model:model.id,phase:'ready',percent:100,text:copy(model.label+' 已通过 WASM 就绪；处理会比较慢',model.label+' is ready on WASM; processing will be slower')});return wasm;
    })().catch(function(error){delete sessionPromises[model.id];throw error;});
    return guarded(sessionPromises[model.id],0,'',signal);
  }

  function floatToHalf(value){
    if(value===0)return 0;var f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);f32[0]=value;var x=u32[0],sign=(x>>>16)&0x8000,mantissa=x&0x7fffff,exp=(x>>>23)&255;
    if(exp===255)return sign|(mantissa?0x7e00:0x7c00);exp=exp-127+15;if(exp>=31)return sign|0x7c00;if(exp<=0){if(exp<-10)return sign;mantissa=(mantissa|0x800000)>>(1-exp);return sign|((mantissa+0x1000)>>13);}return sign|(exp<<10)|((mantissa+0x1000)>>13);
  }
  function halfToFloat(h){var s=(h&0x8000)?-1:1,e=(h>>10)&31,f=h&1023;if(e===0)return s*Math.pow(2,-14)*(f/1024);if(e===31)return f?NaN:s*Infinity;return s*Math.pow(2,e-15)*(1+f/1024);}
  for(var tableIndex=0;tableIndex<256;tableIndex++)halfTable[tableIndex]=floatToHalf(tableIndex/255);
  function tensorValue(tensor,index){return tensor.type==='float16'?halfToFloat(tensor.data[index]):tensor.data[index];}
  function disposeTensor(tensor){try{if(tensor&&tensor.dispose)tensor.dispose();}catch(_e){}}
  function disposeRec(rec){if(rec)rec.forEach(disposeTensor);}
  function newRec(ort){return[0,1,2,3].map(function(){return new ort.Tensor('float16',new Uint16Array(1),[1,1,1,1]);});}
  function resetState(state){if(!state)return;disposeRec(state.rec);state.rec=null;state.prevAlpha=null;state.prevProbe=null;state.frameIndex=0;state.sceneCuts=0;}
  function createState(){return{rec:null,prevAlpha:null,prevProbe:null,frameIndex:0,sceneCuts:0};}
  function makeProbe(data,width,height){var cols=12,rows=7,out=new Float32Array(cols*rows),n=0;for(var y=0;y<rows;y++){var py=Math.min(height-1,Math.round((y+.5)*height/rows));for(var x=0;x<cols;x++){var px=Math.min(width-1,Math.round((x+.5)*width/cols)),o=(py*width+px)*4;out[n++]=(data[o]*.299+data[o+1]*.587+data[o+2]*.114)/255;}}return out;}
  function isSceneCut(previous,current){if(!previous||previous.length!==current.length)return false;var diff=0;for(var i=0;i<current.length;i++)diff+=Math.abs(current[i]-previous[i]);return diff/current.length>.31;}

  async function matte(source,modelId,state,onProgress,options){
    options=options||{};var signal=options.signal;throwIfAborted(signal);var model=getModel(modelId),session=await createSession(model.id,onProgress,options),width=options.width||source.displayWidth||source.videoWidth||source.naturalWidth||source.width,height=options.height||source.displayHeight||source.videoHeight||source.naturalHeight||source.height;
    width=Math.max(2,Math.round(width));height=Math.max(2,Math.round(height));state=state||createState();
    var inputCanvas=options.inputCanvas||state.inputCanvas||document.createElement('canvas');if(inputCanvas===source)inputCanvas=state.inputCanvas||document.createElement('canvas');state.inputCanvas=inputCanvas;if(inputCanvas.width!==width)inputCanvas.width=width;if(inputCanvas.height!==height)inputCanvas.height=height;var inputContext=inputCanvas.getContext('2d',{willReadFrequently:true});inputContext.clearRect(0,0,width,height);inputContext.drawImage(source,0,0,width,height);var image=inputContext.getImageData(0,0,width,height),pixels=image.data,n=width*height,probe=makeProbe(pixels,width,height),sceneCut=isSceneCut(state.prevProbe,probe);
    if(sceneCut){disposeRec(state.rec);state.rec=null;state.prevAlpha=null;state.sceneCuts++;}state.prevProbe=probe;
    emit(onProgress,{model:model.id,phase:'prepare-frame',frameIndex:state.frameIndex,sceneCut:sceneCut,text:sceneCut?copy('检测到镜头切换，已重置时序状态','Scene cut detected; temporal state reset'):copy('正在准备视频帧','Preparing video frame')});
    var input=new Uint16Array(n*3);for(var i=0;i<n;i++){var p=i*4;input[i]=halfTable[pixels[p]];input[n+i]=halfTable[pixels[p+1]];input[n*2+i]=halfTable[pixels[p+2]];}
    var srcTensor=new ort.Tensor('float16',input,[1,3,height,width]),recInputs=state.rec||newRec(ort),ratio=Math.min(model.analysisSide/Math.max(width,height),1),ratioTensor=new ort.Tensor('float32',new Float32Array([ratio]),[1]),feeds={src:srcTensor,r1i:recInputs[0],r2i:recInputs[1],r3i:recInputs[2],r4i:recInputs[3],downsample_ratio:ratioTensor};
    emit(onProgress,{model:model.id,phase:'infer-frame',frameIndex:state.frameIndex,text:copy('正在进行时序抠像','Running temporal matting')});await yieldToUI();throwIfAborted(signal);
    var results;
    try{results=await session.run(feeds);}finally{disposeTensor(srcTensor);disposeTensor(ratioTensor);}
    throwIfAborted(signal);disposeRec(recInputs);state.rec=[results.r1o,results.r2o,results.r3o,results.r4o];
    var fgr=results.fgr,pha=results.pha;if(!fgr||!pha)throw new Error(copy('视频模型输出不完整','Video model returned incomplete output'));
    var outCanvas=options.outputCanvas||document.createElement('canvas');if(outCanvas.width!==width)outCanvas.width=width;if(outCanvas.height!==height)outCanvas.height=height;var outContext=outCanvas.getContext('2d'),out=outContext.createImageData(width,height),rgba=out.data,previous=state.prevAlpha,alpha=new Uint8ClampedArray(n);
    for(var j=0;j<n;j++){
      var a=Math.max(0,Math.min(255,Math.round(tensorValue(pha,j)*255)));if(previous){var delta=Math.abs(a-previous[j]);if(delta<42)a=Math.round(a*.72+previous[j]*.28);}if(a<3)a=0;else if(a>252)a=255;alpha[j]=a;var q=j*4;
      rgba[q]=Math.max(0,Math.min(255,Math.round(tensorValue(fgr,j)*255)));rgba[q+1]=Math.max(0,Math.min(255,Math.round(tensorValue(fgr,n+j)*255)));rgba[q+2]=Math.max(0,Math.min(255,Math.round(tensorValue(fgr,n*2+j)*255)));rgba[q+3]=a;
    }
    state.prevAlpha=alpha;state.frameIndex++;outContext.putImageData(out,0,0);disposeTensor(fgr);disposeTensor(pha);
    Object.keys(results).forEach(function(name){if(name!=='fgr'&&name!=='pha'&&name!=='r1o'&&name!=='r2o'&&name!=='r3o'&&name!=='r4o')disposeTensor(results[name]);});
    return{canvas:outCanvas,state:state,backend:backends[model.id],model:model.id,modelLabel:model.label,sceneCut:sceneCut,downsampleRatio:ratio};
  }

  async function isCached(modelId){var model=getModel(modelId);if(!('caches' in window))return false;try{var cache=await caches.open(CACHE_NAME);return!!(await cache.match(cacheKey(model)));}catch(_e){return false;}}
  async function cachedModels(){var result={};await Promise.all(Object.keys(MODELS).map(async function(id){result[id]=await isCached(id);}));return result;}
  async function removeCached(modelId){var model=getModel(modelId);markVerified(model,false);if(!('caches' in window))return false;try{var cache=await caches.open(CACHE_NAME);return await cache.delete(cacheKey(model));}catch(_e){return false;}}
  function capabilities(){return{secure:isSecureContext,webcodecs:typeof VideoDecoder!=='undefined'&&typeof VideoEncoder!=='undefined',webgpu:!!navigator.gpu,wasm:typeof WebAssembly!=='undefined',crossOriginIsolated:!!self.crossOriginIsolated};}

  window.TYVM={models:Object.keys(MODELS).map(function(id){return publicModel(MODELS[id]);}),getModel:function(id){return publicModel(getModel(id));},load:createSession,matte:matte,createState:createState,resetState:resetState,isCached:isCached,cachedModels:cachedModels,removeCached:removeCached,capabilities:capabilities,modelRelease:MODEL_RELEASE};
})();
