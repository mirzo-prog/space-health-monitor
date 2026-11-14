import {CrewPortal,profileClearance} from './crew-portal.mjs';
import {renderReportPdf} from './pdf-report.mjs';
import {DailyMedicalBook} from './daily-medical.mjs';
import {DailyMedicalUI} from './daily-ui.mjs';
import {MissionControl,tasks,missionScenarios,assessCrew,riskOf,eventDescription,radiationRules} from './crew.mjs';
import {MissionScene} from './scene3d.mjs';
const $=id=>document.getElementById(id);
let mission,timer,selectedId,assessment,paused=false,report,initialName,previousRecommendation,seenEvents=0,scene,medicalBook,medicalUI,portal;
const charts=[['hr-chart','heart_rate','#61e2d3',40,145],['spo2-chart','spO2','#93aaff',85,100],['rad-chart','radiation_level','#efba73',0,10]];
const format=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const names=ids=>ids.map(id=>mission.monitor.members.find(m=>m.id===id)?.name||id).join(', ');
function feedback(text){$('operation-feedback').textContent=text;}
function collectEvents(){
 for(const event of mission.timeline.slice(seenEvents)){
  const li=node('li',undefined,['alert','pause','blocked'].includes(event.type)?'alert':'');li.append(node('time',format(event.second)),document.createTextNode(event.text));$('log').prepend(li);
 }seenEvents=mission.timeline.length;
}
function setTask(id){if(mission?.assignment&&['working','paused'].includes(mission.assignment.status)){feedback('Сначала завершите или отмените текущее задание.');return;}$('task').value=id;previousRecommendation=null;render();}
function autoPilot(){
 if(portal?.profile&&(!portal.missionLaunched||!profileClearance(mission,portal.profile.id).allowed))return;
 if(!$('autopilot').checked||paused||mission.finished||!dailyReady())return;
 const a=mission.assignment;
 if(a?.status==='paused'){const replacement=mission.replacementPlan();if(replacement?.ready)mission.replace();return;}
 if(a?.status==='working')return;
 if(a?.status==='completed'&&$('task').value===a.taskId){const next=Object.keys(tasks).find(id=>!mission.completed.some(t=>t.taskId===id));if(!next)return;$('task').value=next;}
 const id=$('task').value,p=mission.preflight;
 if(p?.status==='testing')return;
 if(p?.taskId===id&&p.status==='passed'&&mission.elapsed-p.finishedAt<=25){if(mission.assign(id))return;}
 if(!p||p.taskId!==id||p.status==='cancelled'||mission.elapsed-(p.finishedAt??p.started)>=5)mission.startPreflight(id);
}
function drawCharts(){
 if(!mission)return;const member=mission.monitor.members.find(m=>m.id===selectedId);
 for(const [id,key,color,min,max]of charts){const canvas=$(id),rect=canvas.getBoundingClientRect();if(!rect.width)continue;const dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height;
 ctx.strokeStyle='#263a48';ctx.lineWidth=1;for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
 const data=member.history.slice(-50);ctx.beginPath();let drawing=false;data.forEach((s,i)=>{if(!s.trusted){drawing=false;return;}const x=i/49*w,y=h-6-(Math.max(min,Math.min(max,s.values[key]))-min)/(max-min)*(h-12);drawing?ctx.lineTo(x,y):ctx.moveTo(x,y);drawing=true;});ctx.strokeStyle=canvas.closest('.metric').classList.contains('danger')?'#ff576c':color;ctx.lineWidth=2;ctx.stroke();
 }
}
function renderCrew(){
 assessment=mission.assessment($('task').value);const best=assessment.best;
 const recommendationKey=assessment.taskId+':'+(best?.id||'none');
 if(recommendationKey!==previousRecommendation){mission.record('recommendation',best?`Для задания «${assessment.task}» рекомендован ${best.name}. ${best.score}/100.`:'Подходящий кандидат не найден.');previousRecommendation=recommendationKey;}
 $('recommended-name').textContent=best?best.name:'Подходящих участников нет';$('recommendation-reason').textContent=assessment.explanation;$('recommendation').classList.toggle('danger',!best);
 const task=tasks[$('task').value];$('task-weights').textContent=`Биометрия: пульс ${task.weights.pulse*100}% / кислород ${task.weights.oxygen*100}% / радиация ${task.weights.radiation*100}%`;
 $('task-requirements').textContent=`${task.name}: ${task.size} участник(а), 1 резерв; SpO₂ ≥ ${task.minOxygen}%, пульс 50–100, фон 0.1–5; усталость < ${task.maxFatigue}%, накопленная доза < ${task.doseBudget} мкЗв. Длительность ${task.duration} с. Проба нагрузки — 4 с, результат действителен 25 с. Это учебные пороги.`;
 const body=$('crew-table-body');body.replaceChildren();
 for(const m of assessment.ranked){const row=node('tr');row.classList.toggle('crew-best',m.id===best?.id);row.classList.toggle('crew-selected',m.id===selectedId);row.classList.toggle('crew-excluded',!m.eligible);
  const first=node('td'),button=node('button',m.name+(m.id===best?.id?' ★':''),'crew-name-button');button.setAttribute('aria-pressed',String(m.id===selectedId));button.addEventListener('click',()=>{selectedId=m.id;render();});first.append(button,node('small',m.role,'table-role'));row.append(first);
  for(const [key,bad]of [['heart_rate',m.values.heart_rate<50||m.values.heart_rate>100],['spO2',m.values.spO2<task.minOxygen],['radiation_level',m.values.radiation_level>5]]){const td=node('td',key==='radiation_level'?m.values[key].toFixed(2):m.values[key],bad?'bad-value':'');if(!m.trusted)td.classList.add('stale-value');row.append(td);}
  row.append(node('td',Math.round(m.fatigue)+'%',m.fatigue>=task.maxFatigue?'bad-value':''),node('td',m.dose.toFixed(4),m.dose>=task.doseBudget?'bad-value':''),node('td',m.risk.level,m.risk.score>=55?'bad-value':m.risk.score>=30?'warning-value':''));
  const state=node('td',m.eligible?({working:'Выполняет задание',testing:'Проба нагрузки',rest:'Отдых / доступен'}[m.status]):m.reasons.join('; '),m.eligible?'':'bad-value');row.append(state,node('td',m.eligible?m.score+'/100':'—'));body.append(row);
 }
}
function renderAssignment(){
 const a=mission.assignment,p=mission.preflight,taskId=$('task').value,task=tasks[taskId];
 const cards=$('task-cards');cards.replaceChildren();
 for(const [id,t]of Object.entries(tasks)){const b=node('button',undefined,'task-card');b.classList.toggle('active',id===taskId);b.append(node('small',`0${Object.keys(tasks).indexOf(id)+1} / ${t.size} УЧАСТНИК(А)`),node('strong',t.name),node('span',t.description));b.disabled=mission.finished||!!(a&&['working','paused'].includes(a.status)&&a.taskId!==id);b.setAttribute('aria-pressed',String(id===taskId));b.addEventListener('click',()=>setTask(id));cards.append(b);}
 $('team-plan').textContent=`Группа: ${names(assessment.team.map(m=>m.id))||'не подобрана'}. Резерв: ${assessment.reserve?.name||'не найден'}. ${assessment.reason}`;
 const status={working:'Задание выполняется',paused:'Задание приостановлено',completed:'Задание выполнено',cancelled:'Задание отменено',interrupted:'Задание не завершено'};
 $('assignment-title').textContent=a?(status[a.status]+' / '+tasks[a.taskId].name):p?.status==='testing'?'Проверка готовности экипажа':'Группа ожидает назначения';
 $('assignment-detail').textContent=a?`Участники: ${names(a.ids)}. Резерв: ${names([a.reserveId])}. Прогресс ${a.progress}/${tasks[a.taskId].duration} с. ${a.status==='paused'?a.pauseReason:''}`:p?.status==='testing'?`Учебная проба нагрузки: ${mission.elapsed-p.started}/4 с. Сравниваются исходные и текущие показатели.`:'Выберите задание и проверьте готовность группы. При автоматическом режиме система выполнит назначение сама.';
 $('assignment-fill').style.width=(a?a.progress/tasks[a.taskId].duration*100:0)+'%';
 const busy=a&&['working','paused'].includes(a.status),passed=p?.status==='passed'&&p.taskId===taskId&&mission.elapsed-p.finishedAt<=25;
 $('preflight').disabled=mission.finished||paused||!!busy||p?.status==='testing'||!assessment.ready;
 $('assign').disabled=mission.finished||paused||!!busy||!passed||!assessment.ready;
 const replacement=mission.replacementPlan();$('replace').disabled=mission.finished||paused||!replacement?.ready;
 $('cancel-task').disabled=mission.finished||paused||(!busy&&p?.status!=='testing');
 $('task').disabled=mission.finished||!!busy;
 const results=$('preflight-results');results.replaceChildren();
 if(!p)results.append(node('p','Проба ещё не выполнялась.'));
 else{results.append(node('p',`Статус: ${{testing:'выполняется',passed:'пройдена',failed:'не пройдена',cancelled:'отменена',interrupted:'прервана'}[p.status]}. Участники: ${names(p.ids)}.`));for(const r of p.results||[]){results.append(node('p',`${r.name}: пульс ${r.before.heart_rate} → ${r.after.heart_rate} (Δ ${r.pulseDelta}); SpO₂ ${r.before.spO2} → ${r.after.spO2}% (Δ ${r.oxygenDelta}). ${r.passed?'Проверка пройдена':'Не пройдена: '+(r.reasons.join('; ')||'реакция на нагрузку вне правил модели')}`,r.passed?'':'bad-value'));}}
 if(a?.status==='paused')feedback(replacement?.reason||a.pauseReason);
}
function renderSelected(){
 const m=mission.monitor.members.find(m=>m.id===selectedId),r=riskOf(m),values=m.values;
 const medical=values.heart_rate<50||values.heart_rate>100||values.spO2<94||values.radiation_level>5;
 $('crew-name').textContent=m.name;$('hr').textContent=values.heart_rate;$('spo2').textContent=values.spO2;$('rad').textContent=values.radiation_level.toFixed(2);
 $('health-status').textContent=!m.trusted?(m.sensorFault?'● НЕИСПРАВНОСТЬ ДАТЧИКА':'● КАНАЛ ТЕЛЕМЕТРИИ НЕДОСТОВЕРЕН'):medical?'● ТРЕВОГА / ОТКЛОНЕНИЕ ПОКАЗАТЕЛЕЙ':r.score>=30?'● НАБЛЮДЕНИЕ / РИСК ПОВЫШЕН':'● СОСТОЯНИЕ СТАБИЛЬНО';
 $('health-status').classList.toggle('critical',medical&&m.trusted);$('health-status').classList.toggle('uncertain',!m.trusted||r.score>=30);
 $('health-detail').textContent=!m.trusted?`Показаны последние доверенные данные (${format(m.lastTrusted)}). ${m.sensorFault?'Ложный SpO₂ 52% отклонён: это сбой измерения, а не установленная гипоксия.':'Текущие пакеты отклонены; требуется восстановление достоверности.'}`:assessment.ranked.find(x=>x.id===m.id).reasons.join('; ')||'Текущие показатели соответствуют требованиям выбранного задания.';
 $('activity').textContent=m.radiationWatch?.active?'Радиационное наблюдение / защитный отсек':{working:'Выполняет '+(tasks[mission.assignment?.taskId]?.name||'задание'),testing:'Проба нагрузки',rest:'Отдых и восстановление'}[m.status];
 $('sensor-status').textContent=paused?'Наблюдение приостановлено':!m.trusted?m.sensorFault?'Сбой датчика / значение отклонено':'Канал нарушен / последнее измерение':'Три биодатчика активны';
 $('sample-time').textContent=mission.finished?'Запись завершена / '+format(mission.elapsed):paused?'Обновление приостановлено':'Последний доверенный замер: '+format(m.lastTrusted)+' / 1 Гц';
 $('body-scan').classList.toggle('medical-alert',medical&&m.trusted);
 for(const [id,bad]of [['chest-sensor',values.heart_rate>100||values.heart_rate<50],['oxygen-sensor',values.spO2<94],['radiation-sensor',values.radiation_level>5]])$(id).classList.toggle('sensor-alert',bad&&m.trusted);
 const flags=[values.heart_rate<50||values.heart_rate>100,values.spO2<94,values.radiation_level>5];
 document.querySelectorAll('.metric').forEach((el,i)=>{el.classList.toggle('danger',flags[i]&&m.trusted);el.querySelector('.range').textContent=!m.trusted?'⚠ ПОСЛЕДНИЕ ДОВЕРЕННЫЕ ДАННЫЕ':flags[i]?'⚠ ВНЕ ДИАПАЗОНА МОДЕЛИ':['Норма модели: 50–100','Норма модели: 94–100','Норма модели: 0.1–5.0'][i];});
 $('risk-label').textContent=r.level+' / '+r.score+' из 100';$('risk-label').classList.toggle('bad-value',r.score>=55);$('trend-title').textContent=r.trend.label;$('forecast').textContent=r.forecast;$('risk-explanation').textContent=(r.reasons.length?r.reasons.join('; '):'Нет выраженных факторов ухудшения')+'. Индекс — учебная шкала, не вероятность и не диагноз.';
 $('trend-history').replaceChildren();for(const point of m.history.slice(-10)){const bar=node('span',point.trusted?point.values.spO2+'%':'нет данных');bar.style.setProperty('--value',Math.max(5,(point.values.spO2-85)/15*100)+'%');bar.title=format(point.second);$('trend-history').append(bar);}
 $('complaint').textContent=m.symptoms.length?'«'+m.symptoms.map(s=>s.text).join('. ')+'»':'«Самочувствие обычное, выраженных жалоб нет». Симулированное сообщение.';
 $('member-duty').textContent=m.radiationWatch?.active?'ЗАЩИТНЫЙ ОТСЕК':{working:'РАБОТАЕТ',testing:'ПРОБА',rest:'ВОССТАНАВЛИВАЕТСЯ'}[m.status];$('fatigue-value').textContent=Math.round(m.fatigue)+'%';$('dose-value').textContent=m.dose.toFixed(4)+' мкЗв';$('fatigue-bar').value=m.fatigue;
 $('dose-note').textContent=`Доза = сумма доверенных измерений фона × время / 3600. ${m.unknownDoseSeconds||0} с без измерений не включены; доза за эти интервалы неизвестна.`;
 $('radiation-watch').classList.toggle('danger',!!m.radiationWatch?.active);$('radiation-watch').textContent=m.radiationWatch?.active?(m.radiationWatch.doseHold?'ЗАЩИТНОЕ НАБЛЮДЕНИЕ / накопленная доза ≥ '+radiationRules.doseHold+' мкЗв (учебный порог). Назначения заблокированы. Нормализация фона не обнуляет дозу; требуется пересмотр допуска.':'ЗАЩИТНОЕ НАБЛЮДЕНИЕ / повышенный фон. Назначения заблокированы до '+radiationRules.stableSamples+' нормальных доверенных замеров подряд. Сейчас: '+m.radiationWatch.normalSamples+'/'+radiationRules.stableSamples):'Радиационное наблюдение: активного ограничения нет. Фон и накопленная доза учитываются раздельно.';
 $('rest-member').disabled=mission.finished||paused||m.status==='rest';
 drawCharts();
}
function render(){
 if(!mission)return;renderCrew();renderAssignment();renderSelected();medicalUI?.status();
 const e=mission.event,percent=mission.elapsed/mission.duration*100;$('clock').textContent=format(mission.elapsed);$('score').textContent=Math.round(percent)+'%';$('resolved').textContent=mission.completed.length;
 const phase=mission.elapsed<5?0:mission.elapsed<18?1:mission.elapsed<35?2:mission.elapsed<72?3:4;
 $('phase').textContent=['Подготовка экипажа','Начало миссии','Адаптация','Выполнение заданий','Завершение миссии'][phase];$('progress-fill').style.width=percent+'%';document.querySelectorAll('.stages li').forEach((el,i)=>{el.classList.toggle('current',i===phase);el.classList.toggle('done',i<phase);});
 const selected=mission.monitor.members.find(m=>m.id===selectedId),selectedAlert=!selected.trusted||selected.values.spO2<94||selected.values.heart_rate>100||selected.values.radiation_level>5;
 $('live-mission').classList.toggle('danger',selectedAlert);$('event-panel').classList.toggle('danger',!!e);$('flight-warning').hidden=!selectedAlert;$('flight-warning').textContent='⚠ '+$('health-status').textContent;
 $('event-title').textContent=e?eventDescription(e,mission.monitor.members):'Наблюдение за экипажем продолжается';$('event-detail').textContent=e?`Событие в симуляции / длительность ${mission.elapsed-e.started} с. Состояние каждого участника проверяется отдельно.`:'Проверяются текущие измерения, жалобы, усталость, история и доступность резерва.';$('event-badge').textContent=mission.finished?'ЗАПИСЬ ОКОНЧЕНА':paused?'ПАУЗА':e?'СОБЫТИЕ':'ШТАТНО';
 $('feedback').textContent=e?.type==='sensor'?'Показание неисправного датчика отклонено; последнее достоверное значение сохранено. Участник временно исключён из назначения.':e?'Автоматическая защита и повторная оценка экипажа. Опасное задание приостанавливается до восстановления или замены.':'Нет активных сценарных сбоев. Участники вне нормы остаются исключёнными из назначения.';
 collectEvents();
 portal?.refresh();portal?.save();
 $('scene-crew-label').textContent=mission.assignment?'Участники: '+names(mission.assignment.ids)+' / резерв: '+names([mission.assignment.reserveId]):'Экипаж ожидает проверки готовности';
 if(scene)scene.update({scenario:mission.scenario,task:mission.assignment?.taskId||$('task').value,status:paused?'paused':mission.finished?'finished':mission.assignment?.status||'waiting',progress:mission.assignment?mission.assignment.progress/tasks[mission.assignment.taskId].duration:0,team:mission.assignment?.ids.length||tasks[$('task').value].size,alert:!!e});
}
function start(name){
 clearInterval(timer);initialName=name;let storage;try{storage=window.localStorage;}catch{}medicalBook=new DailyMedicalBook(storage,portal?.profile?'ALPHA/profile/'+portal.profile.id:name);mission=new MissionControl(name,$('scenario').value,medicalBook);if(portal?.profile)mission.operatorId=portal.profile.id;$('task').value=missionScenarios[mission.scenario].preferred;assessment=mission.assessment($('task').value);selectedId=portal?.profile?.id||assessment.best?.id||'c1';previousRecommendation=null;seenEvents=0;paused=false;report=null;
 $('welcome').hidden=true;$('result').hidden=true;$('dashboard').hidden=false;$('pause').disabled=false;$('finish').disabled=false;$('task').disabled=false;$('pause').textContent='Пауза';$('pilot').textContent='АЛЬФА / 4 участника';$('scenario-name').textContent=missionScenarios[mission.scenario].name;$('log').replaceChildren();feedback('');$('rest-feedback').textContent='';
 if(medicalUI)medicalUI.setContext(mission,medicalBook);else medicalUI=new DailyMedicalUI(mission,medicalBook,()=>{mission.syncDailyExams();autoPilot();render();},executeDailyRow);
 if(portal?.profile){medicalUI.$('medical-member').value=portal.profile.id;medicalUI.render();}
 if(!scene)scene=new MissionScene($('mission-3d'),$('scene-fallback'));autoPilot();render();
 timer=setInterval(()=>{if(paused)return;if(portal?.profile&&!portal.missionLaunched){portal.refresh();return;}mission.syncDailyExams();if(!dailyReady()){if(mission.assignment?.status==='working'){mission.assignment.status='paused';mission.assignment.pauseReason='Не пройден обязательный медосмотр за новый день.';mission.monitor.members.forEach(m=>m.status='rest');mission.record('pause',mission.assignment.pauseReason);}render();return;}mission.tick();autoPilot();render();if(mission.finished)finish();},1000);
}
function finish(){
 clearInterval(timer);report=mission.finish();render();report=mission.report();report.comparison=assessment.ranked;report.recommendedTeam=assessment.team.map(m=>m.id);report.selectedTask=assessment.taskId;report.dailyMedical=medicalBook.export();report.createdAt=new Date().toISOString();if(portal?.profile)report.operator={id:portal.profile.id,name:portal.profile.name};
 $('dashboard').hidden=true;$('result').hidden=false;$('result-name').textContent=initialName;$('result-score').textContent=mission.completed.length;$('result-resolved').textContent=mission.replacements;$('result-mistakes').textContent=mission.elapsed;
 $('result-note').textContent=`Сценарий: ${missionScenarios[mission.scenario].name}. ${mission.completed.length} заданий выполнено. ${mission.assignment?.status==='interrupted'?'Последнее задание прервано окончанием наблюдения.':''}`;
 $('selection-summary').textContent='Последняя оценка: '+assessment.explanation;$('medical-summary').textContent='Разбор включает весь экипаж, а не только открытого участника.';
 $('report-crew').replaceChildren();for(const m of mission.monitor.members){const card=node('article',undefined,'report-member'),trusted=m.history.filter(s=>s.trusted);card.append(node('h3',m.name),node('p',trusted.length?`Пульс: ${Math.min(...trusted.map(s=>s.values.heart_rate))}–${Math.max(...trusted.map(s=>s.values.heart_rate))}. Минимум SpO₂: ${Math.min(...trusted.map(s=>s.values.spO2))}%.`:'Нет доверенных измерений.'),node('p',`Усталость ${Math.round(m.fatigue)}%. Учтённая доза ${m.dose.toFixed(4)} мкЗв; ${m.unknownDoseSeconds||0} с пропущенных измерений.`));$('report-crew').append(card);}
 $('report-timeline').replaceChildren();for(const event of report.timeline){const li=node('li');li.append(node('time',format(event.second)),node('span',event.text));$('report-timeline').append(li);}
}
$('scenario').addEventListener('change',()=>{$('scenario-description').textContent=missionScenarios[$('scenario').value].description;});
$('entry').addEventListener('submit',e=>{e.preventDefault();const name=$('name').value.trim();if(!name){$('name').setCustomValidity('Введите имя первого участника');$('name').reportValidity();return;}$('name').setCustomValidity('');start(name);});$('name').addEventListener('input',()=>$('name').setCustomValidity(''));
$('task').addEventListener('change',()=>{if(mission)render();});
$('preflight').addEventListener('click',()=>{feedback(mission.startPreflight($('task').value)?'Начата проверка группы и резерва.':'Проверку сейчас начать нельзя.');render();});
$('assign').addEventListener('click',()=>{feedback(mission.assign($('task').value)?'Группа назначена. Выполнение началось.':'Назначение невозможно. Проверьте актуальную готовность и резерв.');render();});
$('replace').addEventListener('click',()=>{feedback(mission.replace()?'Замена выполнена.':mission.replacementPlan()?.reason||'Замена недоступна.');render();});
$('cancel-task').addEventListener('click',()=>{$('autopilot').checked=false;mission.cancel();feedback('Задание отменено. Автоматическое назначение выключено.');render();});
$('rest-member').addEventListener('click',()=>{const m=mission.monitor.members.find(m=>m.id===selectedId);$('autopilot').checked=false;if(m.status==='working'||m.status==='testing')mission.cancel();m.status='rest';mission.record('rest',m.name+': переведён на отдых. Усталость будет снижаться на следующих тактах.');$('rest-feedback').textContent='Участник отдыхает; автоматическое назначение выключено.';render();});
$('autopilot').addEventListener('change',()=>{autoPilot();render();});
$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'Продолжить':'Пауза';render();});$('finish').addEventListener('click',finish);
$('back-monitor').addEventListener('click',()=>{$('result').hidden=true;$('dashboard').hidden=false;$('pause').disabled=true;$('finish').disabled=true;render();});
$('restart').addEventListener('click',()=>start(initialName));
$('download-pdf').addEventListener('click',async()=>{
 const button=$('download-pdf');button.disabled=true;$('pdf-feedback').textContent='Подготовка PDF…';
 try{const blob=await renderReportPdf(report,Object.fromEntries(Object.entries(tasks).map(([id,t])=>[id,t.name])),Object.fromEntries(Object.entries(missionScenarios).map(([id,s])=>[id,s.name])));const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='alpha-crew-report-'+(report.createdAt||new Date().toISOString()).slice(0,10)+'.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);$('pdf-feedback').textContent='PDF готов. Файл передан браузеру для скачивания.';}catch(error){$('pdf-feedback').textContent='Не удалось создать PDF: '+error.message;}finally{button.disabled=false;}
});
$('download').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='alpha-crew-mission.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function dailyReady(){return mission.monitor.members.every(m=>medicalBook.get(medicalBook.today(),m.id));}
function executeDailyRow(row,day){
 if(day!==medicalBook.today())return 'Архивный план нельзя выполнить как сегодняшнее задание.';
 if(mission.finished||paused)return 'Сначала запустите активную миссию.';
 if(!dailyReady())return 'Пройдите ежедневный медосмотр всех участников.';
 if(['working','paused'].includes(mission.assignment?.status)||mission.preflight?.status==='testing')return 'Сначала завершите или отмените текущее задание/проверку.';
 $('autopilot').checked=false;$('task').value=row.taskId;
 const ok=mission.startPreflight(row.taskId,{ids:[...row.ids],reserveId:row.reserveId});render();
 return ok?'Группа из дневного плана проходит пробу нагрузки. Через 4 секунды нажмите «Назначить группу».':'Назначение из плана заблокировано: текущие показатели или допуск изменились. Пересчитайте план.';
}
$('reset-camera').addEventListener('click',()=>scene?.reset());window.addEventListener('resize',drawCharts);

function savePersonalState(){
 if(!mission)return null;
 return {mission:mission.report(),preflight:structuredClone(mission.preflight),event:structuredClone(mission.event),selectedId,task:$('task').value,autopilot:$('autopilot').checked,paused,rosterName:initialName};
}
function openPersonalProfile(profile,saved){
 portal.missionLaunched=false;
 $('autopilot').checked=false;
 if(saved?.mission?.scenario&&missionScenarios[saved.mission.scenario])$('scenario').value=saved.mission.scenario;
 start(portal.profiles[0].name);
 if(saved){
  const data=saved.mission;
  mission.monitor.members=structuredClone(data.crew);mission.elapsed=data.seconds;mission.monitor.elapsed=data.seconds;mission.finished=data.finished;mission.completed=structuredClone(data.completed||[]);mission.assignment=structuredClone(data.assignment);mission.preflight=structuredClone(saved.preflight);mission.preflightResults=structuredClone(data.preflights||[]);mission.event=structuredClone(saved.event);mission.timeline=structuredClone(data.timeline||[]);mission.replacements=data.replacements||0;
  $('task').value=tasks[saved.task]?saved.task:missionScenarios[mission.scenario].preferred;$('autopilot').checked=!!saved.autopilot;paused=!!saved.paused;$('pause').textContent=paused?'Продолжить':'Пауза';mission.syncDailyExams();seenEvents=0;$('log').replaceChildren();
 }
 if(!saved)$('autopilot').checked=true;selectedId=profile.id;medicalUI.$('medical-member').value=profile.id;medicalUI.render();render();
 if(mission.finished)finish();
}
function recoveryReview(id,stabilize=false){
 const m=mission.monitor.members.find(m=>m.id===id),exam=medicalBook.get(medicalBook.today(),id);
 if(!exam)return 'Сначала запишите обязательный осмотр за сегодня. Протокол не заменяет ежедневный осмотр.';
 if(!m.trusted)return 'Текущие измерения недостоверны. Повторная оценка возможна после восстановления датчика или канала.';
 if(m.radiationWatch?.active)return 'Радиационное ограничение сохраняется. Отдых не обнуляет дозу и не заменяет последовательность нормальных замеров фона.';
 if(stabilize){
  m.baseline={...m.baseline,heart_rate:72,spO2:98};m.values={...m.values,heart_rate:72,spO2:98};m.fatigue=Math.max(0,m.fatigue-10);m.symptoms=[];
  if(mission.event?.target===mission.monitor.members.indexOf(m)&&['hypoxia','stress','oxygen_trend','fatigue'].includes(mission.event.type))mission.event=null;
  m.recoveryProtocolCompletedAt=new Date().toISOString();mission.record('recovery',m.name+': учебное восстановление завершено; выполнены повторные измерения.');
 }
 const measured={...m,requireDailyExam:false};const current=assessCrew([measured],'research').ranked[0];
 if(!current.eligible){render();return 'Повторная проверка: '+current.reasons.join('; ')+'. Допуск остаётся закрыт.';}
 // A separate follow-up record preserves the immutable daily exam and dose limits.
 m.dailyRecoveryReview={memberId:id,day:medicalBook.today(),examRecordedAt:exam.recordedAt,recordedAt:new Date().toISOString(),source:'simulation_recheck',values:{...m.values},fatigue:m.fatigue,dose:Math.max(exam.dose,m.dose),trusted:m.trusted,symptoms:structuredClone(m.symptoms)};
 mission.record('recheck',m.name+': повторная оценка состояния. Исходный ежедневный осмотр сохранён.');render();return 'Повторная проверка завершена. '+(profileClearance(mission,id).allowed?'Общий допуск открыт; требования конкретного задания проверяются отдельно.':'Ограничения остаются в силе.');
}
portal=new CrewPortal({
 login:openPersonalProfile,
 hasProgress:()=>!!mission&&mission.elapsed>0&&!mission.finished,
 redraw:()=>{drawCharts();medicalUI?.renderHistory();},
 launch:()=>{
  if(!mission)return {started:false,message:'Сначала выберите профиль.'};
  if(!dailyReady())return {started:false,message:'Нажмите «Пройти учебный медосмотр экипажа» на шаге 2.'};
  const clearance=profileClearance(mission,portal.profile.id);
  if(!clearance.allowed&&mission.elapsed===0)return {started:false,message:'Запуск ограничен: '+clearance.reasons.join('; ')+'. Пройдите протокол восстановления на шаге 2.'};
  if(mission.finished){start(initialName);}
  paused=false;$('pause').textContent='Пауза';$('autopilot').checked=true;portal.missionLaunched=true;
  if(!mission.operatorAllowed($('task').value)&&mission.operatorAllowed('research'))$('task').value='research';
  autoPilot();render();return {started:true,message:'Миссия запущена. Подбор группы, проверка готовности и задания выполняются автоматически.'};
 },
 launchStatus:()=>{
  if(!mission)return;let title,help;
  if(mission.finished){title='Миссия завершена';help='Откройте отчёт или запустите новую миссию.';}
  else if(paused){title='Миссия на паузе';help='Нажмите «Продолжить миссию», чтобы таймер и задания снова работали.';}
  else if(!portal.missionLaunched){title=mission.elapsed?'Сохранённая миссия ожидает продолжения':'Готово к запуску';help=dailyReady()?'Нажмите «Запустить миссию». Автоматика выполнит остальные действия.':'Сначала нажмите кнопку учебного медосмотра на шаге 2.';}
  else if(!dailyReady()){title='Ожидание ежедневного осмотра';help='Не все участники прошли сегодняшний осмотр. Вернитесь к шагу 2 и нажмите кнопку осмотра.';}
  else if(mission.assignment?.status==='paused'){title='Задание приостановлено — идёт наблюдение';help=(mission.assignment.pauseReason||'Проверяется безопасность экипажа')+' Таймер продолжает идти; задание возобновится после восстановления или допустимой замены.';}
  else if(mission.preflight?.status==='testing'){title='Проверка готовности группы';help='Автоматическая проба нагрузки: '+(mission.elapsed-mission.preflight.started)+' из 4 секунд. После проверки задание начнётся само.';}
  else if(mission.assignment?.status==='working'){title='Миссия идёт: '+tasks[mission.assignment.taskId].name;help='Группа: '+names(mission.assignment.ids)+'. Выполнено '+mission.assignment.progress+' из '+tasks[mission.assignment.taskId].duration+' секунд задания.';}
  else{title='Миссия идёт — подбор следующего задания';help=assessment.ready?'Автоматически выбирается группа и проверяется готовность.':assessment.reason+' Подробные причины доступны в медицинских данных.';}
  $('simple-mission-status').textContent=title;$('simple-mission-help').textContent=help;$('simple-mission-fill').style.width=(mission.elapsed/mission.duration*100)+'%';$('launch-mission').textContent=mission.finished?'Начать новую миссию':paused||mission.elapsed?'Продолжить миссию':'Запустить миссию';$('launch-mission').hidden=!!portal.missionLaunched&&!paused&&!mission.finished;
 },
 running:()=>!!mission&&mission.elapsed>0&&!mission.finished,
 scenario:()=>{if(mission.elapsed>0&&!mission.finished)return;start(initialName);portal.navigate(3);},
 logout:()=>{clearInterval(timer);$('dashboard').hidden=true;$('result').hidden=true;},
 snapshot:savePersonalState,
 clearance:id=>profileClearance(mission,id),
 progress:id=>({completed:mission?.completed.filter(a=>(a.participants||a.ids).includes(id)).length||0,seconds:mission?.elapsed||0}),
 step:step=>{if(mission&&portal?.profile){$('dashboard').hidden=false;$('result').hidden=true;if(step===3)autoPilot();drawCharts();medicalUI.renderHistory();}},
 message:text=>{mission.record('demo-medical',text);render();},
 recover:id=>recoveryReview(id,true),
 recheck:id=>recoveryReview(id,false),
 examineCrew:()=>{let recorded=0;for(const m of mission.monitor.members){if(!medicalBook.get(medicalBook.today(),m.id)){medicalBook.record(medicalBook.today(),m,{values:m.values,fatigue:m.fatigue,dose:m.dose,trusted:m.trusted,symptoms:m.symptoms,source:'simulation',notes:'Учебный осмотр из панели экипажа'});recorded++;}}mission.syncDailyExams();medicalUI.render();render();return 'Записано учебных осмотров: '+recorded+'. Допуск каждого участника зависит от его показателей.';}
});
window.addEventListener('beforeunload',()=>portal.save());
