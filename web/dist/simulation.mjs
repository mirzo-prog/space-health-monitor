// Browser-local teaching model based on config.py and generator_red_team.py.
export const scenarios = {
  hypoxia: {title:'Падение кислорода', detail:'SpO₂ ниже 94%. Автоматика восстанавливает подачу кислорода.', answer:'oxygen', success:'Подача кислорода восстановлена. SpO₂ возвращается к норме.'},
  radiation: {title:'Радиационная вспышка', detail:'Радиация выше 5 мкЗв/ч. Активируется радиационная защита отсека.', answer:'shelter', success:'Экипаж в защищённом отсеке. Радиационная нагрузка снижается.'},
  mitm: {title:'Подмена телеметрии · MITM', detail:'Подпись пакета не совпадает. Пульс 205 и SpO₂ 52% получены из недоверенного источника.', answer:'isolate', success:'Недоверенный канал изолирован. Подменённые данные отклонены.'},
  dos: {title:'Перегрузка канала · DoS', detail:'20 пакетов/с при пороге 10. Канал телеметрии перегружен.', answer:'limit', success:'Ограничение частоты включено. Канал телеметрии восстановлен.'}
};
export class Simulation {
  constructor(name, random=Math.random) { this.name=name; this.random=random; this.elapsed=0; this.score=0; this.resolved=0; this.mistakes=0; this.active=null; this.finished=false; this.events=[]; this.values={heart_rate:72,spO2:98,radiation_level:0.5}; }
  event(type) { if(this.finished || this.active || !scenarios[type]) return false; this.active={type,started:this.elapsed,...scenarios[type]}; return true; }
  respond(action) { if(!this.active || this.finished) return null; const ok=action===this.active.answer; if(ok){ this.score+=25; this.resolved++; this.events.push(this.active.type); const message=this.active.success; this.active=null; return {ok,message}; } this.mistakes++; this.score=Math.max(0,this.score-5); return {ok,message:'Это действие не устраняет причину. Проверьте описание события и попробуйте ещё раз.'}; }
  tick() {
    if(this.finished)return;
    this.elapsed++;
    this.lastRecovery=null;
    if(this.active && this.elapsed-this.active.started>=7){
      const type=this.active.type;
      this.lastRecovery={type,...this.respond(this.active.answer)};
    }
    const index=[8,22,36,50].indexOf(this.elapsed);
    if(index>=0&&!this.active)this.event(['hypoxia','mitm','radiation','dos'][index]);
    const jitter=()=>this.random()-.5, type=this.active?.type;
    this.values={heart_rate:Math.round(74+4*Math.sin(this.elapsed/5)+jitter()*3+(type==='hypoxia'?30:0)),spO2:Math.round((type==='hypoxia'?90:98)+jitter()*1.2),radiation_level:+((type==='radiation'?7.5:.5)+Math.abs(jitter())*.25).toFixed(2)};
    if(this.elapsed>=75)this.finished=true;
  }
  finish(){this.finished=true;return {name:this.name,seconds:this.elapsed,score:this.score,resolved:this.resolved,mistakes:this.mistakes,unresolved:!!this.active};}
}
