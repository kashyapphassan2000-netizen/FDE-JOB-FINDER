/**
 * The form filler that runs ON the application page (bookmarklet / local runner). Plain browser JS as a string so both
 * can inject it. Matches every visible field by its label to (1) the job's kit answers, (2) your apply profile; fills text,
 * textareas, dropdowns, yes/no radios; works with React-controlled inputs. Never touches the submit button.
 */
export const FILLER_SRC = String.raw`function fdeFill(d){
  var P=d.profile||{}, K=(d.kit&&d.kit.fields)||[];
  var norm=function(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();};
  var labelOf=function(el){var t='';try{if(el.id){var l=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');if(l)t+=l.innerText;}}catch(e){}
    var pl=el.closest('label');if(pl)t+=' '+pl.innerText;t+=' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')+' '+(el.name||'').replace(/[_\[\]]/g,' ');
    var box=el.closest('.field,.application-question,.application-field,fieldset,[class*="question"],[class*="Question"],[class*="field"],[class*="Field"]');
    if(box){var lb=box.querySelector('label,legend,[class*="label"],[class*="Label"]');if(lb)t+=' '+lb.innerText;}return norm(t);};
  var setVal=function(el,v){var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var set=Object.getOwnPropertyDescriptor(proto,'value').set;set.call(el,v);
    ['input','change','blur'].forEach(function(n){el.dispatchEvent(new Event(n,{bubbles:true}));});};
  var R=[[/first name|given name|\bfname\b/,P.firstName],[/last name|surname|family name|\blname\b/,P.lastName],[/full name|^name$|^name |your name|candidate name|legal name/,P.fullName],[/e ?mail/,P.email],[/phone|mobile|contact number/,P.phone],
    [/linkedin/,P.linkedin],[/github/,P.github],[/portfolio|website|personal site|blog/,P.website],[/current (company|employer|organi[sz]ation)|present employer|most recent (company|employer)/,P.currentCompany],
    [/current (title|role|designation|position)|most recent (title|role)/,P.currentTitle],[/years? of (relevant |professional )?experience|total experience|experience in years/,P.years],[/notice period|earliest start|when can you (start|join)/,P.noticePeriod],
    [/current (ctc|salary|compensation)/,P.currentCtc],[/expected (ctc|salary|compensation)|salary expectation|desired (salary|compensation)|compensation expectation/,P.expectedCtc],
    [/sponsor|visa|work authori[sz]ation|authori[sz]ed to work|right to work|legally (able|eligible)/,P.workAuth],[/relocat/,P.relocate],[/how did you hear|where did you (find|hear|see)|source of application/,P.heardFrom],
    [/pronoun/,P.pronouns],[/(current )?location|city|where are you (based|located)/,P.location]];
  var filled=0,need=[];
  var els=Array.prototype.slice.call(document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=search]),textarea,select'))
    .filter(function(el){return !el.disabled&&!el.readOnly&&(el.offsetParent!==null||el.type==='radio'||el.type==='checkbox');});
  var used={};
  els.forEach(function(el){
    var isChoice=el.type==='radio'||el.type==='checkbox';
    if(!isChoice&&el.tagName!=='SELECT'&&el.value)return;
    var lab=labelOf(el);if(!lab)return;
    var v=null,best=0;
    K.forEach(function(f){var q=norm(f.label);if(!q||!f.answer)return;var w=q.split(' ').filter(function(x){return x.length>3;});if(!w.length)w=q.split(' ');
      var hit=w.filter(function(x){return lab.indexOf(x)>=0;}).length/w.length;if(hit>best&&hit>=0.6){best=hit;v=f.answer;}});
    if(v==null)for(var i=0;i<R.length;i++){if(R[i][1]&&R[i][0].test(lab)){v=R[i][1];break;}}
    if(v==null||v==='')return;v=String(v);
    if(el.tagName==='SELECT'){var o=Array.prototype.find.call(el.options,function(o){return norm(o.text)===norm(v);})||Array.prototype.find.call(el.options,function(o){var t=norm(o.text);return t.length>1&&(t.indexOf(norm(v))>=0||norm(v).indexOf(t)>=0);});
      if(o){el.value=o.value;el.dispatchEvent(new Event('change',{bubbles:true}));filled++;}else need.push(lab.slice(0,60));return;}
    if(isChoice){var opt=norm((el.closest('label')||{}).innerText||el.getAttribute('aria-label')||el.value);var nv=norm(v);
      if(opt&&!used[el.name]&&(nv===opt||(/^yes\b|^true$/.test(nv)&&/^yes\b|^true$/.test(opt))||(/^no\b|^false$/.test(nv)&&/^no\b|^false$/.test(opt)))){el.click();used[el.name]=1;filled++;}return;}
    setVal(el,v);filled++;});
  var cover=document.querySelector('textarea[name*="cover" i],textarea[id*="cover" i],textarea[aria-label*="cover" i]');
  if(cover&&!cover.value&&d.kit&&d.kit.coverLetter){setVal(cover,d.kit.coverLetter);filled++;}
  return {filled:filled,need:need.slice(0,12)};
}`;

/** Bookmarklet source: loads your answers for THIS page from the app (token) and fills it; shows what is left for you. */
export function bookmarklet(origin: string, token: string, embeddedProfile: Record<string, string>): string {
  const code = `(async function(){var F=${FILLER_SRC};var d={profile:${JSON.stringify(embeddedProfile)}};try{var r=await fetch(${JSON.stringify(origin)}+'/api/apply/runner?u='+encodeURIComponent(location.href),{headers:{Authorization:'Bearer ${token}'}});if(r.ok)d=await r.json();}catch(e){}var out=F(d);var b=document.createElement('div');b.style.cssText='position:fixed;z-index:2147483647;top:12px;right:12px;max-width:340px;background:#0d1424;color:#fff;font:13px system-ui;padding:12px 14px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)';b.innerHTML='<b style="color:#00f0a0">FDE autofill</b><br>Filled '+out.filled+' fields'+(d.kit?' using your answers for this job':' (profile only — prepare a kit for this job in the app for its custom questions)')+'.<br>Now: attach your CV, check every answer'+(out.need.length?', and fill: '+out.need.join(', '):'')+', then submit yourself.<br><small style="opacity:.7">click to close</small>';b.onclick=function(){b.remove();};document.body.appendChild(b);})();`;
  return `javascript:${encodeURIComponent(code)}`;
}
