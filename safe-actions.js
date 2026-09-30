(function(){
'use strict';
const trustedSanitizer=(()=>{
  const sanitize=(input)=>{
    let html=String(input??'');
    // Keep the Trusted Types policy callback free of DOM/HTML parser sinks.
    // Those sinks would invoke the default policy again and recurse.
    html=html.replace(/<\s*(script|iframe|object|embed|base|meta|link)(?:\s[^>]*)?>[\s\S]*?<\s*\/\s*\\1\s*>/gi,'');
    html=html.replace(/<\s*(script|iframe|object|embed|base|meta|link)(?:\s[^>]*)?\/\s*>/gi,'');
    html=html.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'');
    html=html.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'');
    html=html.replace(/\s+(href|src|action|formaction|xlink:href)\s*=\s*(["'])\s*(?:javascript|vbscript):[^"']*\\2/gi,'');
    html=html.replace(/\s+(href|src|action|formaction|xlink:href)\s*=\s*(?:javascript|vbscript):[^\s>]+/gi,'');
    return html;
  };
  try{
    if(window.trustedTypes)return window.trustedTypes.createPolicy('default',{createHTML:sanitize});
  }catch{}
  return {createHTML:sanitize};
})();
function splitTop(input,separator=','){
  const out=[];let start=0,depth=0,quote=null,escape=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(escape){escape=false;continue}
    if(ch==='\\'){escape=true;continue}
    if(quote){if(ch===quote)quote=null;continue}
    if(ch==="'"||ch=='"'){quote=ch;continue}
    if(ch==='('||ch==='['||ch==='{')depth++;
    else if(ch===')'||ch===']'||ch==='}')depth--;
    else if(ch===separator&&depth===0){out.push(input.slice(start,i).trim());start=i+1}
  }
  out.push(input.slice(start).trim());return out.filter(Boolean);
}
function resolve(expr,el,event){
  expr=String(expr||'').trim().replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  if(expr==='this')return el;
  if(expr==='event')return event;
  if(expr==='true')return true;if(expr==='false')return false;if(expr==='null')return null;
  if(/^['"].*['"]$/.test(expr))return expr.slice(1,-1);
  if(/^Number\((.*)\)$/.test(expr)){const n=Number(resolve(expr.slice(7,-1),el,event));return Number.isFinite(n)?n:0}
  const div=splitTop(expr,'/');if(div.length===2){const a=Number(resolve(div[0],el,event)),b=Number(resolve(div[1],el,event));return b?a/b:0}
  const plus=splitTop(expr,'+');if(plus.length>1)return plus.map(x=>resolve(x,el,event)).join('');
  let m=expr.match(/^this\.(value|checked)$/);if(m)return el[m[1]];
  if(expr==='this.files[0]')return el.files?.[0]||null;
  m=expr.match(/^document\.getElementById\((['"])(.*?)\1\)\.(value|checked|textContent)$/);
  if(m){const node=document.getElementById(m[2]);return node?node[m[3]]:null}
  return expr;
}
function setState(name,value){
  if(typeof window.__cspSetState==='function')window.__cspSetState(name,value);
}
function execute(code,el,event){
  code=String(code||'').trim();
  if(!code)return;
  if(code.startsWith('if(event.target===this)')){
    const rest=code.replace(/^if\(event\.target===this\)/,'').trim();
    if(event.target!==el)return;
    return execute(rest,el,event);
  }
  if(code==='event.stopPropagation()'){event.stopPropagation();return}
  if(code==='this.closest(" .qr-modal").remove()'||code==='this.closest(".qr-modal").remove()'){el.closest('.qr-modal')?.remove();return}
  if(/^document\.getElementById\((['"])(.*?)\1\)\.scrollIntoView/.test(code)){
    const m=code.match(/^document\.getElementById\((['"])(.*?)\1\)/);document.getElementById(m[2])?.scrollIntoView({behavior:'smooth'});return;
  }
  const stmts=splitTop(code,';');
  for(const stmt of stmts){
    if(!stmt)continue;
    if(stmt==='event.stopPropagation()'){event.stopPropagation();continue}
    if(/^if\(event\.target===this\)/.test(stmt)){execute(stmt,el,event);continue}
    if(/^document\.getElementById\((['"])(.*?)\1\)\.textContent=/.test(stmt)){
      const m=stmt.match(/^document\.getElementById\((['"])(.*?)\1\)\.textContent=(.*)$/);
      if(m){const node=document.getElementById(m[2]);if(node)node.textContent=resolve(m[3],el,event);continue}
    }
    if(/\.then\(\(\)=>/.test(stmt)){
      const m=stmt.match(/^([A-Za-z_$][\w$]*)\(\)\.then\(\(\)=>\s*([A-Za-z_$][\w$]*)\(\)\)$/);
      if(m){Promise.resolve(window[m[1]]?.()).then(()=>window[m[2]]?.());continue}
    }
    const assign=stmt.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
    if(assign){setState(assign[1],resolve(assign[2],el,event));continue}
    const call=stmt.match(/^([A-Za-z_$][\w$]*)\((.*)\)$/);
    if(call){
      const fn=window[call[1]];
      if(typeof fn!=='function')continue;
      fn(...splitTop(call[2]).map(x=>resolve(x,el,event)));
      continue;
    }
    const remove=stmt.match(/^this\.closest\((['"])(.*?)\1\)\.remove\(\)$/);
    if(remove){el.closest(remove[2])?.remove();continue}
  }
}
function bind(){
  document.addEventListener('click',e=>{
    const el=e.target.closest?.('[data-action]');if(!el)return;
    execute(el.getAttribute('data-action'),el,e);
  });
  document.addEventListener('change',e=>{
    const el=e.target.closest?.('[data-change]');if(!el)return;
    execute(el.getAttribute('data-change'),el,e);
  });
  document.addEventListener('input',e=>{
    const el=e.target.closest?.('[data-input]');if(!el)return;
    execute(el.getAttribute('data-input'),el,e);
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();