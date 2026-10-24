'use strict';

// Small, explicit state machine: no eval or dynamic code execution.
function createCalculator() {
  let value = '0', stored = null, operation = null, fresh = true, expression = 'Готов к вычислениям';
  const symbols = {'+': '+', '-': '−', '*': '×', '/': '÷'};
  const pretty = number => String(number).replace('.', ',');
  const format = number => Number.isFinite(number) ? String(Number(number.toPrecision(12))) : 'Ошибка';
  const calculate = (a, b, op) => ({'+': () => a + b, '-': () => a - b, '*': () => a * b, '/': () => b === 0 ? NaN : a / b})[op]();
  function clear() { value = '0'; stored = null; operation = null; fresh = true; expression = 'Готов к вычислениям'; }
  function input(key) {
    if (key === 'clear') clear();
    else if (/^[0-9.]$/.test(key)) {
      if (value === 'Ошибка') clear();
      if (fresh) { value = key === '.' ? '0.' : key; fresh = false; if (!operation) expression = ''; }
      else if (key === '.') { if (!value.includes('.') && !value.includes('e')) value += '.'; }
      else if (value.replace(/[^0-9]/g, '').length < 12) value = value === '0' ? key : value + key;
    } else if (value !== 'Ошибка') {
      if (key === 'sign') { if (Number(value) !== 0) value = value.startsWith('-') ? value.slice(1) : '-' + value; }
      else if (key === 'percent') { value = format(Number(value) / 100); }
      else if (key === 'backspace' && !fresh) { value = value.slice(0, -1); if (!value || value === '-') value = '0'; }
      else if (Object.prototype.hasOwnProperty.call(symbols, key)) {
        if (operation && !fresh) value = format(calculate(stored, Number(value), operation));
        if (value === 'Ошибка') { expression = 'На ноль делить нельзя'; stored = null; operation = null; fresh = true; }
        else { stored = Number(value); operation = key; fresh = true; expression = pretty(value) + ' ' + symbols[key]; }
      } else if (key === '=' && operation && stored !== null) {
        expression = pretty(stored) + ' ' + symbols[operation] + ' ' + pretty(value) + ' =';
        value = format(calculate(stored, Number(value), operation));
        if (value === 'Ошибка') expression = 'На ноль делить нельзя';
        operation = null; stored = null; fresh = true;
      }
    }
    return {value: pretty(value), expression, operation};
  }
  return {input};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {createCalculator};

if (typeof document !== 'undefined') {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const desktop = $('#desktop');
  const windows = new Map($$('.app-window').map(element => [element.id, {element, opened:false, positioned:false, restore:null}]));
  let active = null, order = [], hiddenGroup = [], toastTimer, drag = null;
  const getStored = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const store = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
  }
  const paintApp=createPaintApp({windowElement:$('#paint'),onNotice:toast});
  const jumpGame=createJumpGame({windowElement:$('#jump'),portraitImage:$('#dancer-head'),onNotice:toast});
  let dashGame=null;
  function closeMenus() {
    $('#launcher').hidden = true;
    $('#start-button').setAttribute('aria-expanded','false');
    $('#context-menu').hidden = true;
  }
  function updateTasks() {
    $$('.dock-app').forEach(button => {
      const state = windows.get(button.dataset.dock);
      button.classList.toggle('running',state.opened);
      button.classList.toggle('active',state.opened && !state.element.hidden && active === button.dataset.dock);
      button.setAttribute('aria-pressed',String(!state.element.hidden && active === button.dataset.dock));
      if (button.closest('#extra-tasks')) button.hidden = !state.opened;
    });
    $('#active-app-name').textContent = active ? $('#' + active + '-title').textContent : 'Рабочий стол';
    const activeExtra=$('#extra-tasks .dock-app.active');
    if(activeExtra)activeExtra.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function focusWindow(id, focus = false) {
    if (!windows.has(id) || windows.get(id).element.hidden) return;
    active = id;
    order = order.filter(name => name !== id).concat(id);
    windows.forEach((state,name) => {
      state.element.classList.toggle('focused',name === id);
      state.element.style.zIndex = String(order.indexOf(name) + 10);
    });
    updateTasks();
    if (focus) windows.get(id).element.focus({preventScroll:true});
  }
  function focusTop() {
    const top = order.slice().reverse().find(id => !windows.get(id).element.hidden);
    if (top) focusWindow(top,true);
    else { active = null; windows.forEach(state => state.element.classList.remove('focused')); updateTasks(); }
  }
  function keepInside(state) {
    const element = state.element;
    if (element.hidden || element.classList.contains('maximized') || matchMedia('(max-width:640px)').matches) return;
    const x = parseFloat(element.style.left) || 8, y = parseFloat(element.style.top) || 8;
    element.style.left = Math.max(8,Math.min(x,desktop.clientWidth-element.offsetWidth-8)) + 'px';
    element.style.top = Math.max(8,Math.min(y,desktop.clientHeight-element.offsetHeight-8)) + 'px';
  }
  function centerWindow(state) {
    if (state.element.hidden) { state.positioned = false; return; }
    const offset = state.element.id === 'calculator' ? 90 : ['jump','dash'].includes(state.element.id) ? 0 : (Array.from(windows.keys()).indexOf(state.element.id)-2)*22;
    state.element.style.left = Math.round((desktop.clientWidth-state.element.offsetWidth)/2+offset) + 'px';
    state.element.style.top = Math.round((desktop.clientHeight-state.element.offsetHeight)/2) + 'px';
    state.positioned = true;
    keepInside(state);
  }
  function arrangeWindows() {
    windows.forEach(state => { state.element.classList.remove('maximized');state.element.style.width='';state.element.style.height='';state.restore=null;centerWindow(state); });
    $$('[data-window-action="maximize"]').forEach(button=>button.setAttribute('aria-label','Развернуть'));
    closeMenus(); toast('Окна снова по центру.');
  }
  function openApp(id) {
    const state = windows.get(id);
    if (!state) return;
    const wasHidden = state.element.hidden;
    state.opened = true;
    state.element.hidden = false;
    closeMenus();
    hiddenGroup = hiddenGroup.filter(name => name !== id);
    if (!state.positioned) centerWindow(state);
    keepInside(state);
    focusWindow(id,true);
    if (id === 'calculator' && wasHidden) startMusic();
  }
  function hideWindow(id, close = false) {
    const state = windows.get(id);
    state.element.hidden = true;
    if (close) state.opened = false;
    hiddenGroup = hiddenGroup.filter(name => name !== id);
    if (id === 'calculator') player.stop();
    if (id === 'paint') paintApp.cancelGesture();
    if (id === 'jump') jumpGame.pause();
    if (id === 'dash' && dashGame) dashGame.pause();
    if (active === id) focusTop(); else updateTasks();
  }
  function maximize(id) {
    const state = windows.get(id), element = state.element;
    if (element.classList.contains('maximized')) {
      element.classList.remove('maximized');
      if (state.restore) Object.assign(element.style,state.restore);
      keepInside(state);
    } else {
      state.restore = {left:element.style.left,top:element.style.top,width:element.style.width,height:element.style.height};
      element.classList.add('maximized');
    }
    element.querySelector('[data-window-action="maximize"]').setAttribute('aria-label',element.classList.contains('maximized')?'Восстановить размер':'Развернуть');
  }
  function showDesktop() {
    closeMenus();
    const visible = order.filter(id => !windows.get(id).element.hidden);
    if (visible.length) {
      visible.forEach(id=>hideWindow(id));
      hiddenGroup = visible;
      $('#show-desktop').focus();
    } else {
      const restore = hiddenGroup.slice(); hiddenGroup = [];
      restore.forEach(openApp);
    }
  }
  ['about','trash','paint','jump','dash'].forEach(id => {
    const button = document.createElement('button');
    button.className='dock-app'; button.dataset.dock=id;button.hidden=true;
    button.setAttribute('aria-label',$('#'+id+'-title').textContent);
    button.title = $('#'+id+'-title').textContent;
    button.innerHTML = $('#'+id+' .window-title svg').outerHTML;
    $('#extra-tasks').append(button);
  });
  $$('[data-open]').forEach(button=>button.addEventListener('click',()=>openApp(button.dataset.open)));
  $$('[data-dock]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.dock,state=windows.get(id);
    if (!state.element.hidden && active===id) hideWindow(id); else openApp(id);
  }));
  function focusDesktop() {
    active=null;windows.forEach(state=>state.element.classList.remove('focused'));updateTasks();
  }
  const iconDesktop=createDesktopIcons({
    desktop,container:$('.desktop-icons'),onOpen:openApp,onBackground:focusDesktop,onNotice:toast
  });
  $('.desktop-icons').addEventListener('pointerdown',event=>{if(event.target.closest('.desktop-icon'))focusDesktop();});
  function resetIconLayout() { iconDesktop.resetLayout();closeMenus();toast('Иконки расставлены по порядку.'); }
  $('#reset-icons').addEventListener('click',resetIconLayout);
  $('#context-icons').addEventListener('click',resetIconLayout);
  windows.forEach((state,id)=>{
    const element=state.element, handle=element.querySelector('[data-drag]');
    element.addEventListener('pointerdown',()=>focusWindow(id));
    element.addEventListener('focusin',()=>{ if(active!==id) focusWindow(id); });
    element.querySelectorAll('[data-window-action]').forEach(button=>button.addEventListener('click',()=>{
      const action=button.dataset.windowAction;
      if(action==='maximize') maximize(id); else hideWindow(id,action==='close');
    }));
    handle.addEventListener('dblclick',event=>{if(!event.target.closest('button')) maximize(id);});
    handle.addEventListener('pointerdown',event=>{
      if(event.target.closest('button') || event.button!==0 || element.classList.contains('maximized') || matchMedia('(max-width:640px)').matches) return;
      drag={id,px:event.clientX,py:event.clientY,x:parseFloat(element.style.left)||0,y:parseFloat(element.style.top)||0};
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag || drag.id!==id) return;
      element.style.left=(drag.x+event.clientX-drag.px)+'px';
      element.style.top=(drag.y+event.clientY-drag.py)+'px';
      keepInside(state);
    });
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>handle.addEventListener(type,()=>{drag=null;}));
  });
  if(typeof ResizeObserver==='function') {
    const observer=new ResizeObserver(entries=>entries.forEach(entry=>{const state=windows.get(entry.target.id);if(state)keepInside(state);}));
    windows.forEach(state=>observer.observe(state.element));
  }
  window.addEventListener('resize',()=>{drag=null;windows.forEach(keepInside);});
  $('#start-button').addEventListener('click',()=>{
    const open=$('#launcher').hidden; closeMenus(); $('#launcher').hidden=!open;
    $('#start-button').setAttribute('aria-expanded',String(open));
  });
  $('#show-desktop').addEventListener('click',showDesktop);
  $('#launcher-desktop').addEventListener('click',showDesktop);
  $('#reset-windows').addEventListener('click',arrangeWindows);
  $('#context-arrange').addEventListener('click',arrangeWindows);
  $('#context-hide').addEventListener('click',showDesktop);
  $('#dismiss-welcome').addEventListener('click',()=>{ $('#welcome-card').hidden=true;store('havanagila-welcome-dismissed','true'); });
  $('#welcome-card').hidden=getStored('havanagila-welcome-dismissed')==='true';
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('#launcher,#start-button,#context-menu'))closeMenus();
  });
  desktop.addEventListener('contextmenu',event=>{
    if(event.target.closest('.app-window,input,textarea'))return;
    event.preventDefault();closeMenus();const menu=$('#context-menu');menu.hidden=false;
    menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-70))+'px';
  });

  // The dance uses the same AudioContext clock as the tune, not an independent CSS timer.
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let danceEnabled=getStored('havanagila-dance',String(!reducedMotion.matches))==='true';
  let danceFrame=0,player;
  let beatEnabled=getStored('havanagila-system-beat','true')==='true';
  function clearSystemBeat() {
    document.body.classList.remove('beat-active');
    document.documentElement.style.setProperty('--system-beat','0');
  }
  function updateBeatSetting() {
    $('#beat-setting').checked=beatEnabled && !reducedMotion.matches;
    $('#beat-setting').disabled=reducedMotion.matches;
    $('#beat-setting-hint').textContent=reducedMotion.matches
      ? 'Отключено: в системе включено уменьшение движения'
      : 'Мягкое свечение обоев, окон и иконок';
    if(!beatEnabled || reducedMotion.matches)clearSystemBeat();
  }
  $('#beat-setting').addEventListener('change',event=>{
    beatEnabled=event.target.checked;store('havanagila-system-beat',String(beatEnabled));updateBeatSetting();
  });
  reducedMotion.addEventListener('change',updateBeatSetting);
  updateBeatSetting();
  const dancer=$('#dancer'),head=$('#dancer-head'),stage=$('#dance-stage');
  const bars=$$('.equalizer i'),miniBars=$$('.mini-equalizer i');
  function resetDance() {
    cancelAnimationFrame(danceFrame);danceFrame=0;clearSystemBeat();
    dancer.style.transform='';head.style.transform='';stage.style.setProperty('--pulse','0');
    bars.forEach(bar=>bar.style.height='3px');miniBars.forEach(bar=>bar.style.transform='');
    $$('.floating-note').forEach(note=>note.style.translate='');
  }
  function animateDance() {
    if(!player || !player.getState().playing || $('#calculator').hidden){resetDance();return;}
    const position=player.getBeatPosition()||0;
    const audioState=player.getState();
    const glowActive=beatEnabled && danceEnabled && !reducedMotion.matches && audioState.volume>0 && audioState.contextState==='running';
    document.body.classList.toggle('beat-active',glowActive);
    // Smooth, continuous envelope with one gentle crest per quarter-note beat.
    const glow=glowActive?Math.pow((1+Math.cos(position*2*Math.PI))/2,2):0;
    document.documentElement.style.setProperty('--system-beat',glow.toFixed(4));
    const swing=Math.sin(position*Math.PI),bounce=Math.abs(swing),pulse=Math.pow(1-(position%1),3);
    if(danceEnabled) {
      dancer.style.transform='translate('+ (swing*7).toFixed(2)+'px,'+(-bounce*8).toFixed(2)+'px) rotate('+(swing*6).toFixed(2)+'deg)';
      head.style.transform='rotate('+(-swing*7).toFixed(2)+'deg) translateY('+(-pulse*2).toFixed(2)+'px)';
      stage.style.setProperty('--pulse',pulse.toFixed(3));
    } else {dancer.style.transform='';head.style.transform='';stage.style.setProperty('--pulse','0');}
    if(!reducedMotion.matches) {
      bars.forEach((bar,index)=>bar.style.height=(3+9*Math.abs(Math.sin(position*Math.PI+index*.62))).toFixed(1)+'px');
      miniBars.forEach((bar,index)=>bar.style.transform='scaleY('+(0.5+Math.abs(Math.sin(position*Math.PI+index))).toFixed(2)+')');
      $$('.floating-note').forEach((note,index)=>note.style.translate='0 '+(-bounce*(index?4:8)).toFixed(2)+'px');
    }
    danceFrame=requestAnimationFrame(animateDance);
  }
  function musicState(state) {
    stage.classList.toggle('playing',state.playing);
    stage.dataset.playing=String(state.playing);
    $('#taskbar-music').classList.toggle('playing',state.playing);
    $('#music-toggle').setAttribute('aria-pressed',String(state.playing));
    $('#music-toggle').setAttribute('aria-label',state.playing?'Приостановить музыку':'Включить Хава Нагила');
    $('#music-toggle use').setAttribute('href',state.playing?'#pause-icon':'#play-icon');
    $('#music-status').textContent=state.playing?'Синтез-версия · сейчас играет':state.error?'Нажмите ▶ для запуска':'Синтез-версия · на паузе';
    $('#stage-status').textContent=state.playing?'LIVE · HAVA NAGILA':'BIBI DANCE CLUB';
    $('#taskbar-track').textContent=state.playing?'Hava Nagila':'Время для музыки';
    $('#taskbar-play').textContent=state.playing?'Ⅱ':'▶';
    $('#taskbar-music').setAttribute('aria-label',state.playing?'Приостановить Хава Нагила':'Включить Хава Нагила в калькуляторе');
    $('#bpm-label').textContent=state.bpm+' BPM';
    if(state.playing && !danceFrame) danceFrame=requestAnimationFrame(animateDance);
    if(!state.playing)resetDance();
    if(!state.volume || state.contextState!=='running')clearSystemBeat();
  }
  player=createHavaPlayer({onState:musicState,onBeat:beat=>{stage.dataset.beat=String(beat.beat);}});
  dashGame=createDashGame({windowElement:$('#dash'),portraitImage:$('#dancer-head'),onNotice:toast,onBeforePlay:()=>player.stop()});
  async function startMusic() {
    if(dashGame)dashGame.pause();
    const started=await player.start();
    if(!started && !$('#calculator').hidden)toast('Звук пока недоступен. Нажмите ▶ в калькуляторе или разрешите звук в браузере.');
  }
  function toggleMusic() { if(player.getState().playing)player.stop();else startMusic(); }
  $('#music-toggle').addEventListener('click',toggleMusic);
  $('#taskbar-music').addEventListener('click',()=>{ if($('#calculator').hidden)openApp('calculator');else toggleMusic(); });
  function updateDance() {
    $('#dance-setting').checked=danceEnabled;
    $('#dance-toggle').textContent='Танец: '+(danceEnabled?'вкл.':'выкл.');
    $('#dance-toggle').setAttribute('aria-pressed',String(danceEnabled));
    document.body.classList.toggle('music-disabled',!danceEnabled);
    if(!danceEnabled){dancer.style.transform='';head.style.transform='';clearSystemBeat();}
  }
  $('#dance-toggle').addEventListener('click',()=>{danceEnabled=!danceEnabled;store('havanagila-dance',String(danceEnabled));updateDance();});
  $('#dance-setting').addEventListener('change',event=>{danceEnabled=event.target.checked;store('havanagila-dance',String(danceEnabled));updateDance();});
  updateDance();
  function setVolume(value) {
    const volume=Math.max(0,Math.min(100,Number(value)||0));
    $('#volume').value=String(volume);$('#settings-volume').value=String(volume);$('#volume-label').textContent=volume+'%';
    player.setVolume(volume/100);store('havanagila-volume',String(volume));
  }
  setVolume(getStored('havanagila-volume','35'));
  ['#volume','#settings-volume'].forEach(selector=>$(selector).addEventListener('input',event=>setVolume(event.target.value)));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)player.stop();});
  window.addEventListener('pagehide',()=>player.stop());

  const calculator=createCalculator();
  function press(key) {
    const state=calculator.input(key);
    $('#display').textContent=state.value;
    $('#display').style.fontSize=state.value.length>10?'29px':'43px';
    $('#expression').textContent=state.expression;
    $$('.operator').forEach(button=>button.classList.toggle('selected',button.dataset.key===state.operation));
  }
  $$('[data-key]').forEach(button=>button.addEventListener('click',()=>press(button.dataset.key)));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && (!$('#launcher').hidden || !$('#context-menu').hidden)) {
      closeMenus();$('#start-button').focus();event.preventDefault();return;
    }
    if(active!=='calculator' || $('#calculator').hidden || !$('#launcher').hidden || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('textarea,input,[contenteditable]'))return;
    if(event.key==='Enter' && event.target.closest('button,a') && !event.target.closest('[data-key]'))return;
    const aliases={Enter:'=',Escape:'clear',Backspace:'backspace',Delete:'clear',',':'.','%':'percent'};
    const key=aliases[event.key]||event.key;
    if(/^[0-9.+*/=-]$/.test(key) || ['clear','backspace','percent'].includes(key)){event.preventDefault();press(key);}
  });

  const notes=$('#notes-text');notes.value=getStored('havanagila-notes','');
  let trashed=getStored('havanagila-trash','');
  function countNotes() {
    $('#char-count').textContent=notes.value.length+' символов';
    $('#file-size').textContent=notes.value.length+' символов · локальная заметка';
    $('#trash-notes').disabled=!notes.value;
  }
  function saveNotes() {
    countNotes();
    $('#save-status').textContent=store('havanagila-notes',notes.value)?'Сохранено на этом устройстве ✓':'Не удалось сохранить — скопируйте текст';
  }
  notes.addEventListener('input',saveNotes);countNotes();
  createNotesReaction({textarea:notes,notesWindow:$('#notes'),overlay:$('#notes-reaction'),setting:$('#notes-reaction-setting')});
  function updateTrash() {
    $('#trash-heading').textContent=trashed?'Моя заметка.txt':'Здесь пока чисто.';
    $('#trash-description').textContent=trashed?trashed.length+' символов. Заметку можно восстановить.':'Удалённая заметка появится здесь. Её можно будет восстановить.';
    $('#restore-notes').disabled=!trashed;$('#empty-trash').disabled=!trashed;
    $('.desktop-icon[data-app="trash"] .icon-label').textContent=trashed?'Корзина (1)':'Корзина';
  }
  $('#trash-notes').addEventListener('click',()=>{
    if(!notes.value)return;
    if(trashed && !confirm('В корзине уже есть заметка. Заменить её текущей?'))return;
    trashed=notes.value;notes.value='';store('havanagila-trash',trashed);saveNotes();updateTrash();toast('Заметка в корзине. Её можно восстановить.');
  });
  $('#restore-notes').addEventListener('click',()=>{
    if(!trashed)return;
    notes.value=notes.value?notes.value+'\n\n'+trashed:trashed;trashed='';store('havanagila-trash','');saveNotes();updateTrash();openApp('notes');toast('Заметка восстановлена.');
  });
  $('#empty-trash').addEventListener('click',()=>{
    if(trashed && confirm('Удалить заметку из корзины без возможности восстановления?')){trashed='';store('havanagila-trash','');updateTrash();toast('Корзина очищена.');}
  });
  $('#export-notes').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([notes.value],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='Моя заметка.txt';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });updateTrash();
  function setTheme(evening) {
    document.body.classList.toggle('evening',evening);
    $$('[data-theme]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.theme==='evening')===evening)));
    store('havanagila-evening',String(evening));
  }
  setTheme(getStored('havanagila-evening')==='true');
  $$('[data-theme]').forEach(button=>button.addEventListener('click',()=>setTheme(button.dataset.theme==='evening')));
  function updateClock() {
    const now=new Date(),time=now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    ['#clock','#widget-clock'].forEach(selector=>{$(selector).textContent=time;$(selector).dateTime=now.toISOString();});
    $('#clock').title=now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
    $('#widget-weekday').textContent=now.toLocaleDateString('ru-RU',{weekday:'long'});
    $('#widget-date').textContent=now.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  }
  if(matchMedia('(pointer:coarse)').matches) $('.desktop-instructions').textContent='Коснитесь иконки, чтобы открыть приложение';
  updateClock();setInterval(updateClock,1000);updateTasks();
}
