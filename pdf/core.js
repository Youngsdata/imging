/* 图映 · PDF 结构引擎(自研,零第三方依赖)
 *   解析(xref 表 / xref 流 / 对象流 / 损坏恢复) → 可达性回收 → 逐对象重写(对象流 + xref 流)
 *   inflate 优先用浏览器原生 DecompressionStream;原生对残缺流报错时回退到自带的容错实现。
 *   PDF 字节与内嵌图片全程留在本机浏览器,不上传。
 *
 * 契约:window.TYPDFCore = {
 *   load(bytes)          → Promise<Doc>          解析文档(加密文档抛 code='encrypted')
 *   Doc.getObj(num)      → 对象(惰性解析并缓存)
 *   Doc.resolve(v)       → 解引用
 *   Doc.streamBytes(stm) → Promise<{data,filter,parms}>  解到图像滤镜为止
 *   Doc.save(opts)       → Promise<Uint8Array>   重写为紧凑 PDF
 *   Name/Ref/PStream/Dict/nm/isName ...          对象模型
 * }
 */
(function(){
  'use strict';
  var W=typeof window!=='undefined'?window:self;

  /* ========== 字节工具 ========== */
  function isWS(c){return c===32||c===10||c===13||c===9||c===0||c===12;}
  function isDelim(c){return c===40||c===41||c===60||c===62||c===91||c===93||c===123||c===125||c===47||c===37;}
  function isReg(c){return c!==undefined&&!isWS(c)&&!isDelim(c);}
  function isDigit(c){return c>=48&&c<=57;}
  function s2b(s){var out=new Uint8Array(s.length);for(var i=0;i<s.length;i++)out[i]=s.charCodeAt(i)&255;return out;}
  function b2s(b,from,to){var s='',i;from=from||0;to=to===undefined?b.length:to;for(i=from;i<to;i++)s+=String.fromCharCode(b[i]);return s;}
  function indexOfBytes(buf,needle,from){
    var n=needle.length,limit=buf.length-n,i,j;
    for(i=Math.max(0,from|0);i<=limit;i++){for(j=0;j<n&&buf[i+j]===needle[j];j++);if(j===n)return i;}
    return -1;
  }
  function lastIndexOfBytes(buf,needle,from){
    var n=needle.length,i,j;
    for(i=Math.min(from===undefined?buf.length-n:from,buf.length-n);i>=0;i--){for(j=0;j<n&&buf[i+j]===needle[j];j++);if(j===n)return i;}
    return -1;
  }
  function concat(list){
    var total=0,i,out,at=0;
    for(i=0;i<list.length;i++)total+=list[i].length;
    out=new Uint8Array(total);
    for(i=0;i<list.length;i++){out.set(list[i],at);at+=list[i].length;}
    return out;
  }
  function hashBytes(b){ // FNV-1a 32,用于内容相同的对象去重
    var h=0x811c9dc5,i;
    for(i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,0x01000193);}
    return (h>>>0).toString(36)+'-'+b.length;
  }

  /* ========== 对象模型 ========== */
  function Name(n){this.name=n;}
  var NAME_CACHE=Object.create(null);
  function nm(n){return NAME_CACHE[n]||(NAME_CACHE[n]=new Name(n));}
  function isName(v,n){return v instanceof Name&&(n===undefined||v.name===n);}
  function Ref(num,gen){this.num=num;this.gen=gen||0;}
  function PStr(bytes,hex){this.bytes=bytes;this.hex=!!hex;}
  function Dict(map){this.map=map||Object.create(null);}
  Dict.prototype.get=function(k){return this.map[k];};
  Dict.prototype.set=function(k,v){this.map[k]=v;return this;};
  Dict.prototype.has=function(k){return Object.prototype.hasOwnProperty.call(this.map,k);};
  Dict.prototype.del=function(k){delete this.map[k];};
  Dict.prototype.keys=function(){return Object.keys(this.map);};
  function PStream(dict,raw){this.dict=dict;this.raw=raw;}

  /* ========== inflate:原生优先,失败回退容错实现 ========== */
  async function nativeInflate(bytes,raw){
    var format=raw?'deflate-raw':'deflate',stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // 容错 DEFLATE(puff 风格规范霍夫曼)。原生解压对被截断/尾部有垃圾的流会整体报错,
  // 这里能把已经解出来的部分交回去 —— 真实世界的 PDF 常有这种残缺流。
  var LEN_BASE=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],
      LEN_EXTRA=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],
      DIST_BASE=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],
      DIST_EXTRA=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],
      CLEN_ORDER=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
  function Huff(lengths){
    var MAX=15,i,len,offs=new Int32Array(MAX+2);
    this.count=new Int32Array(MAX+1);
    for(i=0;i<lengths.length;i++)this.count[lengths[i]]++;
    this.count[0]=0;
    for(len=1;len<=MAX;len++)offs[len+1]=offs[len]+this.count[len];
    this.symbol=new Int32Array(lengths.length);
    for(i=0;i<lengths.length;i++)if(lengths[i])this.symbol[offs[lengths[i]]++]=i;
  }
  function BitIn(src,pos){this.s=src;this.p=pos|0;this.bit=0;this.val=0;}
  BitIn.prototype.bits=function(need){
    var val=this.val,cnt=this.bit;
    while(cnt<need){
      if(this.p>=this.s.length)throw new RangeError('deflate:数据提前结束');
      val|=this.s[this.p++]<<cnt;cnt+=8;
    }
    this.val=val>>>need;this.bit=cnt-need;
    return val&((1<<need)-1);
  };
  BitIn.prototype.sym=function(h){
    var code=0,first=0,index=0,len,count;
    for(len=1;len<=15;len++){
      code|=this.bits(1);count=h.count[len];
      if(code-first<count)return h.symbol[index+(code-first)];
      index+=count;first=(first+count)<<1;code<<=1;
    }
    throw new RangeError('deflate:霍夫曼码无效');
  };
  function jsInflate(src,start){
    var st=new BitIn(src,start||0),out=new Uint8Array(Math.max(1024,src.length*4)),at=0,fixedLit=null,fixedDist=null;
    function push(byte){
      if(at>=out.length){var bigger=new Uint8Array(out.length*2);bigger.set(out);out=bigger;}
      out[at++]=byte;
    }
    try{
      for(;;){
        var last=st.bits(1),type=st.bits(2),lit,dist,i;
        if(type===0){
          st.bit=0;st.val=0;
          if(st.p+4>src.length)break;
          var len=src[st.p]|(src[st.p+1]<<8);st.p+=4;
          for(i=0;i<len&&st.p<src.length;i++)push(src[st.p++]);
        }else if(type===3){
          break;
        }else{
          if(type===1){
            if(!fixedLit){
              var ll=new Uint8Array(288),dl=new Uint8Array(30);
              for(i=0;i<144;i++)ll[i]=8;for(;i<256;i++)ll[i]=9;for(;i<280;i++)ll[i]=7;for(;i<288;i++)ll[i]=8;
              for(i=0;i<30;i++)dl[i]=5;
              fixedLit=new Huff(ll);fixedDist=new Huff(dl);
            }
            lit=fixedLit;dist=fixedDist;
          }else{
            var nlen=st.bits(5)+257,ndist=st.bits(5)+1,ncode=st.bits(4)+4,clens=new Uint8Array(19);
            for(i=0;i<ncode;i++)clens[CLEN_ORDER[i]]=st.bits(3);
            var clHuff=new Huff(clens),lens=new Uint8Array(nlen+ndist),n=0;
            while(n<nlen+ndist){
              var sym=st.sym(clHuff),repeat,value=0;
              if(sym<16){lens[n++]=sym;continue;}
              if(sym===16){value=n?lens[n-1]:0;repeat=3+st.bits(2);}
              else if(sym===17){repeat=3+st.bits(3);}
              else{repeat=11+st.bits(7);}
              while(repeat-->0&&n<lens.length)lens[n++]=value;
            }
            lit=new Huff(lens.subarray(0,nlen));dist=new Huff(lens.subarray(nlen));
          }
          for(;;){
            var symbol=st.sym(lit);
            if(symbol<256){push(symbol);continue;}
            if(symbol===256)break;
            symbol-=257;
            if(symbol>=29)throw new RangeError('deflate:长度码无效');
            var length=LEN_BASE[symbol]+st.bits(LEN_EXTRA[symbol]),dsym=st.sym(dist);
            if(dsym>=30)throw new RangeError('deflate:距离码无效');
            var distance=DIST_BASE[dsym]+st.bits(DIST_EXTRA[dsym]);
            if(distance>at)throw new RangeError('deflate:回溯越界');
            for(i=0;i<length;i++)push(out[at-distance]);
          }
        }
        if(last)break;
      }
    }catch(_e){ /* 残缺流:保留已解出的部分,交给上层判断是否可用 */ }
    return out.subarray(0,at);
  }
  async function inflate(bytes){
    var zlib=bytes.length>1&&(bytes[0]&0x0f)===8&&((bytes[0]<<8|bytes[1])%31===0);
    try{
      if(typeof DecompressionStream==='function')return await nativeInflate(bytes,!zlib);
    }catch(_e){ /* 落到容错实现 */ }
    var out=jsInflate(bytes,zlib?2:0);
    if(!out.length&&zlib)out=jsInflate(bytes,0);
    return out;
  }
  async function deflate(bytes){
    if(typeof CompressionStream!=='function')return null;
    var stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ========== 其余 PDF 滤镜 ========== */
  function lzwDecode(src,early){
    var out=[],dict=[],i,bitBuf=0,bitLen=0,codeLen=9,next=258,prev=-1,pos=0;
    function reset(){dict.length=0;for(i=0;i<256;i++)dict[i]=[i];codeLen=9;next=258;prev=-1;}
    reset();
    early=early===0?0:1;
    while(pos<src.length||bitLen>=codeLen){
      while(bitLen<codeLen&&pos<src.length){bitBuf=(bitBuf<<8)|src[pos++];bitLen+=8;}
      if(bitLen<codeLen)break;
      var code=(bitBuf>>(bitLen-codeLen))&((1<<codeLen)-1);bitLen-=codeLen;
      if(code===256){reset();continue;}
      if(code===257)break;
      var entry;
      if(dict[code])entry=dict[code];
      else if(prev>=0&&dict[prev])entry=dict[prev].concat([dict[prev][0]]);
      else break;
      for(i=0;i<entry.length;i++)out.push(entry[i]);
      if(prev>=0){dict[next++]=dict[prev].concat([entry[0]]);}
      prev=code;
      if(next+early>=(1<<codeLen)&&codeLen<12)codeLen++;
    }
    return new Uint8Array(out);
  }
  function ascii85Decode(src){
    var out=[],tuple=0,count=0,i=0,c;
    if(src[0]===60&&src[1]===126)i=2;
    for(;i<src.length;i++){
      c=src[i];
      if(isWS(c))continue;
      if(c===126)break;
      if(c===122&&count===0){out.push(0,0,0,0);continue;}
      if(c<33||c>117)continue;
      tuple=tuple*85+(c-33);count++;
      if(count===5){out.push((tuple>>>24)&255,(tuple>>>16)&255,(tuple>>>8)&255,tuple&255);tuple=0;count=0;}
    }
    if(count>0){
      for(i=count;i<5;i++)tuple=tuple*85+84;
      for(i=0;i<count-1;i++)out.push((tuple>>>(24-i*8))&255);
    }
    return new Uint8Array(out);
  }
  function asciiHexDecode(src){
    var out=[],hi=-1,i,c,v;
    for(i=0;i<src.length;i++){
      c=src[i];
      if(c===62)break;
      if(c>=48&&c<=57)v=c-48;else if(c>=97&&c<=102)v=c-87;else if(c>=65&&c<=70)v=c-55;else continue;
      if(hi<0)hi=v;else{out.push((hi<<4)|v);hi=-1;}
    }
    if(hi>=0)out.push(hi<<4);
    return new Uint8Array(out);
  }
  function runLengthDecode(src){
    var out=[],i=0,len,j;
    while(i<src.length){
      len=src[i++];
      if(len===128)break;
      if(len<128){for(j=0;j<=len&&i<src.length;j++)out.push(src[i++]);}
      else{var b=src[i++];for(j=0;j<257-len;j++)out.push(b);}
    }
    return new Uint8Array(out);
  }
  // PNG(10-15)与 TIFF(2)预测器还原;xref 流和大量 Flate 图像都用它
  function unpredict(data,parms,resolve){
    if(!parms)return data;
    var predictor=+resolve(parms.get('Predictor'))||1;
    if(predictor<2)return data;
    var colors=+resolve(parms.get('Colors'))||1,
        bpc=+resolve(parms.get('BitsPerComponent'))||8,
        columns=+resolve(parms.get('Columns'))||1,
        bpp=Math.ceil(colors*bpc/8),
        rowLen=Math.ceil(colors*bpc*columns/8),i,j;
    if(predictor===2){
      if(bpc!==8)return data;
      for(i=0;i+rowLen<=data.length;i+=rowLen)
        for(j=bpp;j<rowLen;j++)data[i+j]=(data[i+j]+data[i+j-bpp])&255;
      return data;
    }
    var rows=Math.floor(data.length/(rowLen+1)),out=new Uint8Array(rows*rowLen),prev=new Uint8Array(rowLen);
    for(i=0;i<rows;i++){
      var tag=data[i*(rowLen+1)],src=i*(rowLen+1)+1,dst=i*rowLen;
      for(j=0;j<rowLen;j++){
        var raw=data[src+j],left=j>=bpp?out[dst+j-bpp]:0,up=prev[j],upLeft=j>=bpp?prev[j-bpp]:0,value;
        switch(tag){
          case 0:value=raw;break;
          case 1:value=raw+left;break;
          case 2:value=raw+up;break;
          case 3:value=raw+((left+up)>>1);break;
          case 4:
            var p=left+up-upLeft,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-upLeft);
            value=raw+((pa<=pb&&pa<=pc)?left:(pb<=pc?up:upLeft));break;
          default:value=raw;
        }
        out[dst+j]=value&255;
      }
      prev=out.subarray(dst,dst+rowLen);
    }
    return out;
  }
  var IMAGE_FILTERS={DCTDecode:1,JPXDecode:1,JBIG2Decode:1,CCITTFaxDecode:1};

  /* ========== 词法与语法 ========== */
  function Lex(buf,doc,pos){this.b=buf;this.doc=doc;this.p=pos|0;}
  Lex.prototype.ws=function(){
    var b=this.b;
    for(;;){
      while(this.p<b.length&&isWS(b[this.p]))this.p++;
      if(b[this.p]===37){while(this.p<b.length&&b[this.p]!==10&&b[this.p]!==13)this.p++;continue;}
      return;
    }
  };
  Lex.prototype.token=function(){
    var b=this.b,start=this.p;
    while(this.p<b.length&&isReg(b[this.p]))this.p++;
    return b2s(b,start,this.p);
  };
  Lex.prototype.name=function(){
    var b=this.b,out='';
    this.p++;
    while(this.p<b.length&&isReg(b[this.p])){
      var c=b[this.p++];
      if(c===35&&this.p+1<b.length){
        var hex=parseInt(b2s(b,this.p,this.p+2),16);
        if(!isNaN(hex)){out+=String.fromCharCode(hex);this.p+=2;continue;}
      }
      out+=String.fromCharCode(c);
    }
    return nm(out);
  };
  Lex.prototype.literalString=function(){
    var b=this.b,depth=1,out=[];
    this.p++;
    while(this.p<b.length){
      var c=b[this.p++];
      if(c===92){
        var e=b[this.p++];
        if(e===110)out.push(10);
        else if(e===114)out.push(13);
        else if(e===116)out.push(9);
        else if(e===98)out.push(8);
        else if(e===102)out.push(12);
        else if(e>=48&&e<=55){
          var oct=e-48,k=0;
          while(k<2&&b[this.p]>=48&&b[this.p]<=55){oct=oct*8+(b[this.p++]-48);k++;}
          out.push(oct&255);
        }
        else if(e===10)continue;
        else if(e===13){if(b[this.p]===10)this.p++;continue;}
        else out.push(e);
        continue;
      }
      if(c===40){depth++;out.push(c);continue;}
      if(c===41){depth--;if(!depth)break;out.push(c);continue;}
      out.push(c);
    }
    return new PStr(new Uint8Array(out),false);
  };
  Lex.prototype.hexString=function(){
    var b=this.b,out=[],hi=-1;
    this.p++;
    while(this.p<b.length){
      var c=b[this.p++],v;
      if(c===62)break;
      if(c>=48&&c<=57)v=c-48;else if(c>=97&&c<=102)v=c-87;else if(c>=65&&c<=70)v=c-55;else continue;
      if(hi<0)hi=v;else{out.push((hi<<4)|v);hi=-1;}
    }
    if(hi>=0)out.push(hi<<4);
    return new PStr(new Uint8Array(out),true);
  };
  Lex.prototype.obj=function(depth){
    depth=depth||0;
    if(depth>96)return null;
    this.ws();
    var b=this.b,c=b[this.p];
    if(c===undefined)return null;
    if(c===47)return this.name();
    if(c===40)return this.literalString();
    if(c===60){
      if(b[this.p+1]===60)return this.dict(depth+1);
      return this.hexString();
    }
    if(c===91){
      var arr=[];
      this.p++;
      for(;;){
        this.ws();
        if(this.b[this.p]===93){this.p++;break;}
        if(this.p>=b.length)break;
        var before=this.p,item=this.obj(depth+1);
        if(this.p===before){this.p++;continue;}
        arr.push(item);
      }
      return arr;
    }
    if(c===93||c===62||c===41||c===125){this.p++;return null;}
    if(isDigit(c)||c===43||c===45||c===46){
      var save=this.p,tok=this.token(),num=parseFloat(tok);
      if(!isNaN(num)&&/^[+-]?\d+$/.test(tok)&&num>=0){
        var after=this.p;
        this.ws();
        var gen=this.token();
        if(/^\d+$/.test(gen)){
          this.ws();
          var kw=this.p,r=this.token();
          if(r==='R')return new Ref(num,+gen);
          this.p=kw;
        }
        this.p=after;
      }
      if(isNaN(num)){this.p=save+1;return null;}
      return num;
    }
    var word=this.token();
    if(word==='true')return true;
    if(word==='false')return false;
    if(word==='null')return null;
    if(!word.length){this.p++;return null;}
    return nm(word); // 未知关键字:当作名字保底,避免整段解析崩掉
  };
  Lex.prototype.dict=function(depth){
    var b=this.b,map=Object.create(null);
    this.p+=2;
    for(;;){
      this.ws();
      if(b[this.p]===62&&b[this.p+1]===62){this.p+=2;break;}
      if(this.p>=b.length)break;
      if(b[this.p]!==47){var before=this.p;this.obj(depth+1);if(this.p===before)this.p++;continue;}
      var key=this.name().name,value=this.obj(depth+1);
      map[key]=value;
    }
    var dict=new Dict(map);
    // 字典后紧跟 stream 关键字 → 流对象
    var mark=this.p;
    this.ws();
    if(b2s(b,this.p,this.p+6)==='stream'){
      this.p+=6;
      if(b[this.p]===13)this.p++;
      if(b[this.p]===10)this.p++;
      return this.stream(dict);
    }
    this.p=mark;
    return dict;
  };
  Lex.prototype.stream=function(dict){
    var b=this.b,start=this.p,doc=this.doc,length=dict.get('Length'),end=-1;
    if(length instanceof Ref&&doc)length=doc.resolve(length);
    if(typeof length==='number'&&length>=0&&start+length<=b.length){
      var probe=new Lex(b,doc,start+length);
      probe.ws();
      if(b2s(b,probe.p,probe.p+9)==='endstream')end=start+length;
    }
    if(end<0){
      end=indexOfBytes(b,ENDSTREAM,start);
      if(end<0)end=b.length;
      else{
        if(b[end-1]===10)end--;
        if(b[end-1]===13)end--;
      }
    }
    var raw=b.subarray(start,Math.max(start,end));
    this.p=Math.min(b.length,end);
    var tail=indexOfBytes(b,ENDSTREAM,this.p);
    this.p=tail<0?b.length:tail+9;
    return new PStream(dict,raw);
  };
  var ENDSTREAM=s2b('endstream'),OBJ_KW=s2b(' obj'),STARTXREF=s2b('startxref'),TRAILER_KW=s2b('trailer');

  /* ========== 文档 ========== */
  function Doc(bytes){
    this.bytes=bytes;
    this.xref=Object.create(null);   // num → {offset} | {stm,idx}
    this.cache=Object.create(null);
    this.trailer=new Dict();
    this.version='1.7';
    this.objStmCache=Object.create(null);
    this.warnings=[];
    this.recovered=false;
  }
  Doc.prototype.resolve=function(v){
    var guard=0;
    while(v instanceof Ref&&guard++<64)v=this.getObj(v.num,v.gen);
    return v;
  };
  Doc.prototype.getObj=function(num){
    if(Object.prototype.hasOwnProperty.call(this.cache,num))return this.cache[num];
    this.cache[num]=null; // 先占位,挡住 /Length 自引用之类的循环
    var entry=this.xref[num],value=null;
    if(entry&&entry.offset!==undefined)value=this.parseAt(entry.offset,num);
    else if(entry&&entry.stm!==undefined)value=this.fromObjStm(entry.stm,entry.idx,num);
    this.cache[num]=value;
    return value;
  };
  Doc.prototype.parseAt=function(offset,expectNum){
    var b=this.bytes;
    if(!(offset>=0&&offset<b.length))return null;
    var lex=new Lex(b,this,offset);
    lex.ws();
    var num=lex.token();
    lex.ws();
    var gen=lex.token();
    lex.ws();
    var kw=lex.token();
    if(kw!=='obj'||!/^\d+$/.test(num)){
      // 偏移不准:在附近重新定位 "num 0 obj"
      var want=s2b('\n'+expectNum+' '),at=indexOfBytes(b,want,Math.max(0,offset-2048));
      if(at<0)return null;
      lex=new Lex(b,this,at+1);
      lex.ws();lex.token();lex.ws();lex.token();lex.ws();
      if(lex.token()!=='obj')return null;
    }else if(expectNum!==undefined&&+num!==expectNum){
      return null;
    }
    void gen;
    return lex.obj();
  };
  Doc.prototype.fromObjStm=function(stmNum,idx,wantNum){
    var pack=this.objStmCache[stmNum];
    if(!pack)return null;
    var entry=pack[idx];
    if(!entry||(wantNum!==undefined&&entry.num!==wantNum)){
      for(var i=0;i<pack.length;i++)if(pack[i].num===wantNum){entry=pack[i];break;}
    }
    if(!entry)return null;
    var lex=new Lex(pack.data,this,entry.offset);
    return lex.obj();
  };
  Doc.prototype.streamBytes=async function(stm){
    if(!(stm instanceof PStream))return {data:new Uint8Array(0),filter:null,parms:null};
    var self=this,data=stm.raw,filters=this.resolve(stm.dict.get('Filter')),parms=this.resolve(stm.dict.get('DecodeParms'))||this.resolve(stm.dict.get('DP'));
    if(!filters)return {data:data,filter:null,parms:null};
    if(!Array.isArray(filters))filters=[filters];
    if(!Array.isArray(parms))parms=[parms];
    for(var i=0;i<filters.length;i++){
      var f=this.resolve(filters[i]),parm=this.resolve(parms[i])||null;
      if(!isName(f))continue;
      if(IMAGE_FILTERS[f.name])return {data:data,filter:f,parms:parm};
      if(f.name==='FlateDecode'||f.name==='Fl'){
        data=await inflate(data);
        data=unpredict(data,parm,function(v){return self.resolve(v);});
      }else if(f.name==='LZWDecode'||f.name==='LZW'){
        data=lzwDecode(data,parm?+this.resolve(parm.get('EarlyChange')):1);
        data=unpredict(data,parm,function(v){return self.resolve(v);});
      }else if(f.name==='ASCII85Decode'||f.name==='A85')data=ascii85Decode(data);
      else if(f.name==='ASCIIHexDecode'||f.name==='AHx')data=asciiHexDecode(data);
      else if(f.name==='RunLengthDecode'||f.name==='RL')data=runLengthDecode(data);
      else return {data:data,filter:f,parms:parm};
    }
    return {data:data,filter:null,parms:null};
  };

  /* ---------- xref ---------- */
  async function readXrefChain(doc){
    var b=doc.bytes,at=lastIndexOfBytes(b,STARTXREF,b.length-9);
    if(at<0)return false;
    var lex=new Lex(b,doc,at+9);
    lex.ws();
    var start=parseInt(lex.token(),10);
    if(!(start>=0))return false;
    var seen=Object.create(null),queue=[start],ok=false;
    while(queue.length){
      var offset=queue.shift();
      if(!(offset>=0&&offset<b.length)||seen[offset])continue;
      seen[offset]=1;
      var trailer=await readXrefSection(doc,offset);
      if(!trailer)continue;
      ok=true;
      // 先到者(更新的 xref 段)优先,旧段只补缺失的键
      trailer.keys().forEach(function(key){if(!doc.trailer.has(key))doc.trailer.set(key,trailer.get(key));});
      var prev=trailer.get('Prev'),hybrid=trailer.get('XRefStm');
      if(typeof hybrid==='number')queue.push(hybrid);
      if(typeof prev==='number')queue.push(prev);
    }
    return ok;
  }
  async function readXrefSection(doc,offset){
    var b=doc.bytes,lex=new Lex(b,doc,offset);
    lex.ws();
    if(b2s(b,lex.p,lex.p+4)==='xref'){
      lex.p+=4;
      for(;;){
        lex.ws();
        if(b2s(b,lex.p,lex.p+7)==='trailer'){
          lex.p+=7;
          var trailer=lex.obj();
          return trailer instanceof Dict?trailer:new Dict();
        }
        var first=lex.token();
        if(!/^\d+$/.test(first))return new Dict();
        lex.ws();
        var count=parseInt(lex.token(),10);
        if(!(count>=0))return new Dict();
        first=parseInt(first,10);
        for(var i=0;i<count;i++){
          lex.ws();
          var off=lex.token();lex.ws();
          var gen=lex.token();lex.ws();
          var type=lex.token(),num=first+i;
          if(type==='n'&&doc.xref[num]===undefined)doc.xref[num]={offset:parseInt(off,10)};
          void gen;
        }
      }
    }
    // xref 流
    var obj=doc.parseAt(offset);
    if(!(obj instanceof PStream))return null;
    var dict=obj.dict;
    if(!isName(doc.resolve(dict.get('Type')),'XRef')&&!dict.has('W'))return null;
    var got=await doc.streamBytes(obj),data=got.data,
        w=(doc.resolve(dict.get('W'))||[]).map(function(v){return +doc.resolve(v)||0;}),
        size=+doc.resolve(dict.get('Size'))||0,
        index=doc.resolve(dict.get('Index'))||[0,size],
        rowLen=w.reduce(function(a,c){return a+c;},0),pos=0,k;
    if(!rowLen)return dict;
    for(k=0;k+1<index.length;k+=2){
      var start=+doc.resolve(index[k])||0,count=+doc.resolve(index[k+1])||0;
      for(var i=0;i<count&&pos+rowLen<=data.length;i++,pos+=rowLen){
        var f=[0,0,0],c=pos,j,t;
        for(j=0;j<3;j++){
          var width=w[j]||0,value=0;
          for(t=0;t<width;t++)value=value*256+data[c++];
          f[j]=width?value:(j===0?1:0);
        }
        var num=start+i;
        if(doc.xref[num]!==undefined)continue;
        if(f[0]===1)doc.xref[num]={offset:f[1]};
        else if(f[0]===2)doc.xref[num]={stm:f[1],idx:f[2]};
      }
    }
    return dict;
  }
  // xref 完全不可信时:全文件扫描 "N G obj",后出现的覆盖先出现的(增量更新语义)
  function rebuildXref(doc){
    var b=doc.bytes,re=/(\d+)\s+(\d+)\s+obj\b/g,text=b2s(b),match;
    doc.xref=Object.create(null);
    while((match=re.exec(text))){
      var num=parseInt(match[1],10);
      if(num>=0)doc.xref[num]={offset:match.index};
    }
    doc.cache=Object.create(null);
    doc.recovered=true;
    if(!doc.trailer.has('Root')){
      var at=lastIndexOfBytes(b,TRAILER_KW,b.length-7);
      while(at>=0){
        var lex=new Lex(b,doc,at+7),trailer=lex.obj();
        if(trailer instanceof Dict&&trailer.has('Root')){
          trailer.keys().forEach(function(key){if(!doc.trailer.has(key))doc.trailer.set(key,trailer.get(key));});
          break;
        }
        at=lastIndexOfBytes(b,TRAILER_KW,at-1);
      }
    }
    if(!doc.trailer.has('Root')){
      Object.keys(doc.xref).forEach(function(num){
        if(doc.trailer.has('Root'))return;
        var obj=doc.getObj(+num);
        if(obj instanceof Dict&&isName(doc.resolve(obj.get('Type')),'Catalog'))doc.trailer.set('Root',new Ref(+num,0));
      });
    }
  }
  async function loadObjStms(doc){
    var nums=Object.keys(doc.xref),needed=Object.create(null),i;
    for(i=0;i<nums.length;i++){
      var entry=doc.xref[nums[i]];
      if(entry&&entry.stm!==undefined)needed[entry.stm]=1;
    }
    var list=Object.keys(needed);
    for(i=0;i<list.length;i++){
      var stmNum=+list[i];
      if(doc.objStmCache[stmNum])continue;
      var stm=doc.getObj(stmNum);
      if(!(stm instanceof PStream))continue;
      var got=await doc.streamBytes(stm),data=got.data,
          n=+doc.resolve(stm.dict.get('N'))||0,first=+doc.resolve(stm.dict.get('First'))||0,
          head=new Lex(data,doc,0),pack=[];
      for(var k=0;k<n;k++){
        head.ws();
        var objNum=parseInt(head.token(),10);
        head.ws();
        var off=parseInt(head.token(),10);
        if(isNaN(objNum)||isNaN(off))break;
        pack.push({num:objNum,offset:first+off});
      }
      pack.data=data;
      doc.objStmCache[stmNum]=pack;
    }
  }

  async function load(bytes){
    if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);
    var head=indexOfBytes(bytes,s2b('%PDF-'),0);
    if(head<0){var e=new Error('这不是 PDF 文件');e.code='not-pdf';throw e;}
    if(head>0)bytes=bytes.subarray(head);
    var doc=new Doc(bytes),versionText=b2s(bytes,5,8);
    if(/^\d\.\d$/.test(versionText))doc.version=versionText;
    var ok=false;
    try{ ok=await readXrefChain(doc); }catch(_e){ ok=false; }
    if(ok)await loadObjStms(doc);
    var root=doc.resolve(doc.trailer.get('Root'));
    if(!ok||!(root instanceof Dict)||!root.has('Pages')){
      rebuildXref(doc);
      await loadObjStms(doc);
      root=doc.resolve(doc.trailer.get('Root'));
      if(root instanceof Dict)doc.warnings.push('xref');
    }
    if(doc.trailer.has('Encrypt')){
      var enc=new Error('这份 PDF 带加密/权限保护，需要先解除保护再压缩');
      enc.code='encrypted';
      throw enc;
    }
    if(!(root instanceof Dict)){
      var bad=new Error('PDF 结构无法解析（可能已损坏）');
      bad.code='broken';
      throw bad;
    }
    doc.root=root;
    return doc;
  }

  /* ========== 页面遍历 ========== */
  Doc.prototype.pages=function(){
    var out=[],seen=Object.create(null),self=this;
    function walk(node,depth,inherited){
      if(!(node instanceof Dict)||depth>64)return;
      var kids=self.resolve(node.get('Kids')),next={};
      ['Resources','MediaBox','CropBox','Rotate'].forEach(function(key){
        next[key]=node.has(key)?node.get(key):inherited[key];
      });
      if(Array.isArray(kids)){
        kids.forEach(function(kid){
          var id=kid instanceof Ref?kid.num:null;
          if(id!==null){if(seen[id])return;seen[id]=1;}
          walk(self.resolve(kid),depth+1,next);
        });
        return;
      }
      if(isName(self.resolve(node.get('Type')),'Page')||node.has('Contents')||node.has('MediaBox'))
        out.push({dict:node,inherited:next});
    }
    walk(this.resolve(this.root.get('Pages')),0,{});
    return out;
  };

  /* ========== 序列化 ========== */
  function escapeName(name){
    var out='',i,c;
    for(i=0;i<name.length;i++){
      c=name.charCodeAt(i);
      if(c<33||c>126||isDelim(c)||c===35)out+='#'+(c<16?'0':'')+c.toString(16);
      else out+=name[i];
    }
    return out;
  }
  function serialize(value,chunks,doc){
    if(value===null||value===undefined){chunks.push(s2b('null'));return;}
    if(value===true){chunks.push(s2b('true'));return;}
    if(value===false){chunks.push(s2b('false'));return;}
    if(typeof value==='number'){
      var text=Number.isInteger(value)?String(value):(Math.round(value*1e6)/1e6).toString();
      if(/e/i.test(text))text=value.toFixed(6).replace(/0+$/,'').replace(/\.$/,'');
      chunks.push(s2b(text));
      return;
    }
    if(value instanceof Name){chunks.push(s2b('/'+escapeName(value.name)));return;}
    if(value instanceof Ref){chunks.push(s2b(value.num+' '+value.gen+' R'));return;}
    if(value instanceof PStr){
      var bytes=value.bytes,out=[40],i;
      for(i=0;i<bytes.length;i++){
        var c=bytes[i];
        if(c===40||c===41||c===92)out.push(92,c);
        else if(c===13)out.push(92,114);
        else out.push(c);
      }
      out.push(41);
      chunks.push(new Uint8Array(out));
      return;
    }
    if(Array.isArray(value)){
      chunks.push(s2b('['));
      for(var k=0;k<value.length;k++){
        if(k)chunks.push(s2b(' '));
        serialize(value[k],chunks,doc);
      }
      chunks.push(s2b(']'));
      return;
    }
    if(value instanceof PStream){serialize(value.dict,chunks,doc);return;}
    if(value instanceof Dict){
      chunks.push(s2b('<<'));
      value.keys().forEach(function(key){
        chunks.push(s2b('/'+escapeName(key)));
        var item=value.get(key);
        if(!(item instanceof Name||item instanceof Dict||Array.isArray(item)||item instanceof PStr||item instanceof PStream))chunks.push(s2b(' '));
        serialize(item,chunks,doc);
      });
      chunks.push(s2b('>>'));
      return;
    }
    chunks.push(s2b('null'));
  }
  function serializeToBytes(value,doc){
    var chunks=[];
    serialize(value,chunks,doc);
    return concat(chunks);
  }

  /* ========== 重写(可达性回收 + 对象流 + xref 流) ========== */
  Doc.prototype.save=async function(opts){
    opts=opts||{};
    var doc=this,order=[],mapping=Object.create(null),visiting=Object.create(null);
    function collect(value,depth){
      if(depth>256)return;
      if(value instanceof Ref){
        if(mapping[value.num]!==undefined||visiting[value.num])return;
        visiting[value.num]=1;
        var target=doc.getObj(value.num);
        collect(target,depth+1);
        mapping[value.num]=order.length+1;
        order.push({num:value.num,obj:target});
        return;
      }
      if(Array.isArray(value)){for(var i=0;i<value.length;i++)collect(value[i],depth+1);return;}
      if(value instanceof PStream){collect(value.dict,depth+1);return;}
      if(value instanceof Dict){value.keys().forEach(function(key){collect(value.get(key),depth+1);});}
    }
    var trailer=new Dict();
    ['Root','Info','ID'].forEach(function(key){
      if(!doc.trailer.has(key))return;
      if(key==='Info'&&opts.dropInfo)return;
      trailer.set(key,doc.trailer.get(key));
    });
    collect(trailer.get('Root'),0);
    if(trailer.has('Info'))collect(trailer.get('Info'),0);

    // 内容相同的流去重(重复 Logo、重复字体)——先算指纹再决定引用重定向
    var dedupe=Object.create(null),alias=Object.create(null);
    if(opts.dedupe!==false){
      order.forEach(function(item){
        if(!(item.obj instanceof PStream))return;
        var key=hashBytes(item.obj.raw)+'|'+b2s(serializeToBytes(item.obj.dict,doc));
        if(dedupe[key]===undefined)dedupe[key]=item.num;
        else alias[item.num]=dedupe[key];
      });
    }
    var aliased=Object.keys(alias).length>0;
    function remap(value,depth){
      if(depth>256)return value;
      if(value instanceof Ref){
        var num=alias[value.num]!==undefined?alias[value.num]:value.num;
        return new Ref(mapping[num]||0,0);
      }
      if(Array.isArray(value))return value.map(function(item){return remap(item,depth+1);});
      if(value instanceof PStream){return new PStream(remap(value.dict,depth+1),value.raw);}
      if(value instanceof Dict){
        var out=new Dict();
        value.keys().forEach(function(key){out.set(key,remap(value.get(key),depth+1));});
        return out;
      }
      return value;
    }
    var live=order.filter(function(item){return !aliased||alias[item.num]===undefined;});
    // 别名对象被摘掉后要重排号,保证输出是连续紧凑的对象号
    var slot=1;
    mapping=Object.create(null);
    live.forEach(function(item){mapping[item.num]=slot++;});
    if(aliased)Object.keys(alias).forEach(function(num){mapping[num]=mapping[alias[num]];});

    var count=live.length+1,offsets=new Array(count+1),chunks=[],at=0,i;
    function emit(bytes){chunks.push(bytes);at+=bytes.length;}
    var version=doc.version;
    if(parseFloat(version)<1.5)version='1.5';
    emit(s2b('%PDF-'+version+'\n'));
    emit(new Uint8Array([37,0xe2,0xe3,0xcf,0xd3,10]));

    // 非流对象打包进对象流;流对象、以及被要求保持独立的对象直接写
    var packable=[],direct=[];
    live.forEach(function(item){
      var num=mapping[item.num];
      if(item.obj instanceof PStream||item.obj===null||item.obj===undefined)direct.push({id:num,obj:item.obj});
      else packable.push({id:num,obj:item.obj});
    });
    var useObjStm=opts.objectStreams!==false&&typeof CompressionStream==='function';
    if(!useObjStm){direct=direct.concat(packable);packable=[];}
    direct.sort(function(a,b){return a.id-b.id;});

    for(i=0;i<direct.length;i++){
      var entry=direct[i],body=remap(entry.obj,0);
      offsets[entry.id]={offset:at};
      emit(s2b(entry.id+' 0 obj\n'));
      if(body instanceof PStream){
        body.dict.set('Length',body.raw.length);
        emit(serializeToBytes(body.dict,doc));
        emit(s2b('\nstream\n'));
        emit(body.raw);
        emit(s2b('\nendstream'));
      }else{
        emit(serializeToBytes(body,doc));
      }
      emit(s2b('\nendobj\n'));
      if(opts.onProgress&&(i&63)===0)await opts.onProgress(i/Math.max(1,direct.length));
    }

    var objStmRefs=[],nextId=count;
    if(packable.length){
      packable.sort(function(a,b){return a.id-b.id;});
      var GROUP=160;
      for(var g=0;g<packable.length;g+=GROUP){
        var group=packable.slice(g,g+GROUP),head='',bodyChunks=[],cursor=0,j;
        for(j=0;j<group.length;j++){
          var bytes=serializeToBytes(remap(group[j].obj,0),doc);
          head+=group[j].id+' '+cursor+' ';
          bodyChunks.push(bytes);
          bodyChunks.push(s2b(' '));
          cursor+=bytes.length+1;
          offsets[group[j].id]={stm:0,idx:j};
        }
        var headBytes=s2b(head),payload=concat([headBytes].concat(bodyChunks)),packed=await deflate(payload);
        if(!packed)throw new Error('对象流压缩失败');
        var stmDict=new Dict();
        stmDict.set('Type',nm('ObjStm'));
        stmDict.set('N',group.length);
        stmDict.set('First',headBytes.length);
        stmDict.set('Filter',nm('FlateDecode'));
        stmDict.set('Length',packed.length);
        var stmId=nextId++;
        for(j=0;j<group.length;j++)offsets[group[j].id]={stm:stmId,idx:j};
        objStmRefs.push({id:stmId,dict:stmDict,data:packed});
      }
    }
    for(i=0;i<objStmRefs.length;i++){
      var stmEntry=objStmRefs[i];
      offsets[stmEntry.id]={offset:at};
      emit(s2b(stmEntry.id+' 0 obj\n'));
      emit(serializeToBytes(stmEntry.dict,doc));
      emit(s2b('\nstream\n'));
      emit(stmEntry.data);
      emit(s2b('\nendstream\nendobj\n'));
    }

    // xref 流
    var xrefId=nextId++,total=xrefId+1,rows=new Uint8Array(total*7),r,xrefOffset=at;
    offsets[xrefId]={offset:xrefOffset};
    for(r=0;r<total;r++){
      var slotInfo=offsets[r],base=r*7;
      if(r===0){rows[base]=0;continue;}
      if(!slotInfo){rows[base]=0;continue;}
      if(slotInfo.offset!==undefined){
        rows[base]=1;
        rows[base+1]=(slotInfo.offset>>>24)&255;rows[base+2]=(slotInfo.offset>>>16)&255;
        rows[base+3]=(slotInfo.offset>>>8)&255;rows[base+4]=slotInfo.offset&255;
      }else{
        rows[base]=2;
        rows[base+1]=(slotInfo.stm>>>24)&255;rows[base+2]=(slotInfo.stm>>>16)&255;
        rows[base+3]=(slotInfo.stm>>>8)&255;rows[base+4]=slotInfo.stm&255;
        rows[base+5]=(slotInfo.idx>>>8)&255;rows[base+6]=slotInfo.idx&255;
      }
    }
    var xrefDict=new Dict(),xrefData=await deflate(rows)||rows;
    xrefDict.set('Type',nm('XRef'));
    xrefDict.set('Size',total);
    xrefDict.set('W',[1,4,2]);
    xrefDict.set('Root',remap(trailer.get('Root'),0));
    if(trailer.has('Info'))xrefDict.set('Info',remap(trailer.get('Info'),0));
    if(trailer.has('ID'))xrefDict.set('ID',trailer.get('ID'));
    if(xrefData!==rows)xrefDict.set('Filter',nm('FlateDecode'));
    xrefDict.set('Length',xrefData.length);
    emit(s2b(xrefId+' 0 obj\n'));
    emit(serializeToBytes(xrefDict,doc));
    emit(s2b('\nstream\n'));
    emit(xrefData);
    emit(s2b('\nendstream\nendobj\n'));
    emit(s2b('startxref\n'+xrefOffset+'\n%%EOF\n'));
    return concat(chunks);
  };

  W.TYPDFCore={
    load:load,
    Name:Name,Ref:Ref,Dict:Dict,PStream:PStream,PStr:PStr,
    nm:nm,isName:isName,
    inflate:inflate,deflate:deflate,
    hashBytes:hashBytes,concat:concat,serialize:serializeToBytes,
    IMAGE_FILTERS:IMAGE_FILTERS
  };
})();
