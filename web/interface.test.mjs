import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../Space-Health.html',import.meta.url),'utf8');
class Element{
 constructor(){this.children=[];this.listeners={};this.style={setProperty(){}};this.classList={toggle(){},contains(){return false},add(){}};this.value='';this.textContent='';this.hidden=false;this.disabled=false;}
 addEventListener(name,fn){this.listeners[name]=fn;}append(...x){this.children.push(...x);}prepend(x){this.children.unshift(x);}replaceChildren(){this.children=[];}setAttribute(){}getBoundingClientRect(){return {width:0,height:0};}querySelector(){return new Element();}setCustomValidity(){}reportValidity(){}getContext(){return null;}
}
function browser(scenario='station',auto=true){
 const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));elements.scenario.value=scenario;elements.task.value='repair';elements.name.value='<Мирзо>';elements.autopilot.checked=auto;
 let tick;const context={document:{getElementById:id=>{assert.ok(elements[id],id);return elements[id]},createElement:()=>new Element(),createTextNode:text=>text,querySelectorAll:selector=>Array.from({length:selector==='.metric'?3:5},()=>new Element())},window:{addEventListener(){},localStorage:{data:{},getItem(key){return this.data[key]||null;},setItem(key,value){this.data[key]=value;}}},setInterval:fn=>{tick=fn;return 1},clearInterval(){},console,Blob,URL,setTimeout,structuredClone,TextEncoder,atob};
 vm.createContext(context);vm.runInContext(html.split('<script>')[1].split('</script>')[0],context);
 return {elements,context,start(){elements.entry.listeners.submit({preventDefault(){}})},tick(){tick();},click(id){elements[id].listeners.click();},value(code){return vm.runInContext(code,context);}};
}
function examineAll(b){for(const id of ['c1','c2','c3','c4']){b.elements['medical-member'].value=id;b.elements['medical-member'].listeners.change();b.elements['daily-exam-form'].listeners.submit({preventDefault(){}});}}
test('all three offline missions run through 90 seconds, auto assign and produce crew/timeline reports',()=>{
 for(const scenario of ['station','surface','emergency']){const b=browser(scenario);b.start();assert.equal(b.value('mission.preflight'),null);b.tick();assert.equal(b.value('mission.elapsed'),0);examineAll(b);assert.equal(b.elements['crew-table-body'].children.length,4);assert.equal(b.elements['scene-fallback'].hidden,false);assert.ok(b.elements['assignment-title'].textContent.includes('Проверка'));for(let i=0;i<90;i++)b.tick();assert.equal(b.elements.result.hidden,false);assert.equal(b.elements['report-crew'].children.length,4);assert.ok(b.elements['report-timeline'].children.length>5);assert.ok(b.value('report.completed.length')>=1);assert.equal(b.value('report.seconds'),90);assert.equal(b.value('report.crew[0].history.length'),90);assert.equal(b.value('report.crew[0].name'),'<Мирзо>');}
});
test('manual preflight, assign, cancellation, rest, global pause and restart work',()=>{
 const b=browser('station',false);b.start();examineAll(b);assert.equal(b.elements.assign.disabled,true);b.click('preflight');for(let i=0;i<4;i++)b.tick();assert.equal(b.elements.assign.disabled,false);b.click('assign');assert.equal(b.value('mission.assignment.status'),'working');const second=b.value('mission.elapsed');b.click('pause');b.tick();assert.equal(b.value('mission.elapsed'),second);b.click('pause');b.tick();assert.equal(b.value('mission.elapsed'),second+1);b.click('rest-member');assert.equal(b.value('mission.assignment.status'),'cancelled');assert.equal(b.elements.autopilot.checked,false);b.click('finish');assert.equal(b.elements.result.hidden,false);b.click('back-monitor');assert.equal(b.elements.dashboard.hidden,false);assert.equal(b.elements.pause.disabled,true);b.click('restart');assert.equal(b.value('mission.elapsed'),0);assert.equal(b.elements.pause.disabled,false);
});
test('technical astronaut and 3D canvas are bundled without remote resources',()=>{
 assert.ok(html.includes('SUIT / MK-IV'));assert.ok(html.includes('id="mission-3d"'));assert.ok(!/<script[^>]*src=/.test(html));assert.ok(!/<link[^>]*stylesheet/.test(html));assert.ok(!/^import /m.test(html));
});
test('daily UI locks duplicate exams, persists history, builds plans and prepares fixed participants',()=>{
 const b=browser('station',false);b.start();examineAll(b);assert.equal(b.value('medicalBook.exams.length'),4);assert.equal(b.elements['save-exam'].disabled,true);b.elements['daily-exam-form'].listeners.submit({preventDefault(){}});assert.equal(b.value('medicalBook.exams.length'),4);assert.ok(b.elements['exam-feedback'].textContent.includes('Повторная'));
 b.click('generate-day-plan');assert.ok(b.elements['daily-plan-results'].children.length===4);assert.equal(b.value('medicalUI.plan.rows[0].status'),'planned');b.click('save-day-plan');assert.ok(b.value('!!medicalBook.plans[medicalBook.today()]'));
 const card=b.elements['daily-plan-results'].children[0],execute=card.children.at(-1);execute.listeners.click();assert.equal(b.value('mission.preflight.planned.ids[0]'),b.value('medicalUI.plan.rows[0].ids[0]'));for(let i=0;i<4;i++)b.tick();b.click('assign');assert.equal(b.value('mission.assignment.ids[0]'),b.value('medicalUI.plan.rows[0].ids[0]'));
 b.elements['medical-member'].value='c1';b.elements['medical-member'].listeners.change();assert.equal(b.elements['daily-history-body'].children.length,1);b.click('finish');b.click('restart');assert.equal(b.value('medicalBook.exams.length'),4);assert.ok(b.value('mission.monitor.members[0].dose')>0);
});
test('daily calendar history adds comparisons and records manual results without inventing days',()=>{
 const b=browser('station',false);b.start();const old=b.value("new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()-2,12)");const day=b.value('localDay(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()-2,12))');b.elements['medical-day'].value=day;b.elements['medical-day'].listeners.change();assert.equal(b.elements['exam-hr'].value,'');for(const [id,value]of Object.entries({'exam-hr':70,'exam-oxygen':98,'exam-radiation':.6,'exam-fatigue':12,'exam-dose':0}))b.elements[id].value=String(value);b.elements['daily-exam-form'].listeners.submit({preventDefault(){}});assert.equal(b.value('medicalBook.exams.length'),1);b.elements['medical-day'].value=b.value('medicalBook.today()');b.elements['medical-day'].listeners.change();b.elements['daily-exam-form'].listeners.submit({preventDefault(){}});assert.equal(b.value("medicalBook.history('c1').length"),2);assert.ok(b.elements['daily-comparison'].children.length>=5);assert.equal(b.elements['daily-history-body'].children.length,2);
});

test('PDF download button exports a .pdf file and restores button state',async()=>{
 const b=browser('station',false);b.start();examineAll(b);b.click('finish');
 const drawn={fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},measureText:s=>({width:String(s).length*12}),fillText(){}};
 let downloaded='';
 b.context.setTimeout=fn=>{fn();return 1;};b.context.document.body=new Element();
 b.context.document.createElement=tag=>{const el=new Element();if(tag==='canvas'){el.getContext=()=>drawn;el.toDataURL=()=> 'data:image/jpeg;base64,/9j/2Q==';}if(tag==='a'){el.click=()=>downloaded=el.download;el.remove=()=>{};}return el;};
 await b.elements['download-pdf'].listeners.click();assert.ok(downloaded.endsWith('.pdf'));assert.ok(downloaded.startsWith('alpha-crew-report-'));assert.equal(b.elements['download-pdf'].disabled,false);assert.ok(b.elements['pdf-feedback'].textContent.includes('PDF готов'));
});
