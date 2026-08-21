import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {StringDecoder} from 'node:string_decoder';

const PDF_LIMIT_BYTES=256*1024*1024;
const COMMAND_TIMEOUT_MS=30_000;
const READ_CHUNK_BYTES=1024*1024;

function rendererError(message,code,statusCode){
  var error=new Error(message);
  error.code=code||'chromium-renderer';
  error.statusCode=statusCode||500;
  return error;
}

export class ChromiumPdfRenderer{
  constructor(binary,options={}){
    this.binary=binary;
    this.root=!!options.root;
    this.child=null;
    this.profile='';
    this.starting=null;
    this.closed=false;
    this.sequence=0;
    this.pending=new Map();
    this.waiters=new Map();
    this.decoder=new StringDecoder('utf8');
    this.buffer='';
    this.stderr='';
  }

  async warm(){
    await this.ensureStarted();
    return true;
  }

  async ensureStarted(){
    if(this.child&&!this.closed&&this.child.exitCode===null)return;
    if(this.starting)return this.starting;
    this.starting=this.launch().finally(()=>{this.starting=null;});
    return this.starting;
  }

  async launch(){
    this.closed=false;
    this.buffer='';
    this.stderr='';
    this.decoder=new StringDecoder('utf8');
    this.profile=await mkdtemp(join(tmpdir(),'imging-chromium-profile-'));
    var args=[
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-extensions',
      '--disable-features=Translate,OptimizationHints,MediaRouter',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-sync',
      '--hide-scrollbars',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-pipe',
      `--user-data-dir=${this.profile}`
    ];
    if(this.root)args.unshift('--no-sandbox');
    var child=spawn(this.binary,args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
    this.child=child;
    child.unref();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{if(this.stderr.length<12_000)this.stderr+=chunk;});
    child.stdio[4].on('data',chunk=>this.receive(chunk));
    child.stdio[4].on('end',()=>this.receiveEnd());
    child.once('error',error=>this.fail(rendererError(`无法启动 PDF 渲染内核：${error.message}`,'chromium-start',503)));
    child.once('exit',(code,signal)=>{
      var detail=this.stderr.trim().slice(-600);
      this.fail(rendererError(`PDF 渲染内核已退出（${code??signal??'unknown'}）${detail?`：${detail}`:''}`,'chromium-exit',503));
      var profile=this.profile;
      this.profile='';
      if(profile)rm(profile,{recursive:true,force:true}).catch(()=>{});
    });
    [child.stderr,child.stdio[3],child.stdio[4]].forEach(stream=>{if(stream&&typeof stream.unref==='function')stream.unref();});
    await this.send('Browser.getVersion',{},'',COMMAND_TIMEOUT_MS);
  }

  receive(chunk){
    this.buffer+=this.decoder.write(chunk);
    for(;;){
      var boundary=this.buffer.indexOf('\0');
      if(boundary<0)return;
      var raw=this.buffer.slice(0,boundary);
      this.buffer=this.buffer.slice(boundary+1);
      if(!raw)continue;
      var message;
      try{message=JSON.parse(raw);}catch(error){this.fail(rendererError(`PDF 渲染协议返回了无效数据：${error.message}`,'chromium-protocol',500));return;}
      if(message.id){
        var pending=this.pending.get(message.id);
        if(!pending)continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if(message.error)pending.reject(rendererError(`Chromium ${pending.method} 失败：${message.error.message||message.error.code}`,'chromium-command',500));
        else pending.resolve(message.result||{});
        continue;
      }
      if(message.method)this.emitEvent(message.sessionId||'',message.method,message.params||{});
    }
  }

  receiveEnd(){
    var tail=this.decoder.end();
    if(tail)this.buffer+=tail;
  }

  emitEvent(sessionId,method,params){
    var key=sessionId+'\n'+method,list=this.waiters.get(key);
    if(!list||!list.length)return;
    this.waiters.delete(key);
    list.forEach(waiter=>{clearTimeout(waiter.timer);waiter.resolve(params);});
  }

  waitEvent(sessionId,method,timeoutMs){
    var key=sessionId+'\n'+method;
    return new Promise((resolve,reject)=>{
      var waiter={resolve,reject,timer:setTimeout(()=>{
        var list=this.waiters.get(key)||[],index=list.indexOf(waiter);
        if(index>=0)list.splice(index,1);
        if(!list.length)this.waiters.delete(key);
        reject(rendererError(`等待 Chromium ${method} 超时。`,'chromium-timeout',504));
      },timeoutMs)};
      var list=this.waiters.get(key)||[];
      list.push(waiter);
      this.waiters.set(key,list);
    });
  }

  send(method,params={},sessionId='',timeoutMs=COMMAND_TIMEOUT_MS){
    if(!this.child||this.closed||this.child.exitCode!==null)return Promise.reject(rendererError('PDF 渲染内核尚未启动。','chromium-exit',503));
    return new Promise((resolve,reject)=>{
      var id=++this.sequence;
      var entry={method,resolve,reject,timer:setTimeout(()=>{
        if(!this.pending.delete(id))return;
        reject(rendererError(`Chromium ${method} 超过安全时限。`,'chromium-timeout',504));
      },timeoutMs)};
      this.pending.set(id,entry);
      var packet=JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0';
      this.child.stdio[3].write(packet,error=>{
        if(!error||!this.pending.delete(id))return;
        clearTimeout(entry.timer);
        reject(rendererError(`无法写入 PDF 渲染内核：${error.message}`,'chromium-exit',503));
      });
    });
  }

  fail(error){
    if(this.closed)return;
    this.closed=true;
    for(var pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
    for(var list of this.waiters.values())for(var waiter of list){clearTimeout(waiter.timer);waiter.reject(error);}
    this.waiters.clear();
  }

  async renderFile(inputPath,timeoutMs){
    await this.ensureStarted();
    var browserContextId='',sessionId='',stream='';
    try{
      browserContextId=(await this.send('Target.createBrowserContext',{},'',timeoutMs)).browserContextId;
      var targetId=(await this.send('Target.createTarget',{url:'about:blank',browserContextId},'',timeoutMs)).targetId;
      sessionId=(await this.send('Target.attachToTarget',{targetId,flatten:true},'',timeoutMs)).sessionId;
      await this.send('Page.enable',{},sessionId,timeoutMs);
      var loaded=this.waitEvent(sessionId,'Page.loadEventFired',Math.min(timeoutMs,20_000));
      await Promise.all([loaded,this.send('Page.navigate',{url:pathToFileURL(inputPath).href},sessionId,timeoutMs)]);
      var settled=await this.send('Runtime.evaluate',{
        expression:`new Promise(function(resolve){
          var done=false,finish=function(){if(done)return;done=true;resolve();},afterPaint=function(){var painted=false,timer=setTimeout(function(){if(painted)return;painted=true;finish();},120);try{requestAnimationFrame(function(){requestAnimationFrame(function(){if(painted)return;painted=true;clearTimeout(timer);finish();});});}catch(_error){clearTimeout(timer);finish();}};
          var images=Array.prototype.slice.call(document.images||[]),imageTask=Promise.all(images.map(function(image){return image.complete?Promise.resolve():new Promise(function(next){image.addEventListener('load',next,{once:true});image.addEventListener('error',next,{once:true});});}));
          var fontTask=document.fonts&&document.fonts.ready?document.fonts.ready.catch(function(){}):Promise.resolve();
          Promise.all([fontTask,imageTask]).then(afterPaint,afterPaint);setTimeout(finish,12000);
        })`,
        awaitPromise:true,
        returnByValue:true
      },sessionId,Math.min(timeoutMs,15_000));
      if(settled.exceptionDetails)throw rendererError('Chromium 等待页面字体和图片时发生异常。','chromium-page',500);
      var printed=await this.send('Page.printToPDF',{
        printBackground:true,
        preferCSSPageSize:true,
        transferMode:'ReturnAsStream'
      },sessionId,timeoutMs);
      stream=printed.stream;
      if(!stream)throw rendererError('Chromium 没有返回 PDF 数据流。','chromium-command',500);
      var chunks=[],size=0;
      for(;;){
        var part=await this.send('IO.read',{handle:stream,size:READ_CHUNK_BYTES},sessionId,timeoutMs);
        var chunk=Buffer.from(part.data||'',part.base64Encoded?'base64':'utf8');
        size+=chunk.length;
        if(size>PDF_LIMIT_BYTES)throw rendererError('PDF 输出大小异常，已拒绝返回。','chromium-output',500);
        if(chunk.length)chunks.push(chunk);
        if(part.eof)break;
      }
      var pdf=Buffer.concat(chunks,size);
      if(pdf.length<8||pdf.subarray(0,5).toString('ascii')!=='%PDF-')throw rendererError('渲染内核没有返回有效 PDF。','chromium-output',500);
      return pdf;
    }finally{
      if(stream&&sessionId)await this.send('IO.close',{handle:stream},sessionId,5_000).catch(()=>{});
      if(browserContextId)await this.send('Target.disposeBrowserContext',{browserContextId},'',5_000).catch(()=>{});
    }
  }

  terminate(){
    var child=this.child;
    this.child=null;
    this.fail(rendererError('PDF 渲染内核已停止。','chromium-exit',503));
    if(child&&child.exitCode===null)child.kill('SIGTERM');
  }
}
