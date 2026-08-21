"use strict";
const state={stats:null,mapMode:"china",mapData:{},loading:false,pendingReload:false,autoRefreshTimer:0,chartHoverIndex:-1,chartLayout:null};
const number=value=>Number(value||0).toLocaleString("zh-CN");
const byId=id=>document.getElementById(id);
const regionNames=typeof Intl.DisplayNames==="function"?new Intl.DisplayNames(["zh-CN"],{type:"region"}):null;
const chartPadding=Object.freeze({left:42,right:14,top:18,bottom:32});

async function loadStats(){
  if(state.loading){state.pendingReload=true;return;}
  const refresh=byId("refresh"),status=byId("ingest-status"),shell=document.querySelector(".dashboard-shell");
  state.loading=true;refresh.disabled=true;refresh.innerHTML='<span class="spinner" aria-hidden="true"></span><span>统计中</span>';
  status.textContent="正在读取日志…";status.className="ingest-status";document.body.classList.add("is-loading");shell.setAttribute("aria-busy","true");
  let reloadForRetention=false;
  try{
    const days=Number(byId("days").value),response=await fetch(`/api/stats?days=${days}`,{credentials:"same-origin",headers:{Accept:"application/json"}});
    if(response.status===401){location.assign("/login");return;}
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    state.stats=await response.json();reloadForRetention=applyRetention(state.stats.retention_days);renderAll((state.stats.data||[]).length||days);
  }catch(error){status.textContent=`统计加载失败：${error.message}`;status.className="ingest-status error";}
  finally{
    state.loading=false;refresh.disabled=false;refresh.innerHTML='<span class="refresh-icon" aria-hidden="true">↻</span><span>更新统计</span>';
    document.body.classList.remove("is-loading");shell.setAttribute("aria-busy","false");if(reloadForRetention||state.pendingReload){state.pendingReload=false;loadStats();}
  }
}

function applyRetention(retention){
  const select=byId("days"),current=Number(select.value);let fallback="";
  Array.from(select.options).forEach(option=>{option.disabled=Number(option.value)>retention;if(!option.disabled)fallback=option.value});
  if(select.selectedOptions[0]?.disabled&&fallback){select.value=fallback;return Number(fallback)!==current}
  return false;
}

function renderAll(days){
  const data=state.stats.data||[],today=data[data.length-1]||{},todayCrawler=state.stats.today_crawler||{},total=data.reduce((sum,item)=>sum+item.pv,0);
  byId("today-pv").textContent=number(today.pv);byId("today-uv").textContent=number(today.uv);byId("range-pv").textContent=number(total);
  byId("today-crawler-pv").textContent=number(todayCrawler.pv);byId("today-crawler-uv").textContent=number(todayCrawler.uv);
  byId("range-caption").textContent=`最近 ${days} 天`;byId("caller-note").textContent=state.stats.caller_ip?(state.stats.exclude_current_ip?`已排除当前访问 IP ${state.stats.caller_ip}`:`当前访问 IP ${state.stats.caller_ip} 已计入统计`):"";
  const ingest=state.stats.ingest||{},stamp=ingest.updated_at?new Date(ingest.updated_at*1000).toLocaleTimeString("zh-CN",{hour12:false}):"尚未同步";
  const status=byId("ingest-status");status.textContent=ingest.error?`日志状态：${ingest.error}`:`日志已同步 · ${stamp}`;status.className=`ingest-status ${ingest.error?"error":"live"}`;
  drawChart(data);renderRanking(state.stats.top_ip||[]);renderMap();
}

function drawChart(data){
  const canvas=byId("trend-chart"),box=canvas.parentElement,ratio=Math.min(devicePixelRatio||1,2),width=box.clientWidth,height=box.clientHeight,context=chartContext(canvas,width,height,ratio);
  const padding=chartPadding,plotW=width-padding.left-padding.right,plotH=height-padding.top-padding.bottom;
  const max=Math.max(5,...data.flatMap(item=>[item.pv,item.uv])),steps=4;
  const point=(item,index,key)=>({x:padding.left+(data.length===1?plotW/2:plotW*index/(data.length-1)),y:padding.top+plotH*(1-item[key]/max)}),pvPoints=data.map((item,index)=>point(item,index,"pv")),uvPoints=data.map((item,index)=>point(item,index,"uv"));
  state.chartLayout={data,width,height,ratio,plotW,plotH,max,pvPoints,uvPoints};if(state.chartHoverIndex>=data.length)state.chartHoverIndex=-1;
  context.font="11px ui-monospace, monospace";context.textBaseline="middle";context.strokeStyle="rgba(20,24,21,.09)";context.fillStyle="#7b847d";context.lineWidth=1;
  for(let index=0;index<=steps;index++){const y=padding.top+plotH*index/steps,value=Math.round(max*(steps-index)/steps);context.beginPath();context.moveTo(padding.left,y);context.lineTo(width-padding.right,y);context.stroke();context.fillText(number(value),4,y);}
  function line(points,color){if(!points.length)return;if(points.length===1){const p=points[0];context.beginPath();context.moveTo(p.x-20,p.y);context.lineTo(p.x+20,p.y);context.strokeStyle=color;context.lineWidth=3;context.stroke();context.beginPath();context.arc(p.x,p.y,5,0,Math.PI*2);context.fillStyle=color;context.fill();context.strokeStyle="#fff";context.lineWidth=2;context.stroke();return}const gradient=context.createLinearGradient(0,padding.top,0,padding.top+plotH);gradient.addColorStop(0,color+"45");gradient.addColorStop(1,color+"00");context.beginPath();points.forEach((p,index)=>{index?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y)});context.lineTo(points[points.length-1].x,padding.top+plotH);context.lineTo(points[0].x,padding.top+plotH);context.closePath();context.fillStyle=gradient;context.fill();context.beginPath();points.forEach((p,index)=>{index?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y)});context.strokeStyle=color;context.lineWidth=2;context.stroke();}
  line(pvPoints,"#3f9f78");line(uvPoints,"#172019");context.fillStyle="#7b847d";context.textAlign="center";context.textBaseline="top";
  const stride=Math.max(1,Math.ceil(data.length/7));data.forEach((item,index)=>{if(index%stride===0||index===data.length-1)context.fillText(item.date,padding.left+(data.length===1?plotW/2:plotW*index/(data.length-1)),height-padding.bottom+9)});
  drawChartOverlay();
}

function chartContext(canvas,width,height,ratio){const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight}const context=canvas.getContext("2d");context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);return context}
function drawChartOverlay(){
  const layout=state.chartLayout,tooltip=byId("trend-tooltip");if(!layout){tooltip.hidden=true;return}const context=chartContext(byId("trend-overlay"),layout.width,layout.height,layout.ratio),index=state.chartHoverIndex,item=layout.data[index];if(index<0||!item){tooltip.hidden=true;tooltip.setAttribute("aria-hidden","true");return}const pv=layout.pvPoints[index],uv=layout.uvPoints[index];
  context.save();context.beginPath();context.setLineDash([3,4]);context.moveTo(pv.x,chartPadding.top);context.lineTo(pv.x,chartPadding.top+layout.plotH);context.strokeStyle="rgba(33,122,89,.42)";context.lineWidth=1;context.stroke();context.setLineDash([]);
  [[pv,"#3f9f78"],[uv,"#172019"]].forEach(([marker,color])=>{context.beginPath();context.arc(marker.x,marker.y,5,0,Math.PI*2);context.fillStyle=color;context.fill();context.strokeStyle="#fff";context.lineWidth=2;context.stroke()});context.restore();renderChartTooltip(item,pv,byId("trend-chart").parentElement);
}
function renderChartTooltip(item,marker,box){
  const tooltip=byId("trend-tooltip");
  byId("trend-tooltip-date").textContent=new Date(`${item.full_date||item.date}T00:00:00`).toLocaleDateString("zh-CN",{year:"numeric",month:"short",day:"numeric",weekday:"short"});byId("trend-tooltip-pv").textContent=number(item.pv);byId("trend-tooltip-uv").textContent=number(item.uv);tooltip.hidden=false;tooltip.setAttribute("aria-hidden","false");
  const tooltipWidth=tooltip.offsetWidth,left=marker.x+12+tooltipWidth<=box.clientWidth?marker.x+12:marker.x-tooltipWidth-12;tooltip.style.left=Math.max(4,left)+"px";tooltip.style.top="7px";byId("trend-chart").setAttribute("aria-label",`${item.date}，PV ${number(item.pv)}，UV ${number(item.uv)}；可用左右方向键切换日期`);
}
function chartIndexAt(clientX){
  const canvas=byId("trend-chart"),layout=state.chartLayout;if(!layout?.data.length)return-1;const x=clientX-canvas.getBoundingClientRect().left-chartPadding.left;if(x<-14||x>layout.plotW+14)return-1;if(layout.data.length===1)return 0;return Math.max(0,Math.min(layout.data.length-1,Math.round(x/layout.plotW*(layout.data.length-1))));
}
function activateChartIndex(index){if(index<0){hideChartTooltip();return}if(index===state.chartHoverIndex)return;state.chartHoverIndex=index;drawChartOverlay()}
function hideChartTooltip(){if(state.chartHoverIndex<0)return;state.chartHoverIndex=-1;byId("trend-chart").setAttribute("aria-label","每日 PV 和 UV 趋势图，可用左右方向键查看每天数据");drawChartOverlay()}
function chartKeydown(event){
  const length=state.chartLayout?.data.length||0;if(!length)return;let index=state.chartHoverIndex<0?length-1:state.chartHoverIndex;
  if(event.key==="ArrowLeft")index=Math.max(0,index-1);else if(event.key==="ArrowRight")index=Math.min(length-1,index+1);else if(event.key==="Home")index=0;else if(event.key==="End")index=length-1;else if(event.key==="Escape"){hideChartTooltip();return}else return;event.preventDefault();activateChartIndex(index);
}

function renderRanking(items){
  const box=byId("ip-ranking");box.replaceChildren();const max=Math.max(1,...items.map(item=>item.count));
  items.forEach((item,index)=>{const row=document.createElement("div");row.className="ip-row";
    const displayLocation=localizedLocation(item.geo);row.dataset.search=`${item.ip} ${displayLocation} ${item.geo?.location||""}`.toLocaleLowerCase();
    const rank=document.createElement("span");rank.className="ip-rank";rank.textContent=String(index+1);
    const ipCell=document.createElement("span");ipCell.className="ip-cell";
    const ip=document.createElement("button");ip.className="ip-address";ip.type="button";ip.textContent=item.ip;ip.title=`复制 ${item.ip}`;ip.setAttribute("aria-label",`复制 IP ${item.ip}`);ip.addEventListener("click",()=>copyIp(item.ip,ip));ipCell.append(ip);
    if(item.crawler){const badge=document.createElement("span");badge.className="crawler-badge";badge.textContent="爬虫";badge.title="公开声明身份的正常爬虫；访问量已计入统计";ipCell.append(badge)}
    const location=document.createElement("span");location.className="ip-location";location.textContent=displayLocation;location.title=location.textContent;
    const bar=document.createElement("span");bar.className="ip-bar";const fill=document.createElement("span");fill.style.width=`${Math.max(2,item.count/max*100)}%`;bar.append(fill);
    const count=document.createElement("span");count.className="ip-count";count.textContent=number(item.count);row.append(rank,ipCell,location,bar,count);box.append(row);
  });
  filterRanking();
}
function localizedLocation(geo){
  if(!geo)return"未知";const code=String(geo.country_code||"").toUpperCase();
  if(!code||code==="CN")return geo.location||"未知";
  const country=regionNames?.of(code)||geo.country||"未知国家";
  return geo.source?`${country} · ${geo.source}`:country;
}
function filterRanking(){
  const query=byId("ip-filter").value.trim().toLocaleLowerCase(),rows=Array.from(document.querySelectorAll("#ip-ranking .ip-row"));let visible=0;
  rows.forEach(row=>{const matched=!query||(row.dataset.search||"").includes(query);row.hidden=!matched;if(matched)visible++});
  byId("ranking-note").textContent=query?`显示 ${visible} / ${rows.length} 个结果`:`按查询区间累计访问量降序 · ${rows.length} 个 IP`;
  byId("ranking-empty").hidden=!query||visible>0;
}
async function copyIp(value,button){
  try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(value);
    else{const input=document.createElement("textarea");input.value=value;input.readOnly=true;input.style.position="fixed";input.style.opacity="0";document.body.append(input);input.select();document.execCommand("copy");input.remove()}
    document.querySelectorAll(".ip-address.copied").forEach(item=>item.classList.remove("copied"));button.classList.add("copied");window.setTimeout(()=>button.classList.remove("copied"),1400);
  }catch(error){const status=byId("ingest-status");status.textContent="复制失败，请手动选择 IP";status.className="ingest-status error"}
}

function normalizeProvince(value){return String(value||"").replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/g,"");}
function regionValues(){const map=new Map();for(const item of state.stats?.regions||[]){const key=state.mapMode==="china"?normalizeProvince(item.province):(item.country_code||"").toUpperCase();if(key&&(state.mapMode!=="china"||item.country_code==="CN"))map.set(key,(map.get(key)||0)+item.count)}return map;}
async function mapData(mode){if(state.mapData[mode])return state.mapData[mode];const response=await fetch(mode==="china"?"/static/data/china.json":"/static/data/world.json");if(!response.ok)throw new Error("地图资源加载失败");return state.mapData[mode]=await response.json();}
function eachCoordinate(geometry,callback){if(!geometry)return;const walk=value=>{if(typeof value[0]==="number")callback(value);else value.forEach(walk)};walk(geometry.coordinates||[]);}
function projection(features,mode,width,height){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;const raw=([lon,lat])=>mode==="china"?[lon,-Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360))*180/Math.PI]:[lon,-lat];features.forEach(feature=>eachCoordinate(feature.geometry,coordinate=>{const [x,y]=raw(coordinate);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}));const pad=mode==="china"?24:14,scale=Math.min((width-pad*2)/(maxX-minX),(height-pad*2)/(maxY-minY)),usedW=(maxX-minX)*scale,usedH=(maxY-minY)*scale,offsetX=(width-usedW)/2,offsetY=(height-usedH)/2;return coordinate=>{const [x,y]=raw(coordinate);return[offsetX+(x-minX)*scale,offsetY+(y-minY)*scale]};}
function geometryPath(geometry,project,mode){let output="";const polygon=rings=>rings.forEach(ring=>{let started=false,previous=null;ring.forEach(coordinate=>{if(mode==="world"&&previous&&Math.abs(coordinate[0]-previous[0])>180){if(started)output+="Z";started=false}const [x,y]=project(coordinate);output+=(started?"L":"M")+x.toFixed(2)+","+y.toFixed(2);started=true;previous=coordinate});if(started)output+="Z"});if(geometry.type==="Polygon")polygon(geometry.coordinates);else if(geometry.type==="MultiPolygon")geometry.coordinates.forEach(polygon);return output;}
function featureKey(feature,mode){const properties=feature.properties||{};return mode==="china"?normalizeProvince(properties.name):(properties.ISO_A2_EH||properties.ISO_A2||properties.iso_a2||"").toUpperCase();}
function featureLabel(feature){const p=feature.properties||{};return p.NAME_ZH||p.name||p.ADMIN||p.NAME||"未知地域";}
function heatColor(value,max){if(!value)return"#e8ede9";const ratio=Math.sqrt(value/Math.max(1,max)),start=[220,239,230],end=[33,122,89],mix=index=>Math.round(start[index]+(end[index]-start[index])*ratio);return`rgb(${mix(0)} ${mix(1)} ${mix(2)})`;}
async function renderMap(){
  const box=byId("map"),tooltip=byId("map-tooltip");box.querySelectorAll("svg,.map-error").forEach(item=>item.remove());
  try{const data=await mapData(state.mapMode),features=data.features||[],values=regionValues(),width=state.mapMode==="china"?620:900,height=430,project=projection(features,state.mapMode,width,height),max=Math.max(1,...values.values());
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.setAttribute("role","img");svg.setAttribute("aria-label",state.mapMode==="china"?"中国访问地域热力图":"世界访问地域热力图");
    features.forEach(feature=>{const key=featureKey(feature,state.mapMode),hits=values.get(key)||0,path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("class","map-country"+(hits?" has-data":""));path.setAttribute("d",geometryPath(feature.geometry,project,state.mapMode));path.style.fill=heatColor(hits,max);path.addEventListener("pointerenter",event=>{tooltip.hidden=false;tooltip.textContent=`${featureLabel(feature)} · ${number(hits)} 次访问`;moveTooltip(event,box,tooltip)});path.addEventListener("pointermove",event=>moveTooltip(event,box,tooltip));path.addEventListener("pointerleave",()=>{tooltip.hidden=true});svg.append(path)});box.prepend(svg);byId("region-count").textContent=number([...values.values()].filter(Boolean).length);
  }catch(error){byId("region-count").textContent="—";const note=document.createElement("p");note.className="map-error";note.textContent="地图资源加载失败，访问榜仍可正常使用";box.prepend(note);}
}
function moveTooltip(event,box,tooltip){const bounds=box.getBoundingClientRect();tooltip.style.left=Math.min(bounds.width-230,Math.max(8,event.clientX-bounds.left+12))+"px";tooltip.style.top=Math.min(bounds.height-42,Math.max(8,event.clientY-bounds.top+12))+"px";}

const settingsDialog=byId("settings-dialog"),settingsStatus=byId("settings-status"),csrfToken=document.querySelector('meta[name="csrf-token"]').content;
const settingFields={session_duration_days:byId("setting-session-duration-days"),default_view_days:byId("setting-default-view-days"),retention_days:byId("setting-retention-days"),collector_interval_seconds:byId("setting-interval-seconds"),collector_batch_lines:byId("setting-batch-lines")};
const excludeCurrentIp=byId("setting-exclude-current-ip");
function selectDays(value){const select=byId("days"),days=String(value);let option=Array.from(select.options).find(item=>item.value===days);select.querySelectorAll("[data-custom-days]").forEach(item=>{if(item!==option)item.remove()});if(!option){option=document.createElement("option");option.value=days;option.textContent=`最近 ${days} 天`;option.dataset.customDays="";select.prepend(option)}select.value=days;}
function showSettingsStatus(message,error=false){settingsStatus.textContent=message;settingsStatus.classList.toggle("error",error)}
async function openSettings(){
  settingsDialog.showModal();showSettingsStatus("正在读取当前参数…");byId("settings-save").disabled=true;
  try{const response=await fetch("/api/settings",{credentials:"same-origin",headers:{Accept:"application/json"}});if(response.status===401){location.assign("/login");return}const payload=await response.json();if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    Object.entries(settingFields).forEach(([key,input])=>{const setting=payload.settings[key];input.value=setting.value;input.min=setting.min;input.max=setting.max;input.title=`环境默认值 ${setting.default}`});excludeCurrentIp.checked=Boolean(payload.settings.exclude_current_ip.value);showSettingsStatus("");
  }catch(error){showSettingsStatus(`参数读取失败：${error.message}`,true)}finally{byId("settings-save").disabled=false}
}
async function saveSettings(event){
  event.preventDefault();if(!event.currentTarget.reportValidity())return;const button=byId("settings-save");button.disabled=true;showSettingsStatus("正在保存…");
  const body=Object.fromEntries(Object.entries(settingFields).map(([key,input])=>[key,Number(input.value)]));body.exclude_current_ip=excludeCurrentIp.checked?1:0;
  try{const response=await fetch("/api/settings",{method:"POST",credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    const retention=payload.settings.retention_days.value,defaultDays=payload.settings.default_view_days.value;selectDays(defaultDays);applyRetention(retention);showSettingsStatus("已保存；登录态、默认查看范围和当前 IP 过滤已立即生效，采集参数将在下一轮读取时生效。");loadStats();
  }catch(error){showSettingsStatus(`保存失败：${error.message}`,true)}finally{button.disabled=false}
}

function scheduleAutoRefresh(){
  clearTimeout(state.autoRefreshTimer);state.autoRefreshTimer=0;const seconds=Number(byId("auto-refresh").value);
  if(seconds>0)state.autoRefreshTimer=window.setTimeout(async()=>{await loadStats();scheduleAutoRefresh()},seconds*1000);
}
async function refreshNow(){clearTimeout(state.autoRefreshTimer);await loadStats();scheduleAutoRefresh()}
async function saveAutoRefresh(){
  const select=byId("auto-refresh"),seconds=Number(select.value),previous=select.dataset.saved||"60";select.disabled=true;
  try{const response=await fetch("/api/settings",{method:"POST",credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json","X-CSRF-Token":csrfToken},body:JSON.stringify({auto_refresh_seconds:seconds})});if(response.status===401){location.assign("/login");return}const payload=await response.json();if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    select.dataset.saved=String(payload.settings.auto_refresh_seconds.value);const status=byId("ingest-status");status.textContent=seconds?`已开启自动更新 · 每 ${select.selectedOptions[0].textContent}`:"已关闭自动更新";status.className="ingest-status live";scheduleAutoRefresh();
  }catch(error){select.value=previous;const status=byId("ingest-status");status.textContent=`自动更新设置失败：${error.message}`;status.className="ingest-status error";scheduleAutoRefresh()}finally{select.disabled=false}
}

byId("auto-refresh").dataset.saved=byId("auto-refresh").value;byId("auto-refresh").addEventListener("change",saveAutoRefresh);byId("refresh").addEventListener("click",refreshNow);byId("days").addEventListener("change",refreshNow);byId("ip-filter").addEventListener("input",filterRanking);document.querySelectorAll("[data-map]").forEach(button=>button.addEventListener("click",()=>{state.mapMode=button.dataset.map;document.querySelectorAll("[data-map]").forEach(item=>{const active=item===button;item.classList.toggle("active",active);item.setAttribute("aria-pressed",String(active))});renderMap()}));
const trendCanvas=byId("trend-chart"),activateChartAtPointer=event=>activateChartIndex(chartIndexAt(event.clientX));trendCanvas.addEventListener("pointermove",activateChartAtPointer);trendCanvas.addEventListener("mousemove",activateChartAtPointer);trendCanvas.addEventListener("pointerdown",activateChartAtPointer);trendCanvas.addEventListener("click",activateChartAtPointer);trendCanvas.addEventListener("pointerleave",event=>{if(event.pointerType!=="touch")hideChartTooltip()});trendCanvas.addEventListener("mouseleave",hideChartTooltip);trendCanvas.addEventListener("focus",()=>{if(state.chartHoverIndex<0)activateChartIndex((state.chartLayout?.data.length||1)-1)});trendCanvas.addEventListener("keydown",chartKeydown);
byId("settings-open").addEventListener("click",openSettings);byId("settings-close").addEventListener("click",()=>settingsDialog.close());byId("settings-cancel").addEventListener("click",()=>settingsDialog.close());byId("settings-form").addEventListener("submit",saveSettings);settingsDialog.addEventListener("click",event=>{if(event.target===settingsDialog)settingsDialog.close()});
new ResizeObserver(()=>{if(state.stats)drawChart(state.stats.data||[])}).observe(byId("trend-chart").parentElement);refreshNow();
