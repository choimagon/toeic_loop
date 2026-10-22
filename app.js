'use strict';
const $=id=>document.getElementById(id), labels=['질문','보기 A','보기 B','보기 C'];
let ctx,buffer,source=null,questions=[],selected=0,key='',current=null,pausedAt=null,startClock=0,startOffset=0,rate=1,token=0,busy=false,part=2,fileIdentity='';
const fmt=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const status=s=>$('status').textContent=s;
const firstNumbers={2:7,3:32,4:71};
function rangeLabel(q){return part===2?`${q.num}`:`${q.num}–${q.num+2}`}
function segmentLabel(i){return part===2?labels[i]:(part===3?'대화 + 3문제':'지문 + 3문제')}
function updatePartUI(){
  $('part-select').value=part;
  $('part-help').textContent=part===2?'질문과 A·B·C 보기를 나눠 들어요.':'세 문제씩 묶어서 재생해요. 질문 읽는 부분도 함께 포함됩니다.';
  $('choices').hidden=part!==2;
  $('whole').textContent=part===2?'▷ 문항 전체':'▷ 세트 전체';
  $('prev').textContent=part===2?'← 이전 문항':'← 이전 세트';$('next').textContent=part===2?'다음 문항 →':'다음 세트 →';
  $('nav').classList.toggle('sets',part!==2);
  document.querySelector('.question-head .eyebrow').textContent=part===2?'QUESTION & RESPONSE':part===3?'CONVERSATIONS':'TALKS';
  $('shortcuts').textContent=part===2?'단축키 1 질문 · 2 / 3 / 4 A·B·C':'단축키 1 세트 재생 · ← → 세트 이동';
  document.querySelector('.preview').textContent=part===2?'질문 ▷   A ▷   B ▷   C ▷':`${firstNumbers[part]}–${firstNumbers[part]+2}번 세트 ▷`;
}
function setBusy(value){busy=value;for(const id of ['file','part-select'])$(id).disabled=value;$('analyze').disabled=value||!buffer}
function storageKey(){return part===2?`loop-v1:${fileIdentity}`:`loop-v3:part${part}:${fileIdentity}`}
async function restoreOrAnalyze(){
  key=storageKey();let saved;try{saved=JSON.parse(localStorage.getItem(key))}catch{}
  const expected=part===2?4:1;
  if(saved&&Math.abs(saved.duration-buffer.duration)<.1&&Array.isArray(saved.questions)&&saved.questions.length&&saved.questions.every(q=>Number.isFinite(q.num)&&q.parts?.length===expected&&q.parts.every(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.start>=0&&p.end>p.start&&p.end<=buffer.duration))){
    questions=saved.questions;if(part===2&&!saved.version&&Number(saved.first)===1){questions.forEach(q=>q.num+=6);saved.first=7}
    $('first').value=saved.first;persist();render();status('저장된 구간과 별표를 불러왔어요.');
  }else await analyze();
}
function position() {
  return source ? Math.min(current.end, startOffset + (ctx.currentTime - startClock) * rate) : (pausedAt ?? 0);
}
function halt(clear = true) {
  rememberSetPosition();
  token++;
  if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
  if (clear) { pausedAt = null; current = null; }
}
async function playRange(start, end, title, segment = -1, offset = start, owner = null) {
  if (!buffer || !(end > start)) return;
  halt();
  const ticket = token;
  try {
    await ctx.resume();
    if (ticket !== token) return;
    current = { start, end, title, segment, owner };
    startSource(Math.max(start, Math.min(end, offset)));
  } catch (e) { status('재생할 수 없어요: ' + e.message); }
}
function startSource(offset) {
  startOffset = offset; startClock = ctx.currentTime; pausedAt = null;
  source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
  source.connect(ctx.destination);
  const ticket = ++token;
  source.onended = () => {
    if (ticket !== token) return;
    source.disconnect(); source = null;
    if ($('repeat').checked && current) startSource(current.start);
    else { pausedAt = current.end; syncPlaybackUI(); }
  };
  source.start(0, offset, Math.max(.001, current.end - offset));
  syncPlaybackUI();
}
function pausePlayback() {
  if (!source) return;
  const at = position();
  halt(false); pausedAt = at;
  syncPlaybackUI();
}
function resumePlayback() {
  if (!current) return;
  const at = pausedAt !== null && pausedAt < current.end ? pausedAt : current.start;
  return playRange(current.start, current.end, current.title, current.segment, at, current.owner);
}
function toggleRange(range) {
  const matches = current && current.owner === range.owner && current.segment === range.segment &&
    current.start === range.start && current.end === range.end;
  if (matches) return source ? pausePlayback() : resumePlayback();
  return playRange(range.start, range.end, range.title, range.segment, range.start, range.owner);
}
function seekRange(range, time, playing = Boolean(source)) {
  if (!buffer || !range) return;
  const next = { ...range }, at = Math.max(next.start, Math.min(next.end, time));
  halt(); current = next; pausedAt = at;
  rememberSetPosition();
  if (playing && at < next.end) return playRange(next.start, next.end, next.title, next.segment, at, next.owner);
  syncPlaybackUI();
}
function skipPlayback(seconds) {
  if (!buffer) return;
  const range = current ?? { start: 0, end: buffer.duration, title: '전체 음원', segment: -1, owner: null };
  seekRange(range, (current ? position() : range.start) + seconds);
}
function stopPlayback() {
  if (current) seekRange(current, current.start, false);
  else { halt(); syncPlaybackUI(); }
}
function toggle() {
  if (!buffer) return;
  if (current) return source ? pausePlayback() : resumePlayback();
  if (questions.length) return playPart(0);
  playRange(0, buffer.duration, '전체 음원');
}
function syncPlaybackUI() {
  const playing = Boolean(source), range = current;
  $('toggle').textContent = playing ? 'Ⅱ 일시정지' : '▶ 재생';
  $('toggle').setAttribute('aria-label', playing ? '일시정지' : '재생');
  $('toggle').setAttribute('aria-pressed', String(playing));
  $('playing').textContent = range?.title ?? '재생 준비';
  const start = range?.start ?? 0, end = range?.end ?? buffer?.duration ?? 1;
  const at = range ? position() : start;
  $('seek').min = start; $('seek').max = end; $('seek').value = at;
  paintSeek($('seek'), at - start, end - start);
  $('clock').textContent = `${fmt(at - start)} / ${fmt(end - start)}`;
  const q = questions[selected];
  const wholePlaying = playing && range?.owner === q && range?.segment === -1;
  const choicesPlaying = playing && range?.owner === q && range?.segment === -2;
  $('whole').textContent = wholePlaying ? 'Ⅱ 일시정지' : part === 2 ? '▷ 문항 전체' : '▷ 세트 전체';
  $('choices').textContent = choicesPlaying ? 'Ⅱ 보기 일시정지' : '▷ A·B·C 연속';
  document.querySelectorAll('.segment').forEach((el, i) => el.classList.toggle('active', playing && range?.owner === q && range?.segment === i));
  syncSegmentPlayers(); syncSetPlayer();
}
function persist(){try{localStorage.setItem(key,JSON.stringify({version:3,part,duration:buffer.duration,questions,first:$('first').value}))}catch{status('브라우저 저장 공간이 부족해 수정 사항을 저장하지 못했어요.')}}
function renderNav(){const nav=$('nav');nav.replaceChildren();questions.forEach((q,i)=>{if($('filter').checked&&!q.star)return;const b=document.createElement('button');b.textContent=rangeLabel(q);b.className=(selected===i?'selected ':'')+(q.star?'marked':'');b.setAttribute('aria-label',`${rangeLabel(q)}번 문항${q.star?' 별표':''}`);b.onclick=()=>select(i);nav.append(b)});$('count').textContent=part===2?`${questions.length}문항`:`${questions.length}세트 · ${questions.length*3}문항`;if(!nav.children.length&&questions.length){const p=document.createElement('small');p.textContent='별표 문항이 없어요.';p.style.gridColumn='1 / -1';nav.append(p)}}
function select(i){if(i<0||i>=questions.length)return;halt();selected=i;render()}
function render(){updatePartUI();renderNav();$('empty').hidden=questions.length>0;$('content').hidden=!questions.length;if(!questions.length)return;const q=questions[selected];$('qtitle').textContent=part===2?`Question ${String(q.num).padStart(2,'0')}`:`Questions ${rangeLabel(q)}`;$('star').textContent=q.star?'★':'☆';$('star').setAttribute('aria-pressed',String(q.star));$('prev').disabled=selected===0;$('next').disabled=selected===questions.length-1;const root=$('segments');root.replaceChildren();q.parts.forEach((p,i)=>{const el=document.createElement('div');el.className='segment';el.innerHTML=`<div class="segment-top"><span class="badge">${part===2?['Q','A','B','C'][i]:'▶'}</span><div class="segment-info"><strong>${segmentLabel(i)}</strong><small>${fmt(p.start)} – ${fmt(p.end)} · ${(p.end-p.start).toFixed(1)}초</small></div><button class="soft">▷ 재생</button></div><details class="edit"><summary>구간 조정</summary><div class="edit-row"><label>시작 <input aria-label="${segmentLabel(i)} 시작 초" type="number" min="0" max="${buffer.duration}" step="0.05" value="${p.start.toFixed(2)}"></label><label>끝 <input aria-label="${segmentLabel(i)} 끝 초" type="number" min="0" max="${buffer.duration}" step="0.05" value="${p.end.toFixed(2)}"></label><button>적용</button><span>단위: 초</span></div></details>`;el.querySelector('.segment-top button').onclick=()=>playPart(i);el.querySelector('.edit button').onclick=()=>{const inputs=el.querySelectorAll('.edit input'),s=Number(inputs[0].value),e=Number(inputs[1].value);if([...inputs].some(x=>x.value==='')||!Number.isFinite(s)||!Number.isFinite(e)||s<0||e<=s||e>buffer.duration){status('시작은 0 이상, 끝은 시작보다 크고 음원 길이 이하여야 해요.');return}halt();p.start=s;p.end=e;delete q.clip;setCursors.delete(q);segmentCursors.delete(q);persist();render();status(`${rangeLabel(q)}번 ${segmentLabel(i)} 구간을 저장했어요.`)};root.append(el);if(part===2)mountSegmentPlayer(el,q,i);else mountSetPlayer(el,q)})}
function playPart(i){if(part!==2){if(i===0)toggleSet();return}const q=questions[selected];if(q?.parts[i])toggleSegment(q,i)}
async function analyze(){if(!buffer)return;halt();const first=Number($('first').value),offset=Number($('offset').value),gap=Number($('gap').value),short=Number($('short').value);if(!Number.isInteger(first)||first<1||first>999||offset<0||offset>=buffer.duration||short<.15||gap<=short||gap>15){status('분리 설정을 확인해 주세요. 시작 위치는 음원 길이보다 작아야 해요.');return}status('무음 간격을 분석하고 있어요…');await new Promise(r=>setTimeout(r,30));const sr=buffer.sampleRate,step=Math.floor(sr*.01),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));let silent=null;const gaps=[];for(let j=Math.floor(offset*sr);j<buffer.length;j+=step){let sum=0,n=0;for(let k=j;k<Math.min(j+step,buffer.length);k+=4){for(const ch of channels){sum+=ch[k]*ch[k];n++}}const quiet=Math.sqrt(sum/n)<.0126,t=j/sr;if(quiet&&silent===null)silent=t;if(!quiet&&silent!==null){if(t-silent>=short)gaps.push({start:silent,end:t});silent=null}}if(silent!==null&&buffer.duration-silent>=short)gaps.push({start:silent,end:buffer.duration});
const blocks=[];let begin=offset;for(const g of gaps.filter(g=>g.end-g.start>=gap)){if(g.start-begin>.3)blocks.push({start:begin,end:g.start});begin=g.end}if(buffer.duration-begin>.3)blocks.push({start:begin,end:buffer.duration});let uncertain=0;questions=[];
if(part!==2){
  // Long speech blocks identify each passage; short question blocks belong to it.
  const anchors=blocks.map((b,i)=>b.end-b.start>=15?i:-1).filter(i=>i>=0);
  const groups=[];
  if(anchors.length){
    anchors.forEach((start,i)=>groups.push(blocks.slice(start,anchors[i+1]??blocks.length)));
    if(anchors[0]>0)uncertain++;
  }else{
    for(let i=0;i<blocks.length;i+=3)groups.push(blocks.slice(i,i+3));
    uncertain++;
  }
  for(const group of groups){
    if(group.length!==3&&group.length!==4)uncertain++;
    questions.push({num:first+questions.length*3,star:false,parts:[{start:Math.max(offset,group[0].start-.12),end:Math.min(buffer.duration,group.at(-1).end+.16)}]});
  }
}else for(const block of blocks){let cursor=block.start;const chunks=[];for(const g of gaps.filter(g=>g.start>=block.start&&g.end<=block.end)){if(g.start-cursor>.12)chunks.push({start:cursor,end:g.start});cursor=g.end}if(block.end-cursor>.12)chunks.push({start:cursor,end:block.end});if(chunks.length<4){uncertain++;continue}let groups;if(chunks.length>=8){const c=chunks.slice(-8);groups=[[c[0],c[1]],[c[2],c[3]],[c[4],c[5]],[c[6],c[7]]];if(chunks.length!==8)uncertain++}else{groups=[chunks.slice(0,-3),[chunks.at(-3)],[chunks.at(-2)],[chunks.at(-1)]];if(chunks.length!==4&&chunks.length!==5)uncertain++}questions.push({num:first+questions.length,star:false,parts:groups.map(g=>({start:Math.max(offset,g[0].start-.12),end:Math.min(buffer.duration,g.at(-1).end+.16)}))})}selected=0;persist();render();status(questions.length?`${questions.length}개 ${part===2?'문항':'세트 (3문제씩)'}를 분리했어요. 먼저 첫 구간을 확인해 주세요.${uncertain?' 일부 구간은 안내 방송 또는 불규칙한 간격이 있어 확인이 필요해요.':''}`:'문항을 찾지 못했어요. 선택한 파트가 맞는지 확인하거나 무음 간격을 조정해 주세요.');}
async function load(file){
  if(busy)return;setBusy(true);halt();status('음원 불러오는 중…');
  try{
    ctx??=new AudioContext();const data=await file.arrayBuffer();const decoded=await ctx.decodeAudioData(data);
    buffer=decoded;fileIdentity=`${file.name}:${file.size}`;
    const detected=file.name.match(/(?:part|파트)[\s_.-]*([234])(?:[^0-9]|$)/i);
    let preference;try{preference=Number(localStorage.getItem(`loop-part:${fileIdentity}`))}catch{}
    part=[2,3,4].includes(preference)?preference:detected?Number(detected[1]):part;
    questions=[];selected=0;updatePartUI();
    $('filename').textContent=file.name;$('filemeta').textContent=`${fmt(buffer.duration)} · ${(file.size/1024/1024).toFixed(1)} MB · 로컬 파일`;
    $('seek').max=buffer.duration;$('seek').disabled=false;$('toggle').disabled=false;$('stop').disabled=false;$('back').disabled=false;$('forward').disabled=false;
    $('playing').textContent='재생 준비';$('offset').value=0;$('first').value=firstNumbers[part];
    await restoreOrAnalyze();
    if(!detected&&!preference)status($('status').textContent+` 파일명에 파트가 없어 선택된 Part ${part}로 분석했어요. 위에서 변경할 수 있어요.`);
  }catch(e){status('음원을 열지 못했어요. 지원되는 MP3 또는 WAV 파일로 다시 시도해 주세요. '+e.message)}finally{setBusy(false)}
}
$('part-select').onchange=async()=>{
  if(busy)return;halt();part=Number($('part-select').value);$('first').value=firstNumbers[part];$('offset').value=0;questions=[];selected=0;render();
  if(!buffer){status(`Part ${part} 선택됨 · ${firstNumbers[part]}번부터 시작합니다.`);return}
  setBusy(true);try{localStorage.setItem(`loop-part:${fileIdentity}`,part)}catch{}
  try{await restoreOrAnalyze()}finally{setBusy(false)}
};
$('file').onchange=e=>{if(e.target.files[0])load(e.target.files[0]);e.target.value=''};
$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('drag')};$('drop').ondragleave=()=>$('drop').classList.remove('drag');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('drag');if(e.dataTransfer.files[0])load(e.dataTransfer.files[0])};
$('analyze').onclick=async()=>{if(busy)return;setBusy(true);try{await analyze()}finally{setBusy(false)}};
$('filter').onchange=renderNav;
$('star').onclick=()=>{questions[selected].star=!questions[selected].star;persist();render()};
$('prev').onclick=()=>select(selected-1);$('next').onclick=()=>select(selected+1);
$('whole').onclick=()=>{
  const q=questions[selected];if(!q)return;
  toggleRange({start:q.parts[0].start,end:q.parts.at(-1).end,title:`${rangeLabel(q)}번 · ${part===2?'문항':'세트'} 전체`,segment:-1,owner:q});
};
$('choices').onclick=()=>{
  const q=questions[selected];if(!q||part!==2)return;
  toggleRange({start:q.parts[1].start,end:q.parts[3].end,title:`${rangeLabel(q)}번 · A·B·C 보기`,segment:-2,owner:q});
};
$('toggle').onclick=toggle;$('stop').onclick=stopPlayback;
$('back').onclick=()=>skipPlayback(-3);$('forward').onclick=()=>skipPlayback(3);
$('speed').onchange=()=>{
  const at=position(), playing=Boolean(source);if(playing)halt(false);
  rate=Number($('speed').value);
  if(playing)startSource(at);
};
let resumeAfterGlobalSeek=false,globalScrubbing=false;
$('seek').oninput=()=>{
  if(!globalScrubbing){resumeAfterGlobalSeek=Boolean(source);globalScrubbing=true}
  const range=current??{start:0,end:buffer.duration,title:'전체 음원',segment:-1,owner:null};
  seekRange(range,Number($('seek').value),false);
};
$('seek').onchange=()=>{
  globalScrubbing=false;
  if(resumeAfterGlobalSeek&&current&&pausedAt<current.end)resumePlayback();
  resumeAfterGlobalSeek=false;
};
$('seek').onpointercancel=()=>{globalScrubbing=false;resumeAfterGlobalSeek=false};
document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,button,summary,label')||e.altKey||e.metaKey||e.ctrlKey)return;if(e.code==='Space'){e.preventDefault();toggle()}if('1234'.includes(e.key)&&e.key.length===1)playPart(Number(e.key)-1);if(e.key==='ArrowLeft'){e.preventDefault();select(selected-1)}if(e.key==='ArrowRight'){e.preventDefault();select(selected+1)}});
setInterval(()=>{if(buffer)syncPlaybackUI()},100);
updatePartUI();
