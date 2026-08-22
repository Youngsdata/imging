/* 图映 · 浏览器本地视频抠像加载器
 * RVM 与 MatAnyone2 Beta 链路均以跨帧状态保持边缘稳定；视频帧与蒙版始终留在浏览器内。
 */
(function(){
  'use strict';
  var ownScript=document.currentScript;
  var BASE=new URL('./',ownScript&&ownScript.src||location.href).href;
  var RUNTIME_BASE=window.TY_AI_RUNTIME_BASE||BASE;
  var LANGUAGE=((document.documentElement&&document.documentElement.lang)||'zh-CN').toLowerCase();
  function copy(zh,en){return typeof window.TYTr==='function'?window.TYTr(zh,en):(LANGUAGE.indexOf('zh')===0?zh:en);}
  function matParts(imageBytes,imageSha,maskSha,firstBytes,firstSha,stepSha){return[
    {name:'imageKey',label:copy('图像特征','image features'),file:'matanyone2_image_key.onnx',bytes:imageBytes,sha256:imageSha},
    {name:'maskMemory',label:copy('蒙版记忆','mask memory'),file:'matanyone2_mask_memory.onnx',bytes:40061996,sha256:maskSha},
    {name:'firstRefine',label:copy('首帧精修','first-frame refinement'),file:'matanyone2_first_frame_refine.onnx',bytes:firstBytes,sha256:firstSha},
    {name:'stepUpdate',label:copy('时序传播','temporal propagation'),file:'matanyone2_step_update.onnx',bytes:154147770,sha256:stepSha}
  ];}
  var CACHE_NAME='tuying-video-matting-v2';
  var MODEL_RELEASE='v1.1.0-web';
  var MODEL_CDN_BASE='https://modelscope.cn/models/dragonsoar/imging-video-matting/resolve/'+MODEL_RELEASE+'/';
  var MODELS={
    balanced:{
      id:'balanced',label:copy('兼容模式','Compatible'),technicalName:'RVM MobileNetV3 FP16',
      description:copy('下载小，适合普通电脑和较长视频','Small download for typical computers and longer videos'),
      file:'rvm-mobilenetv3-fp16.onnx',bytes:7503483,sha256:'6a0d5ce6cc17702613be548559879b4521ed424cfe14ddc48d1acaa44d616f64',analysisSide:512,forceWasm:true
    },
    quality:{
      id:'quality',label:copy('质量优先','Quality first'),technicalName:'RVM ResNet50 FP16',
      description:copy('细节更稳，下载和计算时间更长','More stable detail with a larger download and longer processing time'),
      file:'rvm-resnet50-fp16.onnx',bytes:53752558,sha256:'6ab2e8530a3f5decb3d7b2b40e09e213b0f0cd0e138570284b83654500848b5e',analysisSide:640,forceWasm:true
    },
    experimental:{
      id:'experimental',kind:'matanyone2',label:copy('实验极致','Experimental ultimate'),technicalName:'MatAnyone2 ONNX FP32 · Adaptive HD',
      description:copy('保持原比例，自动匹配有效像素最多的高清模型，并用 RVM ResNet50 校准首帧细节；仅限非商业测试','Preserves the source aspect ratio, selects the HD profile with the most usable pixels, and calibrates first-frame detail with RVM ResNet50; non-commercial testing only'),
      bytes:307843860,
      profiles:[
        {key:'landscape',label:copy('横屏 1280×720','Landscape 1280×720'),directory:'matanyone2-1280x720',analysisWidth:1280,analysisHeight:720,bytes:307843860,release:'matanyone2-onnx-1280x720-t5-no-residual',parts:matParts(37426352,'a4bc8ee74e10fc47317198a9d078f2609473f891f02c7c30f54d6b3a8928fe70','79cf77320d31715d23038669d1d8d8ef6fd0a2b450896f3d6105b707426499dd',76207742,'d968b19c22eae27fbbd6e57dbf1eba35a7313df43ee29920c40c90b855589abe','06cd829c1bd9543b2f49025870a7506ca8aeb28f454a0d35091674894a4de152')},
        {key:'square',label:copy('方形 960×960','Square 960×960'),directory:'matanyone2-960x960',analysisWidth:960,analysisHeight:960,bytes:307843858,release:'matanyone2-onnx-960x960-t5-no-residual',parts:matParts(37426351,'3ba8d37c46ea897aca495b85677e835495caa1219fa495bd9a0568c1b678092e','418132d81786ae921c9d90687c06933f5f48a1f22cea7ee4b49b52d553645bd0',76207741,'fe550006b946b0ab60ecc6b78562f1e58d8dd131882cb61f349e8c83a5edb0d3','067d55915218133baeef3646ec3f9320ec992ada7727f90b5dada1dab52039c8')},
        {key:'portrait',label:copy('竖屏 720×1280','Portrait 720×1280'),directory:'matanyone2-720x1280',analysisWidth:720,analysisHeight:1280,bytes:307843860,release:'matanyone2-onnx-720x1280-t5-no-residual',parts:matParts(37426352,'762b0fefc31cf2a6766cbe1148539d84acb90a1b179456f8bf0c27d1d3e36e33','6bae2ff6e83913225c3b6b134b74562df69ec4b408cb339f9ed9d38e8486d449',76207742,'460b165caa5a246a75a331325cdf937d836d6236500d0416a831b7417605ebe6','723a715c843a88825f6386bdfabd23fe2cac99df9f27769511ec6eb6dc7021af')}
      ]
    }
  };
  function modelSources(cdnUrl,localUrl){return[
    {id:'modelscope',label:'ModelScope CDN',url:cdnUrl,credentials:'omit'},
    {id:'local',label:copy('本站备用地址','site fallback'),url:localUrl,credentials:'same-origin'}
  ];}
  function prepareMatAnyoneProfile(parent,profile){
    profile.id=parent.id+'-'+profile.key;profile.parentId=parent.id;profile.kind='matanyone2';profile.technicalName='MatAnyone2 ONNX FP32 · '+profile.analysisWidth+'×'+profile.analysisHeight;profile.description=parent.description;profile.label=parent.label+' · '+profile.label;
    profile.parts.forEach(function(part){part.id=profile.id+'-'+part.name;part.parentId=parent.id;part.release=profile.release;part.url=MODEL_CDN_BASE+profile.directory+'/'+part.file;part.localUrl=new URL('../models/video-matting/'+profile.directory+'/'+part.file,BASE).href+'?sha='+part.sha256.slice(0,12);part.sources=modelSources(part.url,part.localUrl);});
    profile.url=profile.parts[0].url;profile.localUrl=profile.parts[0].localUrl;profile.sha256=profile.parts.map(function(part){return part.sha256.slice(0,12);}).join('-');return profile;
  }
  Object.keys(MODELS).forEach(function(id){
    var model=MODELS[id];
    if(model.kind==='matanyone2'){
      model.profiles.forEach(function(profile){prepareMatAnyoneProfile(model,profile);});
      var fallback=model.profiles[0];model.url=fallback.url;model.localUrl=fallback.localUrl;model.sha256=fallback.sha256;model.release='adaptive-hd-t5-no-residual';
      return;
    }
    model.url=MODEL_CDN_BASE+model.file;
    model.localUrl=new URL('../models/video-matting/'+model.file,BASE).href+'?sha='+model.sha256.slice(0,12);
    model.sources=modelSources(model.url,model.localUrl);
  });

  var runtimePromise=null,runtimeScript=null,sessionPromises={},backends={},bootstrapQualityUnavailable={};
  var halfTable=new Uint16Array(256);

  function abortError(){var e=new Error(copy('任务已停止','The task was stopped'));e.name='AbortError';return e;}
  function throwIfAborted(signal){if(signal&&signal.aborted)throw abortError();}
  function emit(fn,data){if(typeof fn==='function')fn(data);}
  function publicModel(model){return{id:model.id,label:model.label,technicalName:model.technicalName,description:model.description,bytes:model.bytes,sizeText:formatBytes(model.bytes),sha256:model.sha256,release:model.release||MODEL_RELEASE,url:model.url,fallbackUrl:model.localUrl,kind:model.kind||'rvm',profile:model.key||'',analysisWidth:model.analysisWidth||0,analysisHeight:model.analysisHeight||0};}
  function getModel(id){return MODELS[id]||MODELS.balanced;}
  function selectMatAnyoneProfile(model,width,height){
    if(!model.profiles)return model;width=Math.max(1,+width||16);height=Math.max(1,+height||9);var best=model.profiles[0],bestPixels=-1;
    model.profiles.forEach(function(profile){var fit=containFit(width,height,profile.analysisWidth,profile.analysisHeight),pixels=fit.width*fit.height;if(pixels>bestPixels){best=profile;bestPixels=pixels;}});return best;
  }
  function resolveModel(model,options){return model&&model.profiles?selectMatAnyoneProfile(model,options&&options.width,options&&options.height):model;}
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
      runtimeScript=document.createElement('script');runtimeScript.src=new URL('ort.webgpu.min.js',RUNTIME_BASE).href;runtimeScript.async=true;
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

  function releaseSessions(sessions){if(!sessions)return;Object.keys(sessions).forEach(function(name){try{var session=sessions[name];if(session&&session.release)session.release();}catch(_e){}});}
  function aggregatePartProgress(model,part,completed,onProgress){
    return function(progress){
      var current=Math.max(0,Math.min(part.bytes,progress.loaded||0)),loaded=Math.min(model.bytes,completed+current),percent=model.bytes?loaded/model.bytes*100:0;
      emit(onProgress,Object.assign({},progress,{model:model.id,part:part.name,partLabel:part.label,loaded:loaded,total:model.bytes,percent:percent,detail:(progress.detail?part.label+' · '+progress.detail:progress.text)}));
    };
  }
  async function buildMatAnyoneSessions(model,provider,ort,onProgress,signal){
    var sessions={},completed=0;
    try{
      for(var index=0;index<model.parts.length;index++){
        var part=model.parts[index],progress=aggregatePartProgress(model,part,completed,onProgress),bytes=await readModel(part,progress,signal);
        emit(onProgress,{model:model.id,part:part.name,phase:'init',loaded:completed+part.bytes,total:model.bytes,percent:(completed+part.bytes)/model.bytes*100,text:copy('正在初始化 '+part.label,'Initialising '+part.label)});await yieldToUI();
        sessions[part.name]=await guarded(ort.InferenceSession.create(bytes,{graphOptimizationLevel:'all',executionMode:'sequential',logSeverityLevel:3,executionProviders:[provider]}),600000,copy(part.label+' 初始化超时',part.label+' initialisation timed out'),signal);
        completed+=part.bytes;
      }
      return sessions;
    }catch(error){releaseSessions(sessions);throw error;}
  }
  async function createMatAnyoneSessions(model,onProgress,options){
    var signal=options&&options.signal;throwIfAborted(signal);
    if(sessionPromises[model.id])return guarded(sessionPromises[model.id],0,'',signal);
    var otherProfiles=(MODELS[model.parentId]&&MODELS[model.parentId].profiles||[]).filter(function(profile){return profile.id!==model.id&&sessionPromises[profile.id];});
    for(var releaseIndex=0;releaseIndex<otherProfiles.length;releaseIndex++){
      var staleId=otherProfiles[releaseIndex].id,stalePromise=sessionPromises[staleId];delete sessionPromises[staleId];delete backends[staleId];
      try{releaseSessions(await stalePromise);}catch(_e){}
    }
    throwIfAborted(signal);if(sessionPromises[model.id])return guarded(sessionPromises[model.id],0,'',signal);
    sessionPromises[model.id]=(async function(){
      var ort=await loadRuntime(onProgress,signal);ort.env.logLevel='error';ort.env.wasm.wasmPaths=RUNTIME_BASE;ort.env.wasm.numThreads=(self.crossOriginIsolated&&navigator.hardwareConcurrency)?Math.min(4,navigator.hardwareConcurrency):1;
      if(navigator.gpu&&isSecureContext){
        try{
          var gpu=await buildMatAnyoneSessions(model,'webgpu',ort,onProgress,signal);backends[model.id]='WebGPU';
          emit(onProgress,{model:model.id,phase:'ready',loaded:model.bytes,total:model.bytes,percent:100,text:copy('MatAnyone2 已通过 WebGPU 就绪，正在生成首帧蒙版','MatAnyone2 is ready on WebGPU; generating the first-frame mask')});return gpu;
        }catch(error){if(error&&error.name==='AbortError')throw error;emit(onProgress,{model:model.id,phase:'fallback',loaded:model.bytes,total:model.bytes,percent:100,text:copy('MatAnyone2 WebGPU 不兼容，正在切换 WASM 稳定模式','MatAnyone2 is incompatible with WebGPU; switching to stable WASM')});}
      }
      var wasm=await buildMatAnyoneSessions(model,'wasm',ort,onProgress,signal);backends[model.id]='WASM';
      emit(onProgress,{model:model.id,phase:'ready',loaded:model.bytes,total:model.bytes,percent:100,text:copy('MatAnyone2 已通过 WASM 就绪；质量不变但处理会很慢','MatAnyone2 is ready on WASM; quality is unchanged but processing will be slow')});return wasm;
    })().catch(function(error){delete sessionPromises[model.id];throw error;});
    return guarded(sessionPromises[model.id],0,'',signal);
  }

  async function createSession(modelId,onProgress,options){
    var model=resolveModel(getModel(modelId),options),signal=options&&options.signal;throwIfAborted(signal);
    if(model.kind==='matanyone2'){
      var matSessions=await createMatAnyoneSessions(model,onProgress,options);
      // MatAnyone2 的时序质量取决于首帧种子。预先准备 RVM ResNet50，避免完整导出
      // 已开始后才静默下载；失败时仍允许图片模型与轻量 RVM 继续兜底。
      if(!bootstrapQualityUnavailable[model.id]){
        emit(onProgress,{model:model.id,phase:'bootstrap-model',percent:0,text:copy('正在准备高质量首帧校准模型','Preparing the high-quality first-frame calibrator')});
        try{
          await createSession('quality',function(progress){emit(onProgress,Object.assign({},progress,{model:model.id,phase:'bootstrap-model',bootstrapPhase:progress.phase,text:progress.text,detail:progress.detail||progress.text}));},options);
        }catch(error){
          if(error&&error.name==='AbortError')throw error;
          bootstrapQualityUnavailable[model.id]=true;
          emit(onProgress,{model:model.id,phase:'bootstrap-model-fallback',percent:100,text:copy('高质量首帧模型暂不可用，将自动使用备用识别','The high-quality first-frame model is unavailable; automatic fallback will be used'),detail:error&&error.message||String(error)});
        }
      }
      return matSessions;
    }
    if(sessionPromises[model.id])return guarded(sessionPromises[model.id],0,'',signal);
    sessionPromises[model.id]=(async function(){
      var ort=await loadRuntime(onProgress,signal);ort.env.logLevel='error';ort.env.wasm.wasmPaths=BASE;ort.env.wasm.numThreads=(self.crossOriginIsolated&&navigator.hardwareConcurrency)?Math.min(4,navigator.hardwareConcurrency):1;
      var bytes=await readModel(model,onProgress,signal),sessionOptions={graphOptimizationLevel:'all',executionMode:'sequential',logSeverityLevel:3};
      emit(onProgress,{model:model.id,phase:'init',loaded:model.bytes,total:model.bytes,percent:100,text:copy('模型已下载，正在初始化 '+model.label,'Model downloaded; initialising '+model.label)});await yieldToUI();
      if(!model.forceWasm&&navigator.gpu&&isSecureContext){
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
  function tensorValue(tensor,index){
    if(tensor.type!=='float16')return tensor.data[index];
    var data=tensor.data;
    // ONNX Runtime Web 旧版以 Uint16Array 暴露 FP16 原始位，新版 Chromium 则可能直接
    // 返回已经解码的 Float16Array。后者若再次按位解码会全部变成接近 0，造成整帧透明。
    if((typeof Float16Array!=='undefined'&&data instanceof Float16Array)||(data&&data.constructor&&data.constructor.name==='Float16Array'))return data[index];
    return halfToFloat(data[index]);
  }
  function disposeTensor(tensor){try{if(tensor&&tensor.dispose)tensor.dispose();}catch(_e){}}
  function disposeRec(rec){if(rec)rec.forEach(disposeTensor);}
  function disposeMap(map){if(!map)return;Object.keys(map).forEach(function(name){disposeTensor(map[name]);});}
  function disposeMatState(state){if(!state||!state.mat)return;disposeMap(state.mat);state.mat=null;}
  function newRec(ort){return[0,1,2,3].map(function(){return new ort.Tensor('float16',new Uint16Array(1),[1,1,1,1]);});}
  function resetState(state){if(!state)return;disposeRec(state.rec);disposeMatState(state);state.rec=null;state.prevAlpha=null;state.prevProbe=null;state.modelProfile=null;state.bootstrapSource='';state.bootstrapStats=null;state.frameIndex=0;state.sceneCuts=0;}
  function createState(){return{rec:null,mat:null,prevAlpha:null,prevProbe:null,modelProfile:null,bootstrapSource:'',bootstrapStats:null,frameIndex:0,sceneCuts:0};}
  function makeProbe(data,width,height){var cols=12,rows=7,out=new Float32Array(cols*rows),n=0;for(var y=0;y<rows;y++){var py=Math.min(height-1,Math.round((y+.5)*height/rows));for(var x=0;x<cols;x++){var px=Math.min(width-1,Math.round((x+.5)*width/cols)),o=(py*width+px)*4;out[n++]=(data[o]*.299+data[o+1]*.587+data[o+2]*.114)/255;}}return out;}
  function isSceneCut(previous,current){if(!previous||previous.length!==current.length)return false;var diff=0;for(var i=0;i<current.length;i++)diff+=Math.abs(current[i]-previous[i]);return diff/current.length>.31;}

  function cloneTensor(tensor,dims){var Type=tensor.data.constructor,data=new Type(tensor.data);return new ort.Tensor(tensor.type,data,dims||tensor.dims);}
  function repeatMemoryTensor(tensor,timeAxis,frames){
    var sourceDims=tensor.dims.slice(),prefix=1,suffix=1;for(var i=0;i<timeAxis;i++)prefix*=sourceDims[i];for(var j=timeAxis;j<sourceDims.length;j++)suffix*=sourceDims[j];
    var Type=tensor.data.constructor,data=new Type(prefix*frames*suffix);for(var p=0;p<prefix;p++){var sourceOffset=p*suffix,sourceEnd=sourceOffset+suffix;for(var t=0;t<frames;t++)data.set(tensor.data.subarray(sourceOffset,sourceEnd),(p*frames+t)*suffix);}
    sourceDims.splice(timeAxis,0,frames);return new ort.Tensor(tensor.type,data,sourceDims);
  }
  function updateMemoryTensor(bank,current,timeAxis,count,frames){
    var prefix=1,suffix=1;for(var i=0;i<timeAxis;i++)prefix*=current.dims[i];for(var j=timeAxis;j<current.dims.length;j++)suffix*=current.dims[j];
    var Type=bank.data.constructor,data=new Type(bank.data);for(var p=0;p<prefix;p++){var currentOffset=p*suffix,currentEnd=currentOffset+suffix;if(count<frames){for(var empty=count;empty<frames;empty++)data.set(current.data.subarray(currentOffset,currentEnd),(p*frames+empty)*suffix);}else{for(var slot=1;slot<frames-1;slot++){var oldOffset=(p*frames+slot+1)*suffix;data.set(bank.data.subarray(oldOffset,oldOffset+suffix),(p*frames+slot)*suffix);}data.set(current.data.subarray(currentOffset,currentEnd),(p*frames+frames-1)*suffix);}}
    return new ort.Tensor(bank.type,data,bank.dims.slice());
  }
  function accumulateObjectMemory(memory,current){var Type=memory.data.constructor,data=new Type(memory.data.length);for(var i=0;i<data.length;i++)data[i]=memory.data[i]+current.data[i];return new ort.Tensor(memory.type,data,memory.dims.slice());}
  function alphaFromProbability(prob,width,height){
    var plane=width*height;if(!prob||!prob.data||prob.data.length<plane*2)throw new Error(copy('MatAnyone2 返回的透明通道尺寸异常','MatAnyone2 returned an invalid alpha tensor'));
    var alpha=new Float32Array(plane),offset=prob.data.length-plane;for(var i=0;i<plane;i++)alpha[i]=Math.max(0,Math.min(1,tensorValue(prob,offset+i)));
    return new ort.Tensor('float32',alpha,[1,1,height,width]);
  }
  function containFit(sourceWidth,sourceHeight,targetWidth,targetHeight){
    var scale=Math.min(targetWidth/Math.max(1,sourceWidth),targetHeight/Math.max(1,sourceHeight)),width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
    return{x:Math.floor((targetWidth-width)/2),y:Math.floor((targetHeight-height)/2),width:width,height:height,scale:scale};
  }
  function noSubjectError(message){var error=new Error(message||copy('当前帧没有识别到可传播的主体','No propagatable subject was found in this frame'));error.code='NO_SUBJECT';return error;}
  function maskPayload(value,fallbackWidth,fallbackHeight){
    if(!value)return null;var data=value.mask||value.data||value,width=+value.width||fallbackWidth,height=+value.height||fallbackHeight;
    if(!data||typeof data.length!=='number'||data.length<width*height)return null;return{data:data,width:width,height:height};
  }
  function morphAxis(source,width,height,radius,horizontal,dilate){
    var out=new Uint8Array(source.length),span=radius*2+1,lines=horizontal?height:width,length=horizontal?width:height;
    for(var line=0;line<lines;line++){
      var count=0;
      for(var initial=0;initial<=radius;initial++){var initialIndex=horizontal?line*width+initial:initial*width+line;if(initial<length)count+=source[initialIndex]?1:0;}
      for(var position=0;position<length;position++){
        var index=horizontal?line*width+position:position*width+line;out[index]=dilate?(count>0?1:0):(count===span?1:0);
        var remove=position-radius,add=position+radius+1;if(remove>=0){var removeIndex=horizontal?line*width+remove:remove*width+line;count-=source[removeIndex]?1:0;}if(add<length){var addIndex=horizontal?line*width+add:add*width+line;count+=source[addIndex]?1:0;}
      }
    }
    return out;
  }
  function conditionBootstrapAlpha(alpha,width,height,fit){
    var binary=new Uint8Array(alpha.length);for(var i=0;i<alpha.length;i++)binary[i]=alpha[i]>=3/255?1:0;
    var radius=Math.max(2,Math.min(5,Math.round(Math.min(fit.width,fit.height)/160))),closed=morphAxis(morphAxis(binary,width,height,radius,true,true),width,height,radius,false,true);closed=morphAxis(morphAxis(closed,width,height,radius,true,false),width,height,radius,false,false);
    var out=new Float32Array(alpha.length),foreground=0,coverage=0;for(var j=0;j<out.length;j++){out[j]=closed[j]?(binary[j]?Math.max(0,Math.min(1,alpha[j])):.65):0;if(out[j]>=.5)foreground++;if(binary[j])coverage++;}
    return{data:out,foregroundRatio:foreground/out.length,sourceCoverage:coverage/out.length,radius:radius};
  }
  function bootstrapDimensions(width,height){var longest=Math.max(width,height),scale=Math.min(1,1920/Math.max(1,longest));return{width:Math.max(2,Math.round(width*scale)),height:Math.max(2,Math.round(height*scale))};}
  function makeMatImage(source,width,height,state,sourceWidth,sourceHeight){
    var canvas=state.analysisCanvas||(state.analysisCanvas=document.createElement('canvas'));canvas.width=width;canvas.height=height;
    var fit=containFit(sourceWidth,sourceHeight,width,height);state.analysisFit=fit;
    var context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#000';context.fillRect(0,0,width,height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(source,fit.x,fit.y,fit.width,fit.height);
    var pixels=context.getImageData(0,0,width,height).data,n=width*height,input=new Float32Array(n*3);for(var i=0;i<n;i++){var p=i*4;input[i]=pixels[p]/255;input[n+i]=pixels[p+1]/255;input[n*2+i]=pixels[p+2]/255;}
    return new ort.Tensor('float32',input,[1,3,height,width]);
  }
  function resizeBootstrapMask(mask,width,height,state,sourceWidth,sourceHeight,sourceLabel){
    var payload=maskPayload(mask,width,height);if(!payload)throw new Error(copy('首帧蒙版数据尺寸异常','The first-frame mask data has an invalid size'));
    var maskWidth=payload.width,maskHeight=payload.height,data=payload.data,source=state.bootstrapCanvas||(state.bootstrapCanvas=document.createElement('canvas'));source.width=maskWidth;source.height=maskHeight;
    var sourceContext=source.getContext('2d',{willReadFrequently:true}),image=sourceContext.createImageData(maskWidth,maskHeight),rgba=image.data,n=maskWidth*maskHeight;
    for(var i=0;i<n;i++){var raw=data[i],value=data instanceof Float32Array||data instanceof Float64Array?Math.round(Math.max(0,Math.min(1,raw))*255):Math.max(0,Math.min(255,raw));var p=i*4;rgba[p]=rgba[p+1]=rgba[p+2]=value;rgba[p+3]=255;}sourceContext.putImageData(image,0,0);
    var target=state.bootstrapTargetCanvas||(state.bootstrapTargetCanvas=document.createElement('canvas'));target.width=width;target.height=height;var targetContext=target.getContext('2d',{willReadFrequently:true}),fit=state.analysisFit||containFit(sourceWidth,sourceHeight,width,height);targetContext.fillStyle='#000';targetContext.fillRect(0,0,width,height);targetContext.imageSmoothingEnabled=true;targetContext.imageSmoothingQuality='high';targetContext.drawImage(source,fit.x,fit.y,fit.width,fit.height);
    var scaled=targetContext.getImageData(0,0,width,height).data,out=new Float32Array(width*height);for(var j=0;j<out.length;j++)out[j]=scaled[j*4]/255;
    var conditioned=conditionBootstrapAlpha(out,width,height,fit);if(conditioned.foregroundRatio<.0002)throw noSubjectError(copy('当前帧没有识别到可传播的主体','No propagatable subject was found in this frame'));
    state.bootstrapSource=sourceLabel||copy('首帧蒙版','first-frame mask');state.bootstrapStats={foregroundRatio:conditioned.foregroundRatio,sourceCoverage:conditioned.sourceCoverage,closingRadius:conditioned.radius};
    return new ort.Tensor('float32',conditioned.data,[1,1,height,width]);
  }
  async function createRvmBootstrapMask(source,modelId,width,height,state,onProgress,options,sourceWidth,sourceHeight){
    var fallbackState=createState(),result=null,size=bootstrapDimensions(sourceWidth,sourceHeight),model=getModel(modelId);
    try{
      result=await matte(source,modelId,fallbackState,function(progress){emit(onProgress,{model:'experimental',phase:'bootstrap',percent:100,text:progress.text||copy('正在运行高质量首帧识别','Running high-quality first-frame detection'),detail:progress.detail||progress.text});},{signal:options.signal,width:size.width,height:size.height});
      var stats=result.alphaStats||{};if(stats.max<8||(stats.foregroundRatio||0)<.0002)throw noSubjectError();
      var canvas=result.canvas,rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data,mask=new Uint8ClampedArray(canvas.width*canvas.height);for(var i=0;i<mask.length;i++)mask[i]=rgba[i*4+3];
      return resizeBootstrapMask({mask:mask,width:canvas.width,height:canvas.height},width,height,state,sourceWidth,sourceHeight,model.label);
    }finally{resetState(fallbackState);}
  }
  async function createBootstrapMask(source,width,height,state,onProgress,options,sourceWidth,sourceHeight){
    if(options.bootstrapMask)return resizeBootstrapMask(options.bootstrapMask,width,height,state,sourceWidth,sourceHeight,copy('指定蒙版','provided mask'));
    var errors=[],sawNoSubject=false;
    if(!bootstrapQualityUnavailable[state.modelProfile]){
      emit(onProgress,{model:'experimental',phase:'bootstrap',percent:100,text:copy('正在用 RVM ResNet50 校准首帧发丝与边缘','Calibrating first-frame hair and edges with RVM ResNet50')});
      try{return await createRvmBootstrapMask(source,'quality',width,height,state,onProgress,options,sourceWidth,sourceHeight);}catch(error){if(error&&error.name==='AbortError')throw error;if(error&&error.code==='NO_SUBJECT')throw error;errors.push(error);}
    }
    if(window.TYBG){
      emit(onProgress,{model:'experimental',phase:'bootstrap',percent:100,text:copy('高质量视频识别未得到主体，正在尝试图片 AI','High-quality video detection found no subject; trying image AI')});
      try{var result=await TYBG.segment(source,'quick',function(progress){emit(onProgress,{model:'experimental',phase:'bootstrap',percent:100,text:progress.text||copy('正在生成备用首帧蒙版','Generating a fallback first-frame mask'),detail:progress.text});},{signal:options.signal});return resizeBootstrapMask(result,width,height,state,sourceWidth,sourceHeight,copy('快速图片 AI','Fast image AI'));}catch(error){if(error&&error.name==='AbortError')throw error;sawNoSubject=sawNoSubject||error.code==='NO_SUBJECT';errors.push(error);}
    }
    emit(onProgress,{model:'experimental',phase:'bootstrap',percent:100,text:copy('正在用轻量 RVM 做最后一次主体识别','Running lightweight RVM as the final subject fallback')});
    try{return await createRvmBootstrapMask(source,'balanced',width,height,state,onProgress,options,sourceWidth,sourceHeight);}catch(error){if(error&&error.name==='AbortError')throw error;sawNoSubject=sawNoSubject||error.code==='NO_SUBJECT';errors.push(error);}
    if(sawNoSubject)throw noSubjectError();throw errors[0]||new Error(copy('首帧蒙版模型不可用','The first-frame mask models are unavailable'));
  }
  function renderMatAnyoneCanvas(source,alpha,analysisWidth,analysisHeight,width,height,state,outputCanvas){
    var maskCanvas=state.maskCanvas||(state.maskCanvas=document.createElement('canvas'));maskCanvas.width=analysisWidth;maskCanvas.height=analysisHeight;var maskContext=maskCanvas.getContext('2d'),maskImage=maskContext.createImageData(analysisWidth,analysisHeight),rgba=maskImage.data,alphaData=alpha.data;
    for(var i=0;i<alphaData.length;i++){var p=i*4;rgba[p]=rgba[p+1]=rgba[p+2]=255;rgba[p+3]=Math.round(Math.max(0,Math.min(1,alphaData[i]))*255);}maskContext.putImageData(maskImage,0,0);
    var canvas=outputCanvas||document.createElement('canvas');if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;var context=canvas.getContext('2d'),fit=state.analysisFit||containFit(width,height,analysisWidth,analysisHeight);context.clearRect(0,0,width,height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(source,0,0,width,height);context.globalCompositeOperation='destination-in';context.drawImage(maskCanvas,fit.x,fit.y,fit.width,fit.height,0,0,width,height);context.globalCompositeOperation='source-over';return canvas;
  }
  function matAlphaStats(alpha,probe){var data=alpha.data,min=255,max=0,sum=0,foreground=0;for(var i=0;i<data.length;i++){var value=Math.round(Math.max(0,Math.min(1,data[i]))*255);min=Math.min(min,value);max=Math.max(max,value);sum+=value;if(value>=128)foreground++;}var probeSum=0;for(var j=0;j<probe.length;j++)probeSum+=probe[j];return{min:min,max:max,mean:sum/data.length,foregroundRatio:foreground/data.length,inputLuma:probeSum/probe.length,dataType:data.constructor&&data.constructor.name,phaType:alpha.type,phaShape:alpha.dims&&alpha.dims.slice()};}
  async function initialiseMatAnyone(sessions,image,bootstrap,state,signal){
    var features=null,memory=null,refined=null,objMemoryView=null,alpha=bootstrap,ownsAlpha=false,sensory=null,complete=false;
    try{
      features=await sessions.imageKey.run({image:image});throwIfAborted(signal);
      var analysisHeight=image.dims[2],analysisWidth=image.dims[3],latentHeight=analysisHeight/16,latentWidth=analysisWidth/16;
      sensory=new ort.Tensor('float32',new Float32Array(1*1*256*latentHeight*latentWidth),[1,1,256,latentHeight,latentWidth]);
      memory=await sessions.maskMemory.run({image:image,mask:alpha,sensory:sensory,pix_feat:features.pix_feat});disposeTensor(sensory);sensory=null;throwIfAborted(signal);
      for(var round=0;round<10;round++){
        objMemoryView=new ort.Tensor(memory.obj_memory.type,memory.obj_memory.data,[1,1,1,16,257]);
        refined=await sessions.firstRefine.run({f8:features.f8,f4:features.f4,f2:features.f2,f1:features.f1,pix_feat:features.pix_feat,last_msk_value:memory.msk_value,obj_memory:objMemoryView,sensory:memory.new_sensory,last_mask:alpha});disposeTensor(objMemoryView);objMemoryView=null;throwIfAborted(signal);
        var nextAlpha=alphaFromProbability(refined.prob,analysisWidth,analysisHeight);if(ownsAlpha)disposeTensor(alpha);alpha=nextAlpha;ownsAlpha=true;
        var nextMemory=await sessions.maskMemory.run({image:image,mask:alpha,sensory:refined.new_sensory,pix_feat:features.pix_feat});throwIfAborted(signal);
        disposeMap(memory);memory=nextMemory;disposeMap(refined);refined=null;
      }
      state.mat={
        memoryKey:repeatMemoryTensor(features.key,2,5),memoryShrinkage:repeatMemoryTensor(features.shrinkage,2,5),memoryMskValue:repeatMemoryTensor(memory.msk_value,3,5),objMemory:cloneTensor(memory.obj_memory,[1,1,1,16,257]),
        sensory:cloneTensor(memory.new_sensory),lastMask:alpha,lastPixFeat:cloneTensor(features.pix_feat),lastMskValue:cloneTensor(memory.msk_value),memoryCount:1
      };
      complete=true;return alpha;
    }finally{disposeTensor(sensory);disposeTensor(objMemoryView);disposeMap(features);disposeMap(memory);disposeMap(refined);if(!complete&&ownsAlpha)disposeTensor(alpha);}
  }
  async function propagateMatAnyone(sessions,image,state,signal){
    var current=state.mat,results=null,alpha=null,newKey=null,newShrinkage=null,newMskValue=null,newObjectMemory=null,complete=false;
    try{
      results=await sessions.stepUpdate.run({image:image,memory_key:current.memoryKey,memory_shrinkage:current.memoryShrinkage,msk_value:current.memoryMskValue,obj_memory:current.objMemory,sensory:current.sensory,last_mask:current.lastMask,last_pix_feat:current.lastPixFeat,last_pred_mask:current.lastMask,last_msk_value:current.lastMskValue});throwIfAborted(signal);
      alpha=alphaFromProbability(results.prob,current.lastMask.dims[3],current.lastMask.dims[2]);
      if(state.frameIndex%5===0){
        newKey=updateMemoryTensor(current.memoryKey,results.key,2,current.memoryCount,5);newShrinkage=updateMemoryTensor(current.memoryShrinkage,results.shrinkage,2,current.memoryCount,5);newMskValue=updateMemoryTensor(current.memoryMskValue,results.new_msk_value,3,current.memoryCount,5);newObjectMemory=accumulateObjectMemory(current.objMemory,results.new_obj_memory);
        disposeTensor(current.memoryKey);disposeTensor(current.memoryShrinkage);disposeTensor(current.memoryMskValue);disposeTensor(current.objMemory);current.memoryKey=newKey;current.memoryShrinkage=newShrinkage;current.memoryMskValue=newMskValue;current.objMemory=newObjectMemory;current.memoryCount=Math.min(5,current.memoryCount+1);newKey=newShrinkage=newMskValue=newObjectMemory=null;
      }
      disposeTensor(current.sensory);disposeTensor(current.lastMask);disposeTensor(current.lastPixFeat);disposeTensor(current.lastMskValue);current.sensory=results.new_sensory;current.lastMask=alpha;current.lastPixFeat=results.pix_feat;current.lastMskValue=results.new_msk_value;
      results.new_sensory=results.pix_feat=results.new_msk_value=null;complete=true;return alpha;
    }finally{disposeTensor(newKey);disposeTensor(newShrinkage);disposeTensor(newMskValue);disposeTensor(newObjectMemory);disposeMap(results);if(!complete)disposeTensor(alpha);}
  }
  async function matteMatAnyone(source,model,state,onProgress,options,sessions){
    var signal=options.signal,width=Math.max(2,Math.round(options.width||source.width)),height=Math.max(2,Math.round(options.height||source.height)),analysisWidth=model.analysisWidth,analysisHeight=model.analysisHeight,inputCanvas=options.inputCanvas||state.inputCanvas||document.createElement('canvas');if(inputCanvas===source)inputCanvas=state.inputCanvas||document.createElement('canvas');state.inputCanvas=inputCanvas;if(inputCanvas.width!==width)inputCanvas.width=width;if(inputCanvas.height!==height)inputCanvas.height=height;
    if(state.modelProfile&&state.modelProfile!==model.id){disposeMatState(state);state.prevProbe=null;state.frameIndex=0;}state.modelProfile=model.id;
    var context=inputCanvas.getContext('2d',{willReadFrequently:true});context.clearRect(0,0,width,height);context.drawImage(source,0,0,width,height);var pixels=context.getImageData(0,0,width,height).data,probe=makeProbe(pixels,width,height),sceneCut=isSceneCut(state.prevProbe,probe);if(sceneCut){disposeMatState(state);state.bootstrapSource='';state.bootstrapStats=null;state.sceneCuts++;}state.prevProbe=probe;
    emit(onProgress,{model:model.id,phase:'prepare-frame',frameIndex:state.frameIndex,sceneCut:sceneCut,text:sceneCut?copy('检测到镜头切换，正在重新生成首帧蒙版','Scene cut detected; regenerating the first-frame mask'):copy('正在准备 MatAnyone2 视频帧','Preparing a MatAnyone2 video frame')});
    var seeded=!state.mat,image=makeMatImage(inputCanvas,analysisWidth,analysisHeight,state,width,height),alpha,noSubject=false;
    try{
      if(!state.mat){try{var bootstrap=await createBootstrapMask(inputCanvas,analysisWidth,analysisHeight,state,onProgress,options,width,height);try{emit(onProgress,{model:model.id,phase:'infer-frame',frameIndex:state.frameIndex,text:copy('正在精修首帧并建立时序记忆','Refining the first frame and building temporal memory')});alpha=await initialiseMatAnyone(sessions,image,bootstrap,state,signal);}finally{disposeTensor(bootstrap);}}catch(error){if(error&&error.code==='NO_SUBJECT')noSubject=true;else throw error;}}
      else{emit(onProgress,{model:model.id,phase:'infer-frame',frameIndex:state.frameIndex,text:copy('正在运行 MatAnyone2 时序传播','Running MatAnyone2 temporal propagation')});alpha=await propagateMatAnyone(sessions,image,state,signal);}
    }finally{disposeTensor(image);}
    if(noSubject){var emptyCanvas=options.outputCanvas||document.createElement('canvas');if(emptyCanvas.width!==width)emptyCanvas.width=width;if(emptyCanvas.height!==height)emptyCanvas.height=height;emptyCanvas.getContext('2d').clearRect(0,0,width,height);var emptyStats={min:0,max:0,mean:0,foregroundRatio:0,inputLuma:0,dataType:'Float32Array',phaType:'float32',phaShape:[1,1,analysisHeight,analysisWidth]};state.frameIndex++;state.lastAlphaStats=emptyStats;return{canvas:emptyCanvas,state:state,backend:backends[model.id],model:model.parentId||model.id,modelProfile:model.key||'',modelLabel:model.label,sceneCut:sceneCut,downsampleRatio:Math.min(state.analysisFit&&state.analysisFit.scale||1,1),alphaStats:emptyStats,bootstrapSource:''};}
    var stats=matAlphaStats(alpha,probe);if(seeded&&(stats.max<8||stats.foregroundRatio<.0002))throw new Error(copy('MatAnyone2 首帧生成了空蒙版，已停止导出以避免黑屏或白屏成品','MatAnyone2 produced an empty first-frame matte; export was stopped to avoid a blank result'));
    var canvas=renderMatAnyoneCanvas(inputCanvas,alpha,analysisWidth,analysisHeight,width,height,state,options.outputCanvas);state.frameIndex++;state.lastAlphaStats=stats;
    return{canvas:canvas,state:state,backend:backends[model.id],model:model.parentId||model.id,modelProfile:model.key||'',modelLabel:model.label,sceneCut:sceneCut,downsampleRatio:Math.min(state.analysisFit&&state.analysisFit.scale||1,1),alphaStats:stats,bootstrapSource:state.bootstrapSource,bootstrapStats:state.bootstrapStats};
  }

  async function matte(source,modelId,state,onProgress,options){
    options=options||{};var signal=options.signal;throwIfAborted(signal);var rootModel=getModel(modelId),width=options.width||source.displayWidth||source.videoWidth||source.naturalWidth||source.width,height=options.height||source.displayHeight||source.videoHeight||source.naturalHeight||source.height;
    width=Math.max(2,Math.round(width));height=Math.max(2,Math.round(height));options.width=width;options.height=height;var model=resolveModel(rootModel,options),session=await createSession(rootModel.id,onProgress,options);state=state||createState();
    if(model.kind==='matanyone2')return matteMatAnyone(source,model,state,onProgress,options,session);
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
    if(!pha.data||pha.data.length<n||!fgr.data||fgr.data.length<n*3){
      var phaShape=pha.dims&&pha.dims.join('×')||'?',fgrShape=fgr.dims&&fgr.dims.join('×')||'?';
      throw new Error(copy('视频模型输出尺寸不正确：透明通道 '+phaShape+'，前景 '+fgrShape+'，目标 '+width+'×'+height,'Unexpected video model output size: alpha '+phaShape+', foreground '+fgrShape+', target '+width+'×'+height));
    }
    var outCanvas=options.outputCanvas||document.createElement('canvas');if(outCanvas.width!==width)outCanvas.width=width;if(outCanvas.height!==height)outCanvas.height=height;var outContext=outCanvas.getContext('2d'),out=outContext.createImageData(width,height),rgba=out.data,previous=state.prevAlpha,alpha=new Uint8ClampedArray(n);
    var alphaMin=255,alphaMax=0,alphaSum=0,alphaForeground=0;
    for(var j=0;j<n;j++){
      var a=Math.max(0,Math.min(255,Math.round(tensorValue(pha,j)*255)));if(previous){var delta=Math.abs(a-previous[j]);if(delta<42)a=Math.round(a*.72+previous[j]*.28);}if(a<3)a=0;else if(a>252)a=255;alpha[j]=a;var q=j*4;
      alphaMin=Math.min(alphaMin,a);alphaMax=Math.max(alphaMax,a);alphaSum+=a;if(a>=128)alphaForeground++;
      rgba[q]=Math.max(0,Math.min(255,Math.round(tensorValue(fgr,j)*255)));rgba[q+1]=Math.max(0,Math.min(255,Math.round(tensorValue(fgr,n+j)*255)));rgba[q+2]=Math.max(0,Math.min(255,Math.round(tensorValue(fgr,n*2+j)*255)));rgba[q+3]=a;
    }
    var probeSum=0;for(var probeIndex=0;probeIndex<probe.length;probeIndex++)probeSum+=probe[probeIndex];
    var alphaStats={min:alphaMin,max:alphaMax,mean:alphaSum/n,foregroundRatio:alphaForeground/n,inputLuma:probeSum/probe.length,dataType:pha.data&&pha.data.constructor&&pha.data.constructor.name,phaType:pha.type,phaShape:pha.dims&&pha.dims.slice(),fgrType:fgr.type,fgrShape:fgr.dims&&fgr.dims.slice()};
    state.prevAlpha=alpha;state.frameIndex++;state.lastAlphaStats=alphaStats;outContext.putImageData(out,0,0);disposeTensor(fgr);disposeTensor(pha);
    Object.keys(results).forEach(function(name){if(name!=='fgr'&&name!=='pha'&&name!=='r1o'&&name!=='r2o'&&name!=='r3o'&&name!=='r4o')disposeTensor(results[name]);});
    return{canvas:outCanvas,state:state,backend:backends[model.id],model:model.id,modelLabel:model.label,sceneCut:sceneCut,downsampleRatio:ratio,alphaStats:alphaStats};
  }

  async function isCached(modelId,options){var model=resolveModel(getModel(modelId),options);if(!('caches' in window))return false;try{var cache=await caches.open(CACHE_NAME);if(model.parts){var assets=model.parts.slice();if(model.kind==='matanyone2')assets.push(MODELS.quality);var hits=await Promise.all(assets.map(function(part){return cache.match(cacheKey(part));}));return hits.every(Boolean);}return!!(await cache.match(cacheKey(model)));}catch(_e){return false;}}
  async function cachedModels(options){var result={};await Promise.all(Object.keys(MODELS).map(async function(id){result[id]=await isCached(id,options);}));return result;}
  async function removeCached(modelId){var model=getModel(modelId);if(!('caches' in window))return false;try{var cache=await caches.open(CACHE_NAME),assets=model.profiles?model.profiles.reduce(function(all,profile){return all.concat(profile.parts);},[]):model.parts||[model],deleted=await Promise.all(assets.map(function(asset){markVerified(asset,false);return cache.delete(cacheKey(asset));}));return deleted.some(Boolean);}catch(_e){return false;}}
  function capabilities(){return{secure:isSecureContext,webcodecs:typeof VideoDecoder!=='undefined'&&typeof VideoEncoder!=='undefined',webgpu:!!navigator.gpu,wasm:typeof WebAssembly!=='undefined',crossOriginIsolated:!!self.crossOriginIsolated};}

  window.TYVM={models:Object.keys(MODELS).map(function(id){return publicModel(MODELS[id]);}),getModel:function(id,options){return publicModel(options?resolveModel(getModel(id),options):getModel(id));},load:createSession,matte:matte,createState:createState,resetState:resetState,isCached:isCached,cachedModels:cachedModels,removeCached:removeCached,capabilities:capabilities,modelRelease:MODEL_RELEASE};
})();
