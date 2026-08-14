/* 图映 · 浏览器本地 AI 抠图加载器
 * 模型和 ONNX Runtime 均由当前站点提供；原图与蒙版只在浏览器内存中处理。
 */
(function(){
  'use strict';
  var ownScript=document.currentScript;
  var BASE=new URL('./',ownScript&&ownScript.src||location.href).href;
  var CACHE_NAME='tuying-ai-model-v1'; // 保留 v1，避免已下载的快速模型在升级后重下。
  var MODELS={
    quick:{
      id:'quick',label:'快速 AI',technicalName:'ISNet INT8',
      description:'通用主体识别，下载小、速度快',sizeText:'约 42 MB',
      url:new URL('../models/background-removal/isnet-general-int8.onnx',BASE).href,
      bytes:44229662,inputSize:1024,normalize:'isnet'
    },
    professional:{
      id:'professional',label:'专业 AI',technicalName:'BEN2 FP16',
      description:'发丝、半透明材质与复杂边缘',sizeText:'约 219 MB',
      url:new URL('../models/background-removal/ben2-fp16.onnx',BASE).href,
      bytes:219121675,inputSize:1024,normalize:'imagenet'
    },
    ultimate:{
      id:'ultimate',label:'骨灰级 AI',technicalName:'BiRefNet HR-Matting FP16',
      description:'2048 高分辨率；发丝、薄纱、玻璃与半透明边缘；最稳、最接近原始效果',sizeText:'约 447 MB',
      url:new URL('../models/background-removal/birefnet-hr-matting-fp16.onnx',BASE).href,
      bytes:447261189,inputSize:2048,normalize:'imagenet'
    }
  };
  var runtimePromise=null,sessionPromises={},backends={};

  function emit(fn,data){ if(typeof fn==='function') fn(data); }
  function getModel(id){ return MODELS[id]||MODELS.quick; }
  function publicModel(model){ return {id:model.id,label:model.label,technicalName:model.technicalName,description:model.description,sizeText:model.sizeText,bytes:model.bytes,url:model.url}; }
  function listModels(){ return Object.keys(MODELS).map(function(id){return publicModel(MODELS[id]);}); }

  function loadRuntime(){
    if(window.ort) return Promise.resolve(window.ort);
    if(runtimePromise) return runtimePromise;
    runtimePromise=new Promise(function(resolve,reject){
      var s=document.createElement('script'); s.src=new URL('ort.webgpu.min.js',BASE).href; s.async=true;
      s.onload=function(){ if(!window.ort) reject(new Error('AI 运行时未正确加载')); else resolve(window.ort); };
      s.onerror=function(){ reject(new Error('无法加载本地 AI 运行时')); }; document.head.appendChild(s);
    });
    return runtimePromise;
  }

  async function responseBuffer(res,total,onProgress,model){
    if(!(res.body&&res.body.getReader)) return res.arrayBuffer();
    var reader=res.body.getReader(),loaded=0,known=total>0,newBuffer=known?new Uint8Array(total):null,parts=known?null:[];
    while(true){
      var item=await reader.read(); if(item.done) break;
      if(known){
        if(loaded+item.value.byteLength>newBuffer.byteLength){
          var grown=new Uint8Array(Math.max(loaded+item.value.byteLength,newBuffer.byteLength*2)); grown.set(newBuffer); newBuffer=grown;
        }
        newBuffer.set(item.value,loaded);
      } else parts.push(item.value);
      loaded+=item.value.byteLength;
      emit(onProgress,{model:model.id,phase:'download',loaded:loaded,total:total||model.bytes,text:'正在下载 '+model.label+'模型'});
    }
    if(known&&loaded===newBuffer.byteLength) return newBuffer.buffer;
    var merged=new Uint8Array(loaded),off=0;
    if(known) merged.set(newBuffer.subarray(0,loaded));
    else parts.forEach(function(p){merged.set(p,off);off+=p.byteLength;});
    return merged.buffer;
  }

  async function readModel(model,onProgress){
    var cache=('caches' in window)?await caches.open(CACHE_NAME):null;
    if(cache){
      var hit=await cache.match(model.url);
      if(hit){
        emit(onProgress,{model:model.id,phase:'cache',loaded:model.bytes,total:model.bytes,text:'已从浏览器缓存读取 '+model.label+'模型'});
        var cachedBuffer=await hit.arrayBuffer();
        if(cachedBuffer.byteLength>=model.bytes*.97) return cachedBuffer;
        await cache.delete(model.url);
      }
    }
    emit(onProgress,{model:model.id,phase:'download',loaded:0,total:model.bytes,text:'首次下载 '+model.label+'模型'});
    var res=await fetch(model.url,{credentials:'same-origin'}); if(!res.ok) throw new Error(model.label+'模型下载失败（HTTP '+res.status+'）');
    var total=+(res.headers.get('content-length')||model.bytes);
    // Cache Storage 直接消费响应克隆，避免为数百 MB 模型再做一份 buffer.slice 拷贝。
    var cacheWrite=cache?cache.put(model.url,res.clone()).catch(function(){return false;}):Promise.resolve(false);
    var buffer=await responseBuffer(res,total,onProgress,model);
    await cacheWrite;
    if(buffer.byteLength<model.bytes*.97){ if(cache) await cache.delete(model.url); throw new Error(model.label+' 模型文件不完整，请重试'); }
    return buffer;
  }

  async function createSession(modelId,onProgress){
    var model=getModel(modelId);
    if(sessionPromises[model.id]) return sessionPromises[model.id];
    sessionPromises[model.id]=(async function(){
      var ort=await loadRuntime();
      ort.env.logLevel='error'; ort.env.wasm.wasmPaths=BASE; ort.env.wasm.numThreads=(self.crossOriginIsolated&&navigator.hardwareConcurrency)?Math.min(4,navigator.hardwareConcurrency):1;
      var bytes=await readModel(model,onProgress),options={graphOptimizationLevel:'all',executionMode:'sequential',logSeverityLevel:3};
      emit(onProgress,{model:model.id,phase:'init',loaded:model.bytes,total:model.bytes,text:'正在初始化 '+model.label});
      if(navigator.gpu){
        try{ options.executionProviders=['webgpu']; var gpu=await ort.InferenceSession.create(bytes,options); backends[model.id]='WebGPU'; return gpu; }
        catch(e){ emit(onProgress,{model:model.id,phase:'fallback',loaded:model.bytes,total:model.bytes,text:model.label+' WebGPU 不兼容，切换 WASM'}); }
      }
      options.executionProviders=['wasm']; var wasm=await ort.InferenceSession.create(bytes,options); backends[model.id]='WASM'; return wasm;
    })().catch(function(e){ delete sessionPromises[model.id]; throw e; });
    return sessionPromises[model.id];
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
    return out;
  }

  function halfToFloat(h){
    var s=(h&0x8000)?-1:1,e=(h>>10)&31,f=h&1023;
    if(e===0) return s*Math.pow(2,-14)*(f/1024);
    if(e===31) return f?NaN:s*Infinity;
    return s*Math.pow(2,e-15)*(1+f/1024);
  }

  async function segment(source,modelId,onProgress){
    if(typeof modelId==='function'){ onProgress=modelId; modelId='quick'; }
    var model=getModel(modelId),session=await createSession(model.id,onProgress),size=model.inputSize;
    emit(onProgress,{model:model.id,phase:'prepare',loaded:model.bytes,total:model.bytes,text:model.label+'正在分析主体与背景'});
    var input=makeInput(source,model),tensor=new ort.Tensor('float32',input,[1,3,size,size]);
    var feeds={}; feeds[session.inputNames[0]]=tensor;
    var wanted=session.outputNames.indexOf('output')>=0?'output':session.outputNames[0];
    var results=await session.run(feeds,[wanted]),result=results[wanted],raw=result.data,dims=result.dims||[],mh=dims[dims.length-2]||size,mw=dims[dims.length-1]||size,count=mw*mh;
    if(raw.length<count) throw new Error(model.label+' 返回的蒙版尺寸异常');
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
    emit(onProgress,{model:model.id,phase:'done',loaded:model.bytes,total:model.bytes,text:model.label+' 抠图完成'});
    return {mask:mask,width:mw,height:mh,backend:backends[model.id],model:model.id,modelLabel:model.label};
  }

  async function isCached(modelId){ var model=getModel(modelId); if(!('caches' in window)) return false; var c=await caches.open(CACHE_NAME); return !!(await c.match(model.url)); }
  async function cachedModels(){ var out={}; await Promise.all(Object.keys(MODELS).map(async function(id){out[id]=await isCached(id);})); return out; }
  async function removeCached(modelId){ var model=getModel(modelId); if(!('caches' in window)) return false; var c=await caches.open(CACHE_NAME); return c.delete(model.url); }
  function status(modelId){ var model=getModel(modelId); return {model:model.id,sessionReady:!!sessionPromises[model.id],backend:backends[model.id]||''}; }
  window.TYBG={segment:segment,load:createSession,isCached:isCached,cachedModels:cachedModels,removeCached:removeCached,status:status,getModel:function(id){return publicModel(getModel(id));},models:listModels(),modelBytes:MODELS.quick.bytes,modelUrl:MODELS.quick.url};
})();
