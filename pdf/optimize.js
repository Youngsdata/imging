/* 图映 · PDF 智能压缩策略层
 *   PDF 体积的绝大部分是内嵌图片。这里做三件 Ghostscript 不做的事:
 *   ① 逐张内嵌图按「有效 DPI」(内容流 CTM 实算)决定是否降采样,而不是一刀切;
 *   ② 逐张跑图映的内容分类器(截图 / 插画 / 图标 / 平滑照片 / 高纹理),按内容选码选质量;
 *   ③ 每张图让 JPEG、调色板 Flate、灰度 Flate、原样保留同场竞速,取真正最小的那个。
 *   另外做结构清理:私有数据、缩略图、XMP、ASCII 包装、未压缩流,以及不可达对象回收。
 *
 * 契约:window.TYPDFOptimize = {presets, setHost, analyse, apply, compress}
 * 图片编解码通过 host 注入,浏览器默认走 canvas + 图映引擎;Node 回归测试可替换。
 */
(function(){
  'use strict';
  var W=typeof window!=='undefined'?window:self;

  // threshold 沿用业界口径:只有内嵌图的有效 DPI 高出目标这个倍数才重采样。
  // Ghostscript 的 /ebook、/printer 用 1.5——小幅重采样的画质代价往往抵不过省下的体积。
  // 只有用户主动选"屏幕/邮件"这种以最小体积为目的的档位才收紧到 1.2。
  var PRESETS={
    screen:  {id:'screen',  dpi:72,  threshold:1.2, cap:1400, jpegBias:-6, palette:true,  strip:'aggressive'},
    ebook:   {id:'ebook',   dpi:150, threshold:1.5, cap:2200, jpegBias:0,  palette:true,  strip:'safe'},
    print:   {id:'print',   dpi:300, threshold:1.5, cap:3600, jpegBias:4,  palette:true,  strip:'safe'},
    lossless:{id:'lossless',dpi:0,   threshold:0,   cap:0,    jpegBias:0,  palette:false, strip:'none'}
  };

  var host=null;
  function setHost(next){host=next;}

  /* ========== 内容流扫描:算每张图在页面上的真实落地尺寸 ========== */
  function isWS(c){return c===32||c===10||c===13||c===9||c===0||c===12;}
  function isDelimByte(c){return c===40||c===41||c===60||c===62||c===91||c===93||c===123||c===125||c===47||c===37;}
  function scanContent(data,onDo){
    // 只关心 q/Q/cm/Do 与 Form 递归;字符串、数组、字典、内联图整体跳过。
    var p=0,n=data.length,ctm=[1,0,0,1,0,0],saved=[],operands=[];
    function num(text){var v=parseFloat(text);return isFinite(v)?v:0;}
    function mul(m,c){
      return [m[0]*c[0]+m[1]*c[2], m[0]*c[1]+m[1]*c[3],
              m[2]*c[0]+m[3]*c[2], m[2]*c[1]+m[3]*c[3],
              m[4]*c[0]+m[5]*c[2]+c[4], m[4]*c[1]+m[5]*c[3]+c[5]];
    }
    while(p<n){
      var c=data[p];
      if(isWS(c)){p++;continue;}
      if(c===37){while(p<n&&data[p]!==10&&data[p]!==13)p++;continue;}
      if(c===40){ // 字符串
        var depth=1;p++;
        while(p<n&&depth){var d=data[p++];if(d===92){p++;continue;}if(d===40)depth++;else if(d===41)depth--;}
        operands.push(null);continue;
      }
      if(c===60&&data[p+1]===60){ // 字典:配对计数跳过
        var dd=1;p+=2;
        while(p<n&&dd){
          if(data[p]===60&&data[p+1]===60){dd++;p+=2;continue;}
          if(data[p]===62&&data[p+1]===62){dd--;p+=2;continue;}
          p++;
        }
        operands.push(null);continue;
      }
      if(c===60){while(p<n&&data[p]!==62)p++;p++;operands.push(null);continue;}
      if(c===91||c===93){p++;continue;}
      if(c===47){ // 名字
        var start=++p;
        while(p<n&&!isWS(data[p])&&!isDelimByte(data[p]))p++;
        var name='';
        for(var k=start;k<p;k++)name+=String.fromCharCode(data[k]);
        operands.push(name);continue;
      }
      var tokenStart=p;
      while(p<n&&!isWS(data[p])&&!isDelimByte(data[p]))p++;
      if(p===tokenStart){p++;continue;}
      var token='';
      for(var j=tokenStart;j<p;j++)token+=String.fromCharCode(data[j]);
      if(/^[+-.\d]/.test(token)&&/^[+-]?[\d.]+$/.test(token)){operands.push(token);continue;}
      if(token==='q'){saved.push(ctm.slice());}
      else if(token==='Q'){if(saved.length)ctm=saved.pop();}
      else if(token==='cm'&&operands.length>=6){
        var six=operands.slice(-6).map(num);
        ctm=mul(six,ctm);
      }
      else if(token==='Do'&&operands.length){
        var target=operands[operands.length-1];
        if(typeof target==='string')onDo(target,ctm,saved.length);
      }
      else if(token==='BI'){ // 内联图:跳到 EI
        while(p<n-1&&!(data[p]===69&&data[p+1]===73&&(p+2>=n||isWS(data[p+2]))))p++;
        p+=2;
      }
      operands.length=0;
    }
  }

  async function pageContentBytes(doc,page){
    var contents=doc.resolve(page.dict.get('Contents')),list=Array.isArray(contents)?contents:[contents],parts=[],i;
    for(i=0;i<list.length;i++){
      var stm=doc.resolve(list[i]);
      if(!stm||!stm.raw)continue;
      try{
        var got=await doc.streamBytes(stm);
        if(got.filter)continue;
        parts.push(got.data);
        parts.push(new Uint8Array([10]));
      }catch(_e){ /* 单页内容流坏掉不影响其它页 */ }
    }
    return W.TYPDFCore.concat(parts);
  }

  // 遍历页面 → 记录每个图像对象在文档里出现过的最大落地尺寸(pt)
  async function measurePlacement(doc){
    var Core=W.TYPDFCore,placement=Object.create(null),pages=doc.pages(),pi;
    for(pi=0;pi<pages.length;pi++){
      var page=pages[pi],resources=doc.resolve(page.dict.has('Resources')?page.dict.get('Resources'):page.inherited.Resources);
      var content=await pageContentBytes(doc,page);
      await consume(content,resources,[1,0,0,1,0,0],0,Object.create(null));
    }
    async function consume(content,resources,baseCTM,depth,visited){
      if(depth>6||!content||!content.length)return;
      var xobjects=doc.resolve((doc.resolve(resources)||new Core.Dict()).get('XObject')),pending=[];
      if(!(xobjects instanceof Core.Dict))xobjects=new Core.Dict();
      scanContent(content,function(name,ctm){
        var ref=xobjects.get(name);
        if(!ref)return;
        pending.push({ref:ref,ctm:[
          ctm[0]*baseCTM[0]+ctm[1]*baseCTM[2], ctm[0]*baseCTM[1]+ctm[1]*baseCTM[3],
          ctm[2]*baseCTM[0]+ctm[3]*baseCTM[2], ctm[2]*baseCTM[1]+ctm[3]*baseCTM[3],
          ctm[4]*baseCTM[0]+ctm[5]*baseCTM[2]+baseCTM[4], ctm[4]*baseCTM[1]+ctm[5]*baseCTM[3]+baseCTM[5]
        ]});
      });
      for(var i=0;i<pending.length;i++){
        var item=pending[i],obj=doc.resolve(item.ref),num=item.ref&&item.ref.num;
        if(!obj||!obj.dict)continue;
        var subtype=doc.resolve(obj.dict.get('Subtype'));
        var wpt=Math.hypot(item.ctm[0],item.ctm[1]),hpt=Math.hypot(item.ctm[2],item.ctm[3]);
        if(Core.isName(subtype,'Image')){
          if(num===undefined)continue;
          var got=placement[num];
          if(!got||wpt*hpt>got.w*got.h)placement[num]={w:wpt,h:hpt};
          continue;
        }
        if(Core.isName(subtype,'Form')){
          if(num!==undefined){if(visited[num])continue;visited[num]=1;}
          var matrix=doc.resolve(obj.dict.get('Matrix')),base=item.ctm;
          if(Array.isArray(matrix)&&matrix.length===6){
            var m=matrix.map(function(v){return +doc.resolve(v)||0;});
            base=[m[0]*base[0]+m[1]*base[2], m[0]*base[1]+m[1]*base[3],
                  m[2]*base[0]+m[3]*base[2], m[2]*base[1]+m[3]*base[3],
                  m[4]*base[0]+m[5]*base[2]+base[4], m[4]*base[1]+m[5]*base[3]+base[5]];
          }
          var formRes=doc.resolve(obj.dict.get('Resources'))||resources,inner;
          try{ var g=await doc.streamBytes(obj); inner=g.filter?null:g.data; }catch(_e){ inner=null; }
          if(inner)await consume(inner,formRes,base,depth+1,visited);
          if(num!==undefined)visited[num]=0;
        }
      }
    }
    return placement;
  }

  /* ========== 内嵌图的解码 ========== */
  function colorComponents(doc,cs,depth){
    var Core=W.TYPDFCore;
    cs=doc.resolve(cs);
    depth=depth||0;
    if(depth>6)return 0;
    if(Core.isName(cs)){
      if(cs.name==='DeviceGray'||cs.name==='CalGray'||cs.name==='G')return 1;
      if(cs.name==='DeviceRGB'||cs.name==='CalRGB'||cs.name==='RGB')return 3;
      if(cs.name==='DeviceCMYK'||cs.name==='CMYK')return 4;
      if(cs.name==='Pattern')return 0;
      return 0;
    }
    if(Array.isArray(cs)&&cs.length){
      var family=doc.resolve(cs[0]);
      if(!Core.isName(family))return 0;
      if(family.name==='ICCBased'){
        var stream=doc.resolve(cs[1]);
        return stream&&stream.dict?(+doc.resolve(stream.dict.get('N'))||0):0;
      }
      if(family.name==='Indexed'||family.name==='I')return 1;
      if(family.name==='CalRGB'||family.name==='Lab')return 3;
      if(family.name==='CalGray')return 1;
      if(family.name==='DeviceN'){var names=doc.resolve(cs[1]);return Array.isArray(names)?names.length:0;}
      if(family.name==='Separation')return 1;
      if(family.name==='DeviceRGB')return 3;
      if(family.name==='DeviceGray')return 1;
      if(family.name==='DeviceCMYK')return 4;
    }
    return 0;
  }
  async function indexedPalette(doc,cs){
    var Core=W.TYPDFCore;
    cs=doc.resolve(cs);
    if(!Array.isArray(cs)||cs.length<4)return null;
    var family=doc.resolve(cs[0]);
    if(!Core.isName(family)||(family.name!=='Indexed'&&family.name!=='I'))return null;
    var base=doc.resolve(cs[1]),comps=colorComponents(doc,base,0),lookup=doc.resolve(cs[3]),bytes=null;
    if(comps!==1&&comps!==3&&comps!==4)return null;
    if(lookup&&lookup.bytes)bytes=lookup.bytes;
    else if(lookup&&lookup.raw){var got=await doc.streamBytes(lookup);if(got.filter)return null;bytes=got.data;}
    if(!bytes)return null;
    return {comps:comps,lookup:bytes};
  }
  function jpegComponents(bytes){
    var p=2;
    while(p+3<bytes.length){
      if(bytes[p]!==0xff){p++;continue;}
      var marker=bytes[p+1];
      if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7)){p+=2;continue;}
      var len=(bytes[p+2]<<8)|bytes[p+3];
      if(marker>=0xc0&&marker<=0xcf&&marker!==0xc4&&marker!==0xc8&&marker!==0xcc)
        return {comps:bytes[p+9],progressive:marker===0xc2};
      if(marker===0xda)break;
      p+=2+len;
    }
    return {comps:0,progressive:false};
  }
  function samplesToRGBA(data,width,height,comps,bpc,palette,decode){
    var out=new Uint8ClampedArray(width*height*4),rowBits=width*comps*bpc,rowBytes=Math.ceil(rowBits/8),
        max=(1<<bpc)-1,invert=false,x,y,i;
    if(Array.isArray(decode)&&decode.length>=2&&+decode[0]===1)invert=true;
    if(bpc===16){
      for(y=0;y<height;y++)for(x=0;x<width;x++){
        var base16=y*width*comps*2+x*comps*2,at16=(y*width+x)*4;
        if(comps===1){out[at16]=out[at16+1]=out[at16+2]=data[base16];}
        else if(comps===3){out[at16]=data[base16];out[at16+1]=data[base16+2];out[at16+2]=data[base16+4];}
        else return null;
        out[at16+3]=255;
      }
      return new ImageDataCtor(out,width,height);
    }
    for(y=0;y<height;y++){
      var rowStart=y*rowBytes;
      for(x=0;x<width;x++){
        var at=(y*width+x)*4,values=[],ci;
        for(ci=0;ci<comps;ci++){
          var bitPos=(x*comps+ci)*bpc,byteAt=rowStart+(bitPos>>3),value;
          if(bpc===8)value=data[byteAt];
          else{
            var shift=8-bpc-(bitPos&7);
            value=(data[byteAt]>>shift)&max;
          }
          if(value===undefined)value=0;
          values.push(value);
        }
        if(palette){
          var index=Math.min(values[0],((palette.lookup.length/palette.comps)|0)-1),at2=index*palette.comps;
          if(palette.comps===1){out[at]=out[at+1]=out[at+2]=palette.lookup[at2];}
          else if(palette.comps===3){out[at]=palette.lookup[at2];out[at+1]=palette.lookup[at2+1];out[at+2]=palette.lookup[at2+2];}
          else{
            var c=palette.lookup[at2]/255,m=palette.lookup[at2+1]/255,yy=palette.lookup[at2+2]/255,kk=palette.lookup[at2+3]/255;
            out[at]=255*(1-Math.min(1,c+kk));out[at+1]=255*(1-Math.min(1,m+kk));out[at+2]=255*(1-Math.min(1,yy+kk));
          }
        }else if(comps===1){
          var g=bpc===8?values[0]:Math.round(values[0]*255/max);
          if(invert)g=255-g;
          out[at]=out[at+1]=out[at+2]=g;
        }else if(comps===3){
          for(i=0;i<3;i++)out[at+i]=bpc===8?values[i]:Math.round(values[i]*255/max);
        }else if(comps===4){
          var cc=values[0]/max,mm=values[1]/max,yv=values[2]/max,k=values[3]/max;
          out[at]=255*(1-Math.min(1,cc+k));out[at+1]=255*(1-Math.min(1,mm+k));out[at+2]=255*(1-Math.min(1,yv+k));
        }else return null;
        out[at+3]=255;
      }
    }
    return new ImageDataCtor(out,width,height);
  }
  function ImageDataCtor(data,width,height){
    if(typeof ImageData==='function')return new ImageData(data,width,height);
    return {data:data,width:width,height:height};
  }

  /* ========== 单张内嵌图的处理 ========== */
  var SKIP_FILTERS={JPXDecode:'JPEG2000',JBIG2Decode:'JBIG2',CCITTFaxDecode:'CCITT 传真'};

  async function decodeImage(doc,stm){
    var dict=stm.dict,
        width=+doc.resolve(dict.get('Width'))||+doc.resolve(dict.get('W'))||0,
        height=+doc.resolve(dict.get('Height'))||+doc.resolve(dict.get('H'))||0,
        bpc=+doc.resolve(dict.get('BitsPerComponent'))||+doc.resolve(dict.get('BPC'))||8;
    if(!width||!height)return {skip:'尺寸缺失'};
    if(doc.resolve(dict.get('ImageMask'))===true||doc.resolve(dict.get('IM'))===true)return {skip:'蒙版位图'};
    if(width*height>40e6)return {skip:'超大位图'};
    var got=await doc.streamBytes(stm);
    if(got.filter){
      var label=SKIP_FILTERS[got.filter.name];
      if(label)return {skip:label};
      if(got.filter.name!=='DCTDecode')return {skip:got.filter.name};
      var info=jpegComponents(got.data);
      if(info.comps===4)return {skip:'CMYK JPEG'};
      var image=await host.decodeJPEG(got.data,width,height);
      if(!image)return {skip:'JPEG 解码失败'};
      return {image:image,source:'jpeg',bytes:got.data.length,width:image.width,height:image.height};
    }
    var cs=dict.has('ColorSpace')?dict.get('ColorSpace'):dict.get('CS'),
        palette=await indexedPalette(doc,cs),
        comps=palette?1:colorComponents(doc,cs,0);
    if(!comps)return {skip:'色彩空间不支持'};
    if(bpc!==1&&bpc!==2&&bpc!==4&&bpc!==8&&bpc!==16)return {skip:'位深不支持'};
    var decode=doc.resolve(dict.get('Decode'))||doc.resolve(dict.get('D')),
        rgba=samplesToRGBA(got.data,width,height,comps,bpc,palette,decode);
    if(!rgba)return {skip:'采样解码失败'};
    return {image:rgba,source:'raw',bytes:stm.raw.length,width:width,height:height,comps:comps,bpc:bpc,indexed:!!palette};
  }

  async function encodeCandidates(imageData,preset,features,opts,grayOnly){
    var out=[],quality=host.quality?host.quality('jpg',features):82;
    if(grayOnly){
      // 软蒙版:只允许无损灰度,保证仍是合法的 DeviceGray 蒙版
      var maskPixels=imageData.width*imageData.height,maskRaw=new Uint8Array(maskPixels),md=imageData.data,mi,mat;
      for(mi=0,mat=0;mi<md.length;mi+=4)maskRaw[mat++]=md[mi];
      var maskPacked=await W.TYPDFCore.deflate(maskRaw);
      if(maskPacked)out.push({kind:'gray',filter:'FlateDecode',data:maskPacked,comps:1,bpc:8});
      return out;
    }
    quality=Math.max(38,Math.min(95,quality+(preset.jpegBias||0)+(opts.qualityDelta||0)));
    if(preset.dpi){
      var jpeg=await host.encodeJPEG(imageData,quality/100);
      if(jpeg)out.push({kind:'jpeg',filter:'DCTDecode',data:jpeg,comps:3,bpc:8,quality:quality});
    }
    // 调色板 Flate:截图 / 插画 / 图标类往往比 JPEG 又小又不糊,Ghostscript 不做这条路
    var pixels=imageData.width*imageData.height,
        wantPalette=preset.palette&&pixels<=4.2e6&&host.quantize&&(!features||features.paletteFriendly!==false);
    if(wantPalette){
      var quantized=host.quantize(imageData,256,false);
      if(quantized&&quantized.indices){
        var packed=await W.TYPDFCore.deflate(quantized.indices);
        if(packed)out.push({kind:'palette',filter:'FlateDecode',data:packed,palette:quantized.palette,comps:1,bpc:8});
      }
    }
    // 灰度 / 彩色无损 Flate:线稿、纯色块与「无损结构优化」档
    var gray=host.isGray?host.isGray(imageData):false,
        raw,i,at,d=imageData.data;
    if(gray){
      raw=new Uint8Array(pixels);
      for(i=0,at=0;i<d.length;i+=4)raw[at++]=d[i];
    }else{
      raw=new Uint8Array(pixels*3);
      for(i=0,at=0;i<d.length;i+=4){raw[at++]=d[i];raw[at++]=d[i+1];raw[at++]=d[i+2];}
    }
    var flat=await W.TYPDFCore.deflate(raw);
    if(flat)out.push({kind:gray?'gray':'rgb',filter:'FlateDecode',data:flat,comps:gray?1:3,bpc:8});
    return out;
  }

  function buildImageDict(original,pick,width,height){
    var Core=W.TYPDFCore,dict=new Core.Dict();
    dict.set('Type',Core.nm('XObject'));
    dict.set('Subtype',Core.nm('Image'));
    dict.set('Width',width);
    dict.set('Height',height);
    dict.set('BitsPerComponent',pick.bpc);
    if(pick.kind==='palette'){
      var lookup=new Uint8Array(pick.palette.length*3),i;
      for(i=0;i<pick.palette.length;i++){
        lookup[i*3]=pick.palette[i][0];lookup[i*3+1]=pick.palette[i][1];lookup[i*3+2]=pick.palette[i][2];
      }
      dict.set('ColorSpace',[Core.nm('Indexed'),Core.nm('DeviceRGB'),pick.palette.length-1,new Core.PStr(lookup,true)]);
    }else{
      dict.set('ColorSpace',Core.nm(pick.comps===1?'DeviceGray':'DeviceRGB'));
    }
    dict.set('Filter',Core.nm(pick.filter));
    dict.set('Length',pick.data.length);
    ['SMask','Mask','Intent','Interpolate'].forEach(function(key){
      if(original.dict.has(key))dict.set(key,original.dict.get(key));
    });
    return dict;
  }

  /* ========== 结构清理 ========== */
  var STRIP_ALWAYS=['PieceInfo','LastModified','Thumb'],
      STRIP_SAFE=['Metadata'],
      STRIP_AGGRESSIVE=['StructTreeRoot','MarkInfo','SpiderInfo','OutputIntents','AlternatePresentations'];
  function stripStructure(doc,mode,report){
    if(mode==='none')return;
    var Core=W.TYPDFCore,seen=Object.create(null),removed=0;
    function visit(value,depth){
      if(depth>64)return;
      if(value instanceof Core.Ref){
        if(seen[value.num])return;
        seen[value.num]=1;
        visit(doc.getObj(value.num),depth+1);
        return;
      }
      if(Array.isArray(value)){value.forEach(function(item){visit(item,depth+1);});return;}
      var dict=value instanceof Core.PStream?value.dict:value;
      if(!(dict instanceof Core.Dict))return;
      var keys=STRIP_ALWAYS.concat(mode==='none'?[]:STRIP_SAFE);
      if(mode==='aggressive')keys=keys.concat(STRIP_AGGRESSIVE);
      keys.forEach(function(key){
        if(!dict.has(key))return;
        // 页面级 /Metadata 之外,单独保留数字签名相关结构
        dict.del(key);removed++;
      });
      dict.keys().forEach(function(key){visit(dict.get(key),depth+1);});
    }
    visit(doc.trailer.get('Root'),0);
    report.stripped=removed;
  }

  // 未压缩 / ASCII 包装 / LZW 的流一律重新 Flate:纯结构收益,不动任何像素
  async function recompressStreams(doc,report,onTick){
    var Core=W.TYPDFCore,seen=Object.create(null),queue=[doc.trailer.get('Root')],saved=0,touched=0,steps=0;
    while(queue.length){
      var value=queue.pop();
      if(value instanceof Core.Ref){
        if(seen[value.num])continue;
        seen[value.num]=1;
        queue.push(doc.getObj(value.num));
        continue;
      }
      if(Array.isArray(value)){for(var i=0;i<value.length;i++)queue.push(value[i]);continue;}
      var stream=value instanceof Core.PStream?value:null,dict=stream?stream.dict:value;
      if(!(dict instanceof Core.Dict))continue;
      dict.keys().forEach(function(key){queue.push(dict.get(key));});
      if(!stream)continue;
      if(Core.isName(doc.resolve(dict.get('Subtype')),'Image'))continue;
      if(Core.isName(doc.resolve(dict.get('Type')),'XRef'))continue;
      var filter=doc.resolve(dict.get('Filter'));
      if(Core.isName(filter,'FlateDecode'))continue;
      if(Array.isArray(filter)&&filter.length===1&&Core.isName(doc.resolve(filter[0]),'FlateDecode'))continue;
      var got;
      try{ got=await doc.streamBytes(stream); }catch(_e){ continue; }
      if(got.filter)continue;
      var packed=await Core.deflate(got.data);
      if(!packed||packed.length>=stream.raw.length)continue;
      saved+=stream.raw.length-packed.length;
      stream.raw=packed;
      dict.set('Filter',Core.nm('FlateDecode'));
      dict.set('Length',packed.length);
      dict.del('DecodeParms');dict.del('DP');
      touched++;
      if(onTick&&(++steps&31)===0)await onTick();
    }
    report.streamsRecompressed=touched;
    report.streamBytesSaved=saved;
  }

  /* ========== 主流程 ========== */
  async function analyse(doc,opts){
    opts=opts||{};
    var Core=W.TYPDFCore,placement=await measurePlacement(doc),images=[],seen=Object.create(null),
        queue=[doc.trailer.get('Root')],totalImageBytes=0,maskOwner=Object.create(null);
    while(queue.length){
      var value=queue.pop();
      if(value instanceof Core.Ref){
        if(seen[value.num])continue;
        seen[value.num]=1;
        var target=doc.getObj(value.num);
        if(target instanceof Core.PStream&&Core.isName(doc.resolve(target.dict.get('Subtype')),'Image')){
          var width=+doc.resolve(target.dict.get('Width'))||0,height=+doc.resolve(target.dict.get('Height'))||0,
              place=placement[value.num]||null,
              dpi=place&&place.w>0.5?Math.round(width/(place.w/72)):0;
          images.push({num:value.num,stream:target,width:width,height:height,bytes:target.raw.length,dpi:dpi,placed:place});
          totalImageBytes+=target.raw.length;
        }
        queue.push(target);
        continue;
      }
      if(Array.isArray(value)){for(var i=0;i<value.length;i++)queue.push(value[i]);continue;}
      var dict=value instanceof Core.PStream?value.dict:value;
      if(!(dict instanceof Core.Dict))continue;
      dict.keys().forEach(function(key){queue.push(dict.get(key));});
    }
    // 软蒙版必须保持 DeviceGray,否则透明通道会失效;它们不经 Do 绘制,
    // 所以有效 DPI 要继承宿主图的落地尺寸,不能落到"未定位"的像素兜底。
    images.forEach(function(item){
      ['SMask','Mask'].forEach(function(key){
        var ref=item.stream.dict.get(key);
        if(ref instanceof Core.Ref)maskOwner[ref.num]=item.num;
      });
    });
    images.forEach(function(item){
      var owner=maskOwner[item.num];
      if(owner===undefined)return;
      item.isMask=true;
      var place=placement[owner];
      if(place&&place.w>0.5){item.placed=place;item.dpi=Math.round(item.width/(place.w/72));}
    });
    images.sort(function(a,b){return b.bytes-a.bytes;});
    return {images:images,totalImageBytes:totalImageBytes,pages:doc.pages().length};
  }

  async function apply(doc,plan,opts){
    opts=opts||{};
    var Core=W.TYPDFCore,preset=PRESETS[opts.preset]||PRESETS.ebook,
        report={images:0,imagesTouched:0,imageBytesBefore:0,imageBytesAfter:0,skipped:[],decisions:[]},
        images=plan.images,i;
    for(i=0;i<images.length;i++){
      var item=images[i];
      report.images++;
      report.imageBytesBefore+=item.bytes;
      if(opts.onImage)await opts.onImage(i,images.length,item);
      if(opts.signal&&opts.signal.aborted)throw new DOMException('已取消','AbortError');
      var decision={num:item.num,before:item.bytes,after:item.bytes,dpi:item.dpi,action:'keep'};
      try{
        if(preset.dpi===0&&!opts.forceRecode){decision.action='keep';decision.why='无损档不动像素';report.decisions.push(decision);report.imageBytesAfter+=item.bytes;continue;}
        var decoded=await decodeImage(doc,item.stream);
        if(decoded.skip){
          decision.why=decoded.skip;
          report.skipped.push({num:item.num,why:decoded.skip,bytes:item.bytes});
          report.decisions.push(decision);
          report.imageBytesAfter+=item.bytes;
          continue;
        }
        var image=decoded.image,scale=1;
        // 有效 DPI 能算出来就按它降采样(与 Ghostscript 同口径);算不出来的(注释外观流、图案等)才用像素兜底
        if(preset.dpi&&item.dpi&&item.dpi>preset.dpi*(preset.threshold||1.5))scale=preset.dpi/item.dpi;
        else if(preset.cap&&!item.dpi){
          var longest=Math.max(image.width,image.height);
          if(longest>preset.cap)scale=preset.cap/longest;
        }
        var targetW=Math.max(1,Math.round(image.width*scale)),targetH=Math.max(1,Math.round(image.height*scale));
        if(scale<0.995&&host.resize)image=host.resize(image,targetW,targetH);
        var features=host.features?host.features(image):null,
            candidates=await encodeCandidates(image,preset,features,opts,!!item.isMask),
            best=null;
        for(var c=0;c<candidates.length;c++)if(!best||candidates[c].data.length<best.data.length)best=candidates[c];
        decision.tier=features&&features.tier;
        if(!best||best.data.length>=item.bytes*0.97){
          decision.why=scale<0.995?'重编码没有更小，保留原图':'原图已足够紧凑';
          report.decisions.push(decision);
          report.imageBytesAfter+=item.bytes;
          continue;
        }
        var dict=buildImageDict(item.stream,best,image.width,image.height);
        item.stream.dict=dict;
        item.stream.raw=best.data;
        decision.action=best.kind;
        decision.after=best.data.length;
        decision.scaled=scale<0.995?(targetW+'×'+targetH):'';
        decision.quality=best.quality||0;
        report.imagesTouched++;
        report.imageBytesAfter+=best.data.length;
        report.decisions.push(decision);
      }catch(error){
        if(error&&error.name==='AbortError')throw error;
        decision.why='处理异常，已保留原图';
        report.decisions.push(decision);
        report.imageBytesAfter+=item.bytes;
      }
    }
    await recompressStreams(doc,report,opts.onTick);
    stripStructure(doc,preset.strip,report);
    return report;
  }

  async function compress(bytes,opts){
    opts=opts||{};
    var Core=W.TYPDFCore,started=(opts.now||function(){return 0;})(),
        original=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),
        doc=await Core.load(original);
    var before=snapshot(doc);
    if(opts.onPhase)await opts.onPhase('analyse');
    var plan=await analyse(doc,opts);
    if(opts.onPhase)await opts.onPhase('images');
    var report=await apply(doc,plan,opts);
    if(opts.onPhase)await opts.onPhase('write');
    var out=await doc.save({dedupe:true,onProgress:opts.onWrite});
    // 保底校验:自己回读产物,页数与页面尺寸必须一致,否则退回原文件
    var verified=true,reason='';
    try{
      var check=await Core.load(out),after=snapshot(check);
      if(after.pages!==before.pages||after.boxes!==before.boxes){verified=false;reason='页面结构校验未通过';}
    }catch(error){verified=false;reason=error.message||'产物无法回读';}
    if(!verified||out.length>=original.length){
      return {
        bytes:original,original:original,verified:verified,fallback:true,
        reason:verified?'压缩后没有变小，已保留原文件':reason,
        report:report,plan:plan,pages:before.pages,elapsed:(opts.now||function(){return 0;})()-started
      };
    }
    return {
      bytes:out,original:original,verified:true,fallback:false,reason:'',
      report:report,plan:plan,pages:before.pages,recovered:doc.recovered,
      elapsed:(opts.now||function(){return 0;})()-started
    };
  }
  function snapshot(doc){
    var pages=doc.pages(),boxes=pages.map(function(page){
      var box=doc.resolve(page.dict.has('MediaBox')?page.dict.get('MediaBox'):page.inherited.MediaBox);
      if(!Array.isArray(box))return '-';
      return box.map(function(v){return Math.round((+doc.resolve(v)||0)*100)/100;}).join(',');
    }).join('|');
    return {pages:pages.length,boxes:boxes};
  }

  /* ========== 浏览器默认 host:canvas + 图映图像引擎 ========== */
  function canvasOf(width,height){
    if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);
    var canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;
  }
  function drawTo(imageData){
    var canvas=canvasOf(imageData.width,imageData.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.putImageData(imageData,0,0);
    return canvas;
  }
  var browserHost={
    decodeJPEG:async function(bytes){
      try{
        var bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'})),
            canvas=canvasOf(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0);
        if(bitmap.close)bitmap.close();
        return ctx.getImageData(0,0,canvas.width,canvas.height);
      }catch(_e){ return null; }
    },
    encodeJPEG:async function(imageData,quality){
      try{
        var canvas=drawTo(imageData),blob;
        if(canvas.convertToBlob)blob=await canvas.convertToBlob({type:'image/jpeg',quality:quality});
        else blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/jpeg',quality);});
        if(!blob||blob.type!=='image/jpeg')return null;
        return new Uint8Array(await blob.arrayBuffer());
      }catch(_e){ return null; }
    },
    resize:function(imageData,width,height){
      return (W.TY&&W.TY.lanczosResize)?W.TY.lanczosResize(imageData,width,height):imageData;
    },
    quantize:function(imageData,maxColors,dither){
      return (W.TY&&W.TY.quantize)?W.TY.quantize(imageData,maxColors,dither):null;
    },
    features:function(imageData){
      // 复用首页那套已按 SSIM + 肉眼 A/B 标定过的内容分类与质量表,避免两套口径漂移
      if(!W.TYIMGSMART||!W.TYIMGSMART.features)return null;
      try{
        var features=W.TYIMGSMART.features(drawTo(imageData),'JPEG'),tier=W.TYIMGSMART.tier(features);
        features.tier=tier;
        features.paletteFriendly=tier==='sharp';
        return features;
      }catch(_e){ return null; }
    },
    quality:function(id,features){
      if(W.TYIMGSMART&&W.TYIMGSMART.quality)return W.TYIMGSMART.quality(id,features);
      return 82;
    },
    isGray:function(imageData){
      var d=imageData.data,step=Math.max(4,(d.length/4/20000|0)*4),i;
      for(i=0;i<d.length;i+=step){
        if(Math.abs(d[i]-d[i+1])>6||Math.abs(d[i+1]-d[i+2])>6)return false;
      }
      return true;
    }
  };
  if(typeof document!=='undefined'||typeof OffscreenCanvas==='function')host=browserHost;

  W.TYPDFOptimize={presets:PRESETS,setHost:setHost,analyse:analyse,apply:apply,compress:compress,scanContent:scanContent};
})();
