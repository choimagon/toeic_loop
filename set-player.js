'use strict';

// Playback positions belong to a set; A–B boundaries are saved with the question.
const setCursors = new WeakMap();
const segmentCursors = new WeakMap();
const preciseTime = seconds => `${fmt(seconds)}.${Math.floor(Math.max(0, seconds) * 10) % 10}`;

function paintSeek(slider, at, duration) {
  slider.style.setProperty('--progress', `${Math.max(0, Math.min(100, at / duration * 100))}%`);
}

function segmentRange(q, i) {
  return { ...q.parts[i], owner: q, segment: i, title: `${rangeLabel(q)}번 · ${labels[i]}` };
}

function segmentPosition(q, i) {
  const p = q.parts[i];
  const time = current?.owner === q && current.segment === i ? position() : segmentCursors.get(q)?.get(i);
  return Math.max(p.start, Math.min(p.end, time ?? p.start));
}

function toggleSegment(q, i) {
  if (current?.owner === q && current.segment === i) return source ? pausePlayback() : resumePlayback();
  const range = segmentRange(q, i), at = segmentPosition(q, i);
  return playRange(range.start, range.end, range.title, i, at < range.end ? at : range.start, q);
}

function mountSegmentPlayer(el, q, i) {
  const p = q.parts[i], duration = p.end - p.start;
  const panel = document.createElement('div');
  panel.className = 'segment-transport';
  panel.dataset.segment = i;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', `${labels[i]} 재생 조작`);
  panel.innerHTML = `
    <div class="transport-buttons">
      <button type="button" data-action="back" aria-label="${labels[i]} 3초 뒤로">↶ 3초 뒤로</button>
      <button type="button" data-action="forward" aria-label="${labels[i]} 3초 앞으로">3초 앞으로 ↷</button>
      <button type="button" data-action="stop" aria-label="${labels[i]} 정지">■ 정지</button>
    </div>
    <div class="transport-progress">
      <input class="segment-seek audio-seek" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="${labels[i]} 재생 위치">
      <span class="segment-clock set-clock"></span>
    </div>`;
  el.querySelector('.edit').before(panel);
  el.querySelector('.segment-top button').onclick = () => toggleSegment(q, i);
  for (const [action, delta] of [['back', -3], ['forward', 3]]) {
    panel.querySelector(`[data-action="${action}"]`).onclick = () => {
      const playing = Boolean(source && current?.owner === q && current.segment === i);
      seekRange(segmentRange(q, i), segmentPosition(q, i) + delta, playing);
    };
  }
  panel.querySelector('[data-action="stop"]').onclick = () => seekRange(segmentRange(q, i), p.start, false);
  const slider = panel.querySelector('.segment-seek');
  let scrubbing = false, resume = false;
  slider.oninput = () => {
    if (!scrubbing) { resume = Boolean(source && current?.owner === q && current.segment === i); scrubbing = true; }
    seekRange(segmentRange(q, i), p.start + Number(slider.value), false);
  };
  slider.onchange = () => {
    const at = p.start + Number(slider.value);
    const playing = scrubbing ? resume : Boolean(source && current?.owner === q && current.segment === i);
    scrubbing = false; resume = false;
    seekRange(segmentRange(q, i), at, playing);
  };
  slider.onpointercancel = () => { scrubbing = false; resume = false; };
  syncSegmentPlayers();
}

function syncSegmentPlayers() {
  if (part !== 2 || !questions[selected]) return;
  const q = questions[selected];
  document.querySelectorAll('.segment-transport').forEach(panel => {
    const i = Number(panel.dataset.segment), p = q.parts[i];
    const playing = Boolean(source && current?.owner === q && current.segment === i);
    const button = panel.closest('.segment').querySelector('.segment-top button');
    button.textContent = playing ? 'Ⅱ 일시정지' : '▶ 재생';
    button.setAttribute('aria-label', `${labels[i]} ${playing ? '일시정지' : '재생'}`);
    button.setAttribute('aria-pressed', String(playing));
    const at = segmentPosition(q, i) - p.start, duration = p.end - p.start;
    const slider = panel.querySelector('.segment-seek');
    slider.value = at;
    slider.setAttribute('aria-valuetext', preciseTime(at));
    paintSeek(slider, at, duration);
    panel.querySelector('.segment-clock').textContent = `${preciseTime(at)} / ${preciseTime(duration)}`;
  });
}

function setBounds(q) {
  const p = q.parts[0];
  const clip = q.clip;
  if (clip && Number.isFinite(clip.start) && Number.isFinite(clip.end) &&
      clip.start >= p.start && clip.end <= p.end && clip.end > clip.start) return clip;
  return { start: p.start, end: p.end };
}

function setPosition(q) {
  const p = q.parts[0];
  const time = current?.owner === q ? position() : (setCursors.get(q) ?? setBounds(q).start);
  return Math.max(p.start, Math.min(p.end, time));
}

function rememberSetPosition() {
  if (!current?.owner) return;
  setCursors.set(current.owner, position());
  if (current.segment >= 0) {
    if (!segmentCursors.has(current.owner)) segmentCursors.set(current.owner, new Map());
    segmentCursors.get(current.owner).set(current.segment, position());
  }
}

function playSet(q = questions[selected], fromStart = false) {
  if (!q) return;
  const clip = setBounds(q);
  let offset = fromStart ? clip.start : setPosition(q);
  if (offset < clip.start || offset >= clip.end - .02) offset = clip.start;
  return playRange(clip.start, clip.end, `${rangeLabel(q)}번 · 선택 구간`, 0, offset, q);
}

function toggleSet() {
  const q = questions[selected];
  if (!q) return;
  if (current?.owner === q && source) {
    pausePlayback();
  } else if (current?.owner === q && pausedAt !== null && pausedAt < current.end) {
    resumePlayback();
  } else playSet(q);
}

function mountSetPlayer(el, q) {
  const p = q.parts[0], duration = p.end - p.start;
  const panel = document.createElement('div');
  panel.className = 'set-player';
  panel.innerHTML = `
    <div class="set-transport">
      <div class="transport-buttons">
        <button type="button" id="set-toggle" class="primary" aria-label="세트 재생" aria-pressed="false">▶ 재생</button>
        <button type="button" id="set-stop" aria-label="세트 정지">■ 정지</button>
        <button type="button" id="set-back" aria-label="세트 3초 뒤로">↶ 3초 뒤로</button>
        <button type="button" id="set-forward" aria-label="세트 3초 앞으로">3초 앞으로 ↷</button>
      </div>
      <div class="transport-progress">
        <input id="set-seek" class="audio-seek" type="range" min="0" max="${duration}" step="0.01" value="0" aria-label="세트 재생 위치">
        <span id="set-clock" class="set-clock"></span>
      </div>
    </div>
    <div class="clip-heading"><strong>반복할 부분 선택</strong><span>A와 B를 드래그해 구간을 정하세요</span></div>
    <div class="clip-track" id="clip-track">
      <div class="clip-rail"></div><div class="clip-selection" id="clip-selection"></div>
      <input id="clip-start" class="clip-handle start" type="range" min="0" max="${duration}" step="0.01" aria-label="반복 시작 A">
      <input id="clip-end" class="clip-handle end" type="range" min="0" max="${duration}" step="0.01" aria-label="반복 끝 B">
      <span class="clip-marker marker-a" aria-hidden="true">A</span><span class="clip-marker marker-b" aria-hidden="true">B</span>
    </div>
    <div class="clip-times">
      <label><b>A</b> 시작 <input id="clip-start-time" type="number" min="0" max="${duration}" step="0.1" aria-label="반복 시작 초">초</label>
      <span id="clip-duration"></span>
      <label><b>B</b> 끝 <input id="clip-end-time" type="number" min="0" max="${duration}" step="0.1" aria-label="반복 끝 초">초</label>
    </div>
    <div class="clip-actions">
      <button type="button" id="mark-start">현재 위치를 A로</button>
      <button type="button" id="mark-end">현재 위치를 B로</button>
      <button type="button" id="play-clip" class="soft">▷ A–B 듣기</button>
      <button type="button" id="reset-clip">구간 초기화</button>
    </div>
    <p class="clip-help">시간은 이 세트의 시작 기준이에요. ‘선택 구간 반복’을 켜면 A–B를 계속 들을 수 있어요.</p>`;
  el.querySelector('.edit').before(panel);

  $('set-toggle').onclick = toggleSet;
  $('set-back').onclick = () => seekSet(setPosition(q) - 3);
  $('set-forward').onclick = () => seekSet(setPosition(q) + 3);
  $('set-stop').onclick = () => seekSet((current?.owner === q ? current : setBounds(q)).start, false);
  let scrubbing = false, resumeAfterSeek = false;
  function previewSeek() {
    if (!scrubbing) {
      resumeAfterSeek = Boolean(source && current?.owner === q);
      scrubbing = true;
    }
    seekSet(p.start + Number($('set-seek').value), false);
  }
  $('set-seek').oninput = previewSeek;
  $('set-seek').onchange = () => {
    if (!scrubbing) previewSeek();
    scrubbing = false;
    if (resumeAfterSeek && current && pausedAt < current.end) resumePlayback();
    resumeAfterSeek = false;
    syncPlaybackUI();
  };
  $('set-seek').onpointercancel = () => { scrubbing = false; resumeAfterSeek = false; syncSetPlayer(); };

  let resumeAfterEdit = false;
  function changeBoundary(which, seconds, commit = true) {
    if (!Number.isFinite(seconds)) return;
    resumeAfterEdit ||= Boolean(source && current?.owner === q);
    if (current?.owner === q) halt();
    const old = setBounds(q), minLength = Math.min(.1, duration);
    const time = Math.max(p.start, Math.min(p.end, p.start + seconds));
    q.clip = which === 'start'
      ? { start: Math.min(time, old.end - minLength), end: old.end }
      : { start: old.start, end: Math.max(time, old.start + minLength) };
    setCursors.set(q, q.clip.start);
    $('repeat').checked = true;
    syncSetPlayer();
    if (commit) {
      persist();
      if (resumeAfterEdit) playSet(q, true);
      resumeAfterEdit = false;
    }
  }
  for (const which of ['start', 'end']) {
    const slider = $(`clip-${which}`), input = $(`clip-${which}-time`);
    slider.oninput = () => changeBoundary(which, Number(slider.value), false);
    slider.onchange = () => changeBoundary(which, Number(slider.value));
    slider.onpointercancel = () => changeBoundary(which, Number(slider.value));
    input.onchange = () => {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) { syncSetPlayer(); return; }
      changeBoundary(which, input.valueAsNumber);
    };
    $(`mark-${which}`).onclick = () => changeBoundary(which, setPosition(q) - p.start);
  }
  $('play-clip').onclick = () => playSet(q, true);
  $('reset-clip').onclick = () => {
    const wasPlaying = Boolean(source && current?.owner === q);
    if (current?.owner === q) halt();
    delete q.clip;
    setCursors.set(q, p.start);
    persist();
    syncSetPlayer();
    if (wasPlaying) playSet(q, true);
  };
  el.querySelector('.segment-top button').onclick = toggleSet;
  syncSetPlayer();
}

function seekSet(time, playing) {
  const q = questions[selected];
  if (!q) return;
  const range = current?.owner === q ? current : {
    ...setBounds(q), owner: q, segment: 0, title: `${rangeLabel(q)}번 · 선택 구간`
  };
  seekRange(range, time, playing ?? Boolean(source && current?.owner === q));
}

function syncSetPlayer() {
  if (part === 2 || !$('set-seek') || !questions[selected]) return;
  const q = questions[selected], p = q.parts[0], clip = setBounds(q);
  const duration = p.end - p.start, at = setPosition(q) - p.start;
  const playing = Boolean(source && current?.owner === q);
  $('set-toggle').textContent = playing ? 'Ⅱ 일시정지' : '▶ 재생';
  $('set-toggle').setAttribute('aria-label', playing ? '세트 일시정지' : '세트 재생');
  $('set-toggle').setAttribute('aria-pressed', String(playing));
  const topButton = document.querySelector('.segment-top button');
  topButton.textContent = playing ? 'Ⅱ 일시정지' : '▷ 재생';
  topButton.setAttribute('aria-label', playing ? '세트 일시정지' : '세트 재생');
  topButton.setAttribute('aria-pressed', String(playing));
  $('set-seek').value = at;
  $('set-seek').setAttribute('aria-valuetext', preciseTime(at));
  paintSeek($('set-seek'), at, duration);
  $('set-clock').textContent = `${preciseTime(at)} / ${preciseTime(duration)}`;
  const a = clip.start - p.start, b = clip.end - p.start;
  for (const [which, value] of [['start', a], ['end', b]]) {
    const slider = $(`clip-${which}`), input = $(`clip-${which}-time`);
    slider.value = value;
    slider.setAttribute('aria-valuetext', preciseTime(value));
    if (document.activeElement !== input) input.value = value.toFixed(1);
  }
  $('clip-duration').textContent = `${(b - a).toFixed(1)}초 선택`;
  $('clip-track').style.setProperty('--clip-a', `${a / duration * 100}%`);
  $('clip-track').style.setProperty('--clip-b', `${b / duration * 100}%`);
}
