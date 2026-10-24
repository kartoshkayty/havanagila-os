/* Local, deterministic easter egg. Never modifies, uploads, or blocks notes. */
(function(root){
  'use strict';
  const countries=new Set(['израиль','израель','израил','израел','израэль','israel']);
  const opinions=new Set(['плохой','плохая','плохое','плохие','плох','плохо','отстой','ужасный','ужасная','ужасен','зло','ненавижу','bad','terrible','awful','sucks','hate']);
  const fillers=new Set(['очень','просто','это','реально','совсем','довольно','такой','такая','самый','самая','он','страна','is','so','very','really','totally','a','i']);
  const negatives=new Set(['не','нет','ни','not','never','dont','don’t',"don't"]);
  function findNotesReaction(text){
    const normalized=String(text||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[​-‏﻿]/g,'');
    const sentences=normalized.split(/[.!?;\n\r]+/);
    for(const sentence of sentences){
      const tokens=sentence.match(/[а-яa-z]+(?:['’][a-z]+)?/g)||[];
      for(let i=0;i<tokens.length;i++){
        if(!countries.has(tokens[i]))continue;
        for(let j=Math.max(0,i-4);j<=Math.min(tokens.length-1,i+4);j++){
          if(!opinions.has(tokens[j]))continue;
          const left=Math.min(i,j),right=Math.max(i,j);
          if(tokens.slice(Math.max(0,left-3),right+1).some(token=>negatives.has(token)))continue;
          if(tokens.slice(left+1,right).every(token=>fillers.has(token)))return true;
        }
      }
    }
    return false;
  }
  function createNotesReaction({textarea,notesWindow,overlay,setting}){
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const key='havanagila-notes-reaction';
    let enabled=true,armed=!findNotesReaction(textarea.value),cooldownUntil=0;
    let checkTimer=0,endTimer=0,frame=0,active=false,sequence=0,composing=false;
    try{enabled=localStorage.getItem(key)!=='false';}catch{/* Works without storage. */}
    setting.checked=enabled;
    function stop(){
      clearTimeout(checkTimer);clearTimeout(endTimer);cancelAnimationFrame(frame);
      checkTimer=endTimer=frame=0;active=false;overlay.hidden=true;
      document.body.classList.remove('notes-reaction-active');
    }
    function position(){
      if(!active)return;
      if(notesWindow.hidden || document.hidden){stop();return;}
      const rect=notesWindow.getBoundingClientRect();
      const topbar=document.querySelector('.menubar').getBoundingClientRect().bottom;
      const tray=document.querySelector('.taskbar').getBoundingClientRect().top;
      const width=Math.min(284,innerWidth-24),height=142;
      const left=Math.max(12,Math.min(rect.right-width-12,innerWidth-width-12));
      // Emerge above the titlebar when there is room; stay in view on small/maximized windows.
      const top=Math.max(topbar+5,Math.min(rect.top-height+12,tray-height-5));
      overlay.style.left=left+'px';overlay.style.top=top+'px';overlay.style.width=width+'px';
      overlay.classList.toggle('reaction-inset',rect.top-height+12<topbar+5);
      frame=requestAnimationFrame(position);
    }
    function fire(){
      if(active || !enabled || notesWindow.hidden || document.hidden)return;
      armed=false;cooldownUntil=performance.now()+6000;
      active=true;overlay.hidden=false;overlay.dataset.sequence=String(++sequence);
      document.body.classList.add('notes-reaction-active');
      overlay.querySelector('[role="status"]').textContent='Биби не согласен! Это только шутка — текст заметки не изменён.';
      position();endTimer=setTimeout(stop,2800);
    }
    function check(){
      checkTimer=0;
      if(!enabled || composing || notesWindow.hidden || document.hidden)return;
      const matched=findNotesReaction(textarea.value);
      if(!matched){armed=true;return;}
      if(!armed || active)return;
      const remaining=cooldownUntil-performance.now();
      if(remaining>0){checkTimer=setTimeout(check,remaining+20);return;}
      fire();
    }
    function input(event){
      clearTimeout(checkTimer);
      if(event.isComposing || composing)return;
      // Arm again as soon as the matching phrase disappears, including paste/undo.
      if(!findNotesReaction(textarea.value))armed=true;
      if(enabled)checkTimer=setTimeout(check,420);
    }
    function compositionStart(){composing=true;clearTimeout(checkTimer);}
    function compositionEnd(){composing=false;input({});}
    function settingChanged(){
      enabled=setting.checked;
      try{localStorage.setItem(key,String(enabled));}catch{}
      stop();armed=!findNotesReaction(textarea.value);
    }
    function visibility(){if(document.hidden)stop();}
    function escape(event){if(event.key==='Escape' && active){stop();event.preventDefault();}}
    function focus(event){const window=event.target.closest && event.target.closest('.app-window');if(active && window && window!==notesWindow)stop();}
    function motionChanged(){if(active)stop();}
    const observer=new MutationObserver(()=>{if(notesWindow.hidden)stop();});
    observer.observe(notesWindow,{attributes:true,attributeFilter:['hidden']});
    textarea.addEventListener('input',input);
    textarea.addEventListener('compositionstart',compositionStart);
    textarea.addEventListener('compositionend',compositionEnd);
    setting.addEventListener('change',settingChanged);
    document.addEventListener('visibilitychange',visibility);
    document.addEventListener('keydown',escape);
    document.addEventListener('focusin',focus);
    window.addEventListener('pagehide',stop);
    motion.addEventListener('change',motionChanged);
    return {stop,destroy(){
      stop();observer.disconnect();
      textarea.removeEventListener('input',input);textarea.removeEventListener('compositionstart',compositionStart);textarea.removeEventListener('compositionend',compositionEnd);
      setting.removeEventListener('change',settingChanged);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',escape);document.removeEventListener('focusin',focus);
      window.removeEventListener('pagehide',stop);motion.removeEventListener('change',motionChanged);
    }};
  }
  root.createNotesReaction=createNotesReaction;
  if(typeof module!=='undefined' && module.exports)module.exports={findNotesReaction,createNotesReaction};
})(typeof window!=='undefined'?window:globalThis);
