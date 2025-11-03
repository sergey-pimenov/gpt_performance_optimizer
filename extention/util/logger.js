(function(){
  'use strict';
  // Lightweight logger with in-memory buffer and opt-in console verbosity
  const NS = '[ChatGPT-Opt]';
  const MAX_BUFFER = 1000; // keep last N entries
  const LS_VERBOSE_KEY = 'cl:log:verbose'; // set to '1' to enable console output

  const buffer = [];

  function isVerbose(){
    try { return localStorage.getItem(LS_VERBOSE_KEY) === '1'; } catch { return false; }
  }

  function setVerbose(on){
    try {
      if (on) localStorage.setItem(LS_VERBOSE_KEY, '1');
      else localStorage.removeItem(LS_VERBOSE_KEY);
    } catch {}
  }

  function push(level, args){
    try{
      const entry = { ts: Date.now(), level, args: Array.from(args) };
      buffer.push(entry);
      if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);

      if (isVerbose()){
        const m = level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'log');
        try { console[m](NS, ...entry.args); } catch {}
      }
    }catch{}
  }

  function LOG(){ push('log', arguments); }
  function WARN(){ push('warn', arguments); }
  function ERROR(){ push('error', arguments); }

  function getLogs(){ return buffer.slice(); }
  function clear(){ buffer.length = 0; }
  function dump(){
    try{
      console.group(`${NS} buffered (${buffer.length})`);
      buffer.forEach(e=>{
        const m = e.level === 'error' ? 'error' : (e.level === 'warn' ? 'warn' : 'log');
        console[m](NS, new Date(e.ts).toISOString(), ...e.args);
      });
      console.groupEnd();
    }catch{}
  }

  // Expose API
  window.TailLog = { NS, LOG, WARN, ERROR, buffer, getLogs, clear, dump, isVerbose, setVerbose };
})();
