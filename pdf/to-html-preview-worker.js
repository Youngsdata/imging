/* 图映 · PDF 转 HTML 渐进预览 Worker。
 * 首先交付第一页，再在同一个后台任务中完成全部页面，避免重复解析和阻塞编辑界面。
 */
(function(){
  'use strict';
  self.window=self;
  importScripts('core.js?v=1','to-html.js?v=6');
  var jobs=new Map();

  self.addEventListener('message',function(event){
    var data=event.data||{},id=data.id;
    if(data.type==='cancel'){
      var active=jobs.get(id);if(active)active.abort();
      return;
    }
    if(data.type!=='preview'||!id||!data.file)return;
    var controller=new AbortController();jobs.set(id,controller);
    (async function(){
      try{
        var bytes=new Uint8Array(await data.file.arrayBuffer());
        var locale=/^(?:en|ja|ko|de|es|pt|fr)$/.test(data.locale)?data.locale:'zh-CN',result=await self.TYPDFToHTML.convert(bytes,{locale:locale,title:String(data.title||'PDF-固定版式页面'),embedFonts:data.embedFonts!==false,signal:controller.signal,onFirstPage:function(preview){if(!controller.signal.aborted)self.postMessage({type:'preview',id:id,html:preview.html,sourcePages:preview.sourcePages});},onProgress:function(progress){if(!controller.signal.aborted)self.postMessage({type:'progress',id:id,phase:progress.phase,percent:progress.percent,text:progress.text});}});
        if(!controller.signal.aborted)self.postMessage({type:'complete',id:id,result:result});
      }catch(error){
        if(!controller.signal.aborted)self.postMessage({type:'error',id:id,name:error&&error.name||'Error',message:error&&error.message||String(error)});
      }finally{jobs.delete(id);}
    })();
  });
})();
