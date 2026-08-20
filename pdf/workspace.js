/* 图映 · PDF 压缩工作台。PDF 与其中的图片全部在本机浏览器解析、重编码和写出,不上传。 */
(function(){
  'use strict';
  // currentScript 只在脚本执行期间有效，按需加载发生在之后，所以这里先把基址存下来。
  var SCRIPT_BASE=(document.currentScript&&document.currentScript.src)||location.href;
  var $=function(id){return document.getElementById(id);},english=document.documentElement.lang==='en';
  function tr(zh,en){return english?en:zh;}
  var ui={
    view:$('pdfView'),open:$('pdfOpen'),close:$('pdfClose'),add:$('pdfAdd'),addTop:$('pdfAddTop'),file:$('pdfFile'),
    stage:$('pdfStage'),drop:$('pdfDrop'),empty:$('pdfEmpty'),frame:$('pdfFrame'),frameWrap:$('pdfFrameWrap'),
    compare:$('pdfCompare'),list:$('pdfList'),presets:$('pdfPresets'),targetToggle:$('pdfTargetOn'),
    target:$('pdfTarget'),targetRow:$('pdfTargetRow'),run:$('pdfRun'),runTop:$('pdfRunTop'),cancel:$('pdfCancel'),
    capSecure:$('pdfCapSecure'),capStream:$('pdfCapStream'),capCanvas:$('pdfCapCanvas'),capDisk:$('pdfCapDisk'),
    capHint:$('pdfCapHint'),progressTitle:$('pdfProgressTitle'),progressState:$('pdfProgressState'),
    progressText:$('pdfProgressText'),progressBar:$('pdfProgressBar'),progressPercent:$('pdfProgressPercent'),
    progressElapsed:$('pdfProgressElapsed'),progressEta:$('pdfProgressEta'),
    result:$('pdfResult'),resultTitle:$('pdfResultTitle'),resultText:$('pdfResultText'),
    resultBefore:$('pdfResultBefore'),resultAfter:$('pdfResultAfter'),resultBar:$('pdfResultBar'),
    resultSave:$('pdfResultSave'),decisions:$('pdfDecisions'),decisionHead:$('pdfDecisionHead'),
    status:$('pdfStatus'),backend:$('pdfBackend')
  };
  if(!ui.view||!ui.open)return;

  var state={open:false,files:[],active:-1,preset:'ebook',busy:false,abort:null,libPromise:null,
             previewUrl:'',previewMode:'after',startedAt:0};
  var PRESET_LABEL={
    screen:tr('屏幕 / 邮件','Screen / email'),ebook:tr('电子书 150dpi','E-book 150dpi'),
    print:tr('打印 300dpi','Print 300dpi'),lossless:tr('无损结构优化','Lossless structure')
  };

  function formatBytes(n){
    if(!isFinite(n)||n<1)return '—';
    if(n>=1073741824)return (n/1073741824).toFixed(2)+' GB';
    if(n>=1048576)return (n/1048576).toFixed(n>=104857600?1:2)+' MB';
    return Math.round(n/1024)+' KB';
  }
  function formatTime(sec){
    sec=Math.max(0,Math.round(sec||0));
    var m=Math.floor(sec/60),s=sec%60;
    return m+':'+String(s).padStart(2,'0');
  }
  function setStatus(text){ui.status.textContent=text;}
  function frame(){return new Promise(function(resolve){requestAnimationFrame(function(){resolve();});});}

  /* ---------- 能力检测 ---------- */
  function capabilities(){
    return {
      secure:isSecureContext,
      streams:typeof CompressionStream==='function'&&typeof DecompressionStream==='function',
      canvas:typeof createImageBitmap==='function',
      disk:typeof showSaveFilePicker==='function'
    };
  }
  function capText(el,ok,optional){
    el.textContent=ok?tr('支持','Ready'):(optional?tr('可降级','Fallback'):tr('不支持','Unavailable'));
    el.className=ok?'yes':'warn';
  }
  function renderCapabilities(){
    var cap=capabilities();
    capText(ui.capSecure,cap.secure,true);
    capText(ui.capStream,cap.streams);
    capText(ui.capCanvas,cap.canvas);
    capText(ui.capDisk,cap.disk,true);
    ui.capHint.textContent=cap.streams&&cap.canvas
      ? tr('结构重写与图片重编码都能在本机完成，PDF 不会上传。','Structure rewriting and image re-encoding both run locally. Nothing is uploaded.')
      : tr('当前浏览器缺少压缩流或图片解码能力，请更新浏览器后重试。','This browser lacks compression streams or image decoding. Please update it.');
  }

  /* ---------- 进度 ---------- */
  function setProgress(percent,title,text,tag){
    percent=Math.max(0,Math.min(100,+percent||0));
    ui.progressPercent.textContent=Math.round(percent)+'%';
    ui.progressBar.style.width=percent+'%';
    if(title)ui.progressTitle.textContent=title;
    if(text!==undefined)ui.progressText.textContent=text;
    if(tag)ui.progressState.textContent=tag;
    if(state.startedAt){
      var elapsed=(performance.now()-state.startedAt)/1000;
      ui.progressElapsed.textContent=formatTime(elapsed);
      ui.progressEta.textContent=percent>4?formatTime(elapsed*(100-percent)/percent):'—';
    }
  }
  function step(name,status,label){
    var el=ui.view.querySelector('[data-pdf-step="'+name+'"]');
    if(!el)return;
    el.classList.toggle('on',status==='on');
    el.classList.toggle('done',status==='done');
    var em=el.querySelector('em');
    if(em)em.textContent=label||(status==='done'?'✓':'—');
  }
  function resetSteps(){['parse','images','write','verify'].forEach(function(name){step(name,'','—');});}

  /* ---------- 文件队列 ---------- */
  function renderList(){
    if(!state.files.length){
      ui.list.innerHTML='<p class="videohint">'+tr('还没有 PDF。拖进来，或点上面的按钮选择。','No PDF yet. Drop one here or use the button above.')+'</p>';
      return;
    }
    ui.list.innerHTML=state.files.map(function(item,index){
      var badge=item.error?'<em class="bad">'+tr('失败','Failed')+'</em>'
        :item.result?'<em class="good">−'+item.saved+'%</em>'
        :item.busy?'<em>'+tr('处理中','Working')+'</em>':'<em>'+tr('待处理','Queued')+'</em>';
      return '<button type="button" class="pdfitem'+(index===state.active?' on':'')+'" data-pdf-index="'+index+'">'+
        '<b>'+escapeHTML(item.name)+'</b>'+badge+
        '<small>'+formatBytes(item.size)+(item.result?' → '+formatBytes(item.result.bytes.length):'')+
        (item.error?' · '+escapeHTML(item.error):'')+'</small></button>';
    }).join('');
  }
  function escapeHTML(text){
    return String(text).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});
  }
  function selectFile(index){
    state.active=index;
    renderList();
    renderActive();
  }

  /* ---------- 预览 ---------- */
  function revokePreview(){
    if(state.previewUrl){try{URL.revokeObjectURL(state.previewUrl);}catch(_e){}state.previewUrl='';}
  }
  function renderActive(){
    var item=state.files[state.active];
    ui.empty.hidden=!!item;
    ui.frameWrap.hidden=!item;
    ui.compare.hidden=!(item&&item.result);
    if(!item){revokePreview();ui.frame.removeAttribute('src');renderResult(null);return;}
    var showAfter=state.previewMode==='after'&&item.result,
        bytes=showAfter?item.result.bytes:item.bytes;
    revokePreview();
    state.previewUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    ui.frame.src=state.previewUrl+'#toolbar=0&navpanes=0';
    [].forEach.call(ui.compare.querySelectorAll('button'),function(button){
      button.classList.toggle('on',button.dataset.pdfPreview===(showAfter?'after':'before'));
    });
    renderResult(item);
  }
  function renderResult(item){
    if(!item||!item.result){ui.result.hidden=true;ui.decisions.innerHTML='';ui.decisionHead.hidden=true;return;}
    var result=item.result,before=item.size,after=result.bytes.length,percent=Math.max(0,100-after/before*100);
    ui.result.hidden=false;
    ui.resultTitle.textContent=result.fallback
      ? tr('已保留原文件','Original kept')
      : tr('压缩完成 · 省下 '+percent.toFixed(1)+'%','Done · '+percent.toFixed(1)+'% smaller');
    ui.resultText.textContent=result.fallback?result.reason:
      tr(result.pages+' 页 · 内嵌图 '+result.report.imagesTouched+'/'+result.report.images+' 张重编码 · 结构流 '+result.report.streamsRecompressed+' 条重压缩',
         result.pages+' pages · '+result.report.imagesTouched+'/'+result.report.images+' images re-encoded · '+result.report.streamsRecompressed+' streams recompressed');
    ui.resultBefore.textContent=formatBytes(before);
    ui.resultAfter.textContent=formatBytes(after);
    ui.resultBar.style.width=Math.max(3,after/before*100)+'%';
    ui.resultSave.hidden=false;
    renderDecisions(result);
  }
  function renderDecisions(result){
    var rows=(result.report.decisions||[]).slice().sort(function(a,b){return b.before-a.before;}).slice(0,40);
    if(!rows.length){ui.decisions.innerHTML='';ui.decisionHead.hidden=true;return;}
    ui.decisionHead.hidden=false;
    var ACTION={
      jpeg:tr('JPEG 重编码','JPEG re-encode'),palette:tr('调色板 Flate','Indexed Flate'),
      gray:tr('灰度 Flate','Gray Flate'),rgb:tr('无损 Flate','Lossless Flate'),keep:tr('保留原图','Kept')
    };
    ui.decisions.innerHTML=rows.map(function(row){
      var shrink=row.before>0?Math.max(0,100-row.after/row.before*100):0,
          detail=[row.dpi?row.dpi+' dpi':tr('未定位','Unplaced'),row.scaled||'',row.quality?'q'+row.quality:''].filter(Boolean).join(' · ');
      return '<div class="pdfdecision'+(row.action==='keep'?' keep':'')+'">'+
        '<b>'+(ACTION[row.action]||row.action)+'</b>'+
        '<span>'+formatBytes(row.before)+' → '+formatBytes(row.after)+(row.action==='keep'?'':' · −'+shrink.toFixed(0)+'%')+'</span>'+
        '<small>'+escapeHTML(detail||'')+(row.why?' · '+escapeHTML(row.why):'')+'</small></div>';
    }).join('');
  }

  /* ---------- 按需加载 PDF 引擎 ---------- */
  function ensureLibrary(){
    if(window.TYPDFCore&&window.TYPDFOptimize)return Promise.resolve(true);
    if(state.libPromise)return state.libPromise;
    if(!window.TY_PDF_LOCAL)return Promise.reject(new Error(tr('此单文件版本未携带 PDF 引擎，请使用 imging.cn 完整版。','This single-file build does not include the PDF engine. Use the full imging.cn build.')));
    function loadOne(name){
      return new Promise(function(resolve,reject){
        var script=document.createElement('script');
        script.src=new URL('../pdf/'+name+'?v=1',SCRIPT_BASE).href;
        script.async=true;
        script.onload=function(){resolve(true);};
        script.onerror=function(){reject(new Error(tr('PDF 引擎加载失败，请检查网络后重试','Could not load the PDF engine')));};
        document.head.appendChild(script);
      });
    }
    state.libPromise=loadOne('core.js').then(function(){return loadOne('optimize.js');}).catch(function(error){
      state.libPromise=null;
      throw error;
    });
    return state.libPromise;
  }

  /* ---------- 载入文件 ---------- */
  async function addFiles(fileList){
    var files=[].slice.call(fileList||[]).filter(function(file){
      return file&&(file.type==='application/pdf'||/\.pdf$/i.test(file.name));
    });
    if(!files.length){
      setProgress(0,tr('文件格式不正确','Wrong file type'),tr('请选择 PDF 文件。','Choose a PDF file.'),'ERROR');
      return;
    }
    for(var i=0;i<files.length;i++){
      var file=files[i];
      state.files.push({name:file.name,size:file.size,file:file,bytes:null,result:null,error:'',busy:false,saved:0});
    }
    renderList();
    if(state.active<0)selectFile(state.files.length-files.length);
    updateControls();
    setStatus(tr(state.files.length+' 个文件待处理 · PDF 不会上传',state.files.length+' file(s) queued · nothing is uploaded'));
    for(var k=state.files.length-files.length;k<state.files.length;k++){
      var item=state.files[k];
      if(!item.bytes)item.bytes=new Uint8Array(await item.file.arrayBuffer());
    }
    if(state.active>=0)renderActive();
  }

  /* ---------- 压缩 ---------- */
  function updateControls(){
    var has=state.files.length>0;
    ui.run.disabled=state.busy||!has;
    ui.runTop.disabled=state.busy||!has;
    ui.cancel.disabled=!state.busy;
    ui.add.disabled=state.busy;
    ui.addTop.disabled=state.busy;
    ui.targetRow.hidden=!ui.targetToggle.checked;
  }
  async function runAll(){
    if(state.busy||!state.files.length)return;
    try{ await ensureLibrary(); }
    catch(error){ setProgress(0,tr('引擎未就绪','Engine unavailable'),error.message,'ERROR'); return; }
    var cap=capabilities();
    if(!cap.streams||!cap.canvas){
      setProgress(0,tr('浏览器能力不足','Browser unsupported'),ui.capHint.textContent,'ERROR');
      return;
    }
    state.busy=true;
    state.abort=new AbortController();
    state.startedAt=performance.now();
    updateControls();
    resetSteps();
    var pending=state.files.filter(function(item){return !item.result&&!item.error;});
    if(!pending.length)pending=state.files;
    for(var i=0;i<pending.length;i++){
      var item=pending[i];
      if(state.abort.signal.aborted)break;
      item.busy=true;item.error='';renderList();
      try{
        var result=await compressOne(item,i,pending.length);
        item.result=result;
        item.saved=Math.max(0,100-result.bytes.length/item.size*100).toFixed(1);
      }catch(error){
        if(error&&error.name==='AbortError'){item.busy=false;break;}
        item.error=friendlyError(error);
      }
      item.busy=false;
      renderList();
      if(state.files[state.active]===item)renderActive();
    }
    state.busy=false;
    state.abort=null;
    updateControls();
    var done=state.files.filter(function(item){return item.result;}).length;
    step('verify','done','✓');
    setProgress(100,tr('全部完成','All done'),tr(done+' 个文件已压缩完成，可以逐个保存。',done+' file(s) compressed. Save them below.'),'DONE');
    setStatus(tr('完成 · PDF 全程留在本机','Done · everything stayed on this device'));
  }
  function friendlyError(error){
    var code=error&&error.code;
    if(code==='encrypted')return tr('这份 PDF 有加密或权限保护，需要先解除保护','This PDF is encrypted; remove protection first');
    if(code==='not-pdf')return tr('这不是 PDF 文件','Not a PDF file');
    if(code==='broken')return tr('PDF 结构已损坏，无法安全重写','The PDF structure is damaged');
    return (error&&error.message)||tr('处理失败','Failed');
  }
  async function compressOne(item,index,total){
    if(!item.bytes)item.bytes=new Uint8Array(await item.file.arrayBuffer());
    var base=index/total*100,span=100/total,signal=state.abort.signal;
    var targetBytes=ui.targetToggle.checked?Math.max(0.05,parseFloat(ui.target.value)||0)*1048576:0;
    var attempts=[{preset:state.preset,qualityDelta:0}];
    if(targetBytes){
      attempts.push({preset:state.preset,qualityDelta:-10});
      if(state.preset!=='screen')attempts.push({preset:'screen',qualityDelta:-6});
      attempts.push({preset:'screen',qualityDelta:-18});
    }
    var best=null;
    for(var a=0;a<attempts.length;a++){
      var attempt=attempts[a];
      step('parse','on',tr('解析','Parse'));
      setProgress(base+span*0.05,tr('正在解析 PDF 结构','Parsing PDF structure'),item.name,'PARSE');
      var result=await window.TYPDFOptimize.compress(item.bytes,{
        preset:attempt.preset,
        qualityDelta:attempt.qualityDelta,
        signal:signal,
        now:function(){return performance.now();},
        onPhase:async function(phase){
          if(phase==='analyse'){step('parse','done','✓');step('images','on','0%');
            setProgress(base+span*0.15,tr('正在统计内嵌图片','Analysing embedded images'),tr('按内容流实算每张图的有效 DPI','Computing effective DPI from content streams'),'SCAN');}
          if(phase==='write'){step('images','done','✓');step('write','on',tr('写出','Write'));
            setProgress(base+span*0.86,tr('正在写出紧凑 PDF','Writing compact PDF'),tr('对象流打包 + 无用对象回收','Object streams + unused object cleanup'),'WRITE');}
          await frame();
        },
        onImage:async function(done,count,image){
          var percent=count?done/count:1;
          step('images','on',Math.round(percent*100)+'%');
          setProgress(base+span*(0.15+percent*0.68),
            tr('正在重编码内嵌图片 '+(done+1)+'/'+count,'Re-encoding image '+(done+1)+'/'+count),
            image.width+'×'+image.height+' · '+formatBytes(image.bytes)+(image.dpi?' · '+image.dpi+' dpi':''),'IMAGE');
          if((done&3)===0)await frame();
        },
        onTick:frame
      });
      step('write','done','✓');
      step('verify','on',tr('校验','Verify'));
      if(!best||result.bytes.length<best.bytes.length)best=result;
      if(!targetBytes||result.bytes.length<=targetBytes||result.fallback)break;
      setProgress(base+span*0.9,tr('未达到目标体积，正在加大压缩','Target not reached, compressing harder'),
        formatBytes(result.bytes.length)+' > '+formatBytes(targetBytes),'RETRY');
    }
    return best;
  }

  /* ---------- 保存 ---------- */
  function outputName(name){
    return name.replace(/\.pdf$/i,'')+(english?'-compressed.pdf':'-已压缩.pdf');
  }
  async function saveActive(){
    var item=state.files[state.active];
    if(!item||!item.result)return;
    var blob=new Blob([item.result.bytes],{type:'application/pdf'}),name=outputName(item.name);
    if(typeof showSaveFilePicker==='function'){
      try{
        var handle=await showSaveFilePicker({suggestedName:name,types:[{description:'PDF',accept:{'application/pdf':['.pdf']}}]});
        var writable=await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus(tr('已保存 · '+name,'Saved · '+name));
        return;
      }catch(error){ if(error&&error.name==='AbortError')return; }
    }
    var url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;document.body.appendChild(link);link.click();
    document.body.removeChild(link);
    setTimeout(function(){URL.revokeObjectURL(url);},4000);
    setStatus(tr('已下载 · '+name,'Downloaded · '+name));
  }

  /* ---------- 开关 ---------- */
  function open(event){
    if(event&&(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey))return;
    if(event&&event.preventDefault){
      event.preventDefault();
      if(window.TYShortcut)window.TYShortcut.enter('pdf');
    }
    state.open=true;
    ui.view.hidden=false;
    ui.open.setAttribute('aria-expanded','true');
    document.body.style.overflow='hidden';
    renderCapabilities();
    renderList();
    ensureLibrary().catch(function(){});
    requestAnimationFrame(function(){ui.stage.focus({preventScroll:true});});
  }
  function close(){
    if(state.busy&&!confirm(tr('还在压缩中，退出会取消当前任务，是否继续？','Still compressing. Leaving will cancel it. Continue?')))return;
    if(state.abort)state.abort.abort();
    state.open=false;
    ui.view.hidden=true;
    ui.open.setAttribute('aria-expanded','false');
    document.body.style.overflow='';
    revokePreview();
    ui.frame.removeAttribute('src');
    if(window.TYShortcut)window.TYShortcut.leave('pdf');
  }

  /* ---------- 绑定 ---------- */
  ui.open.addEventListener('click',open);
  ui.close.addEventListener('click',close);
  ui.add.addEventListener('click',function(){ui.file.click();});
  ui.addTop.addEventListener('click',function(){ui.file.click();});
  ui.file.addEventListener('change',function(){addFiles(ui.file.files);ui.file.value='';});
  ui.run.addEventListener('click',runAll);
  ui.runTop.addEventListener('click',runAll);
  ui.cancel.addEventListener('click',function(){if(state.abort)state.abort.abort();});
  ui.resultSave.addEventListener('click',saveActive);
  ui.targetToggle.addEventListener('change',updateControls);
  ui.presets.addEventListener('click',function(event){
    var button=event.target.closest('[data-pdf-preset]');
    if(!button)return;
    state.preset=button.dataset.pdfPreset;
    [].forEach.call(ui.presets.querySelectorAll('button'),function(item){
      item.classList.toggle('on',item===button);
    });
    setStatus(tr('压缩档位：'+PRESET_LABEL[state.preset],'Preset: '+PRESET_LABEL[state.preset]));
  });
  ui.list.addEventListener('click',function(event){
    var button=event.target.closest('[data-pdf-index]');
    if(button)selectFile(+button.dataset.pdfIndex);
  });
  ui.compare.addEventListener('click',function(event){
    var button=event.target.closest('[data-pdf-preview]');
    if(!button)return;
    state.previewMode=button.dataset.pdfPreview;
    renderActive();
  });
  ['dragenter','dragover'].forEach(function(type){
    ui.stage.addEventListener(type,function(event){event.preventDefault();ui.drop.hidden=false;});
  });
  ['dragleave','dragend'].forEach(function(type){
    ui.stage.addEventListener(type,function(event){
      if(event.relatedTarget&&ui.stage.contains(event.relatedTarget))return;
      ui.drop.hidden=true;
    });
  });
  ui.stage.addEventListener('drop',function(event){
    event.preventDefault();
    ui.drop.hidden=true;
    addFiles(event.dataTransfer&&event.dataTransfer.files);
  });
  document.addEventListener('keydown',function(event){
    if(!state.open)return;
    if(event.key==='Escape'&&!state.busy)close();
  });
  if(window.TYShortcut&&window.TYShortcut.kind()==='pdf')open();
  updateControls();
  renderList();
})();
