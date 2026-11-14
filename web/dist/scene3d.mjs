// Dependency-free WebGL scene; bundled into the offline HTML.
const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function multiply(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
function modelMatrix(position,scale,rotation=0){const m=identity(),c=Math.cos(rotation),s=Math.sin(rotation);m[0]=c*scale[0];m[1]=s*scale[0];m[4]=-s*scale[1];m[5]=c*scale[1];m[10]=scale[2];m[12]=position[0];m[13]=position[1];m[14]=position[2];return m;}
function perspective(aspect){const f=1/Math.tan(Math.PI/8),near=.1,far=120,m=new Float32Array(16);m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;m[14]=2*far*near/(near-far);return m;}
function lookAt(eye,target){const sub=(a,b)=>a.map((v,i)=>v-b[i]),norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n)},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);const z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
function cubeVertices(){const out=[],faces=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],[[-1,0,0],[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],[[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],[[0,-1,0],[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],[[0,0,1],[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],[[0,0,-1],[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]]];for(const [n,v]of faces)for(const i of [0,1,2,0,2,3])out.push(...v[i],...n);return out;}
function sphereVertices(){const out=[],point=(a,b)=>[Math.sin(a)*Math.cos(b),Math.cos(a),Math.sin(a)*Math.sin(b)];for(let i=0;i<14;i++)for(let j=0;j<20;j++){const p=[point(i/14*Math.PI,j/20*Math.PI*2),point((i+1)/14*Math.PI,j/20*Math.PI*2),point((i+1)/14*Math.PI,(j+1)/20*Math.PI*2),point(i/14*Math.PI,(j+1)/20*Math.PI*2)];for(const k of [0,1,2,0,2,3])out.push(...p[k],...p[k]);}return out;}
export class MissionScene{
 constructor(canvas,fallback){
  this.canvas=canvas;this.fallback=fallback;this.time=0;this.last=0;this.state={task:'repair',scenario:'station',status:'waiting',progress:0,team:1};this.reset();
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false});this.gl=gl;
  if(!gl){fallback.hidden=false;canvas.hidden=true;return;}
  try{this.init();}catch(error){fallback.hidden=false;canvas.hidden=true;this.gl=null;return;}
  this.drag=null;
  canvas.addEventListener('pointerdown',e=>{this.drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.azimuth+=(e.clientX-this.drag[0])*.008;this.elevation=Math.max(-.1,Math.min(1.1,this.elevation+(e.clientY-this.drag[1])*.006));this.drag=[e.clientX,e.clientY];});
  canvas.addEventListener('pointerup',()=>this.drag=null);canvas.addEventListener('pointercancel',()=>this.drag=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();this.radius=Math.max(6,Math.min(20,this.radius+e.deltaY*.01));},{passive:false});
  canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')this.azimuth-=.1;if(e.key==='ArrowRight')this.azimuth+=.1;if(e.key==='ArrowUp')this.elevation=Math.min(1.1,this.elevation+.1);if(e.key==='ArrowDown')this.elevation=Math.max(-.1,this.elevation-.1);if(['+','='].includes(e.key))this.radius=Math.max(6,this.radius-.5);if(e.key==='-')this.radius=Math.min(20,this.radius+.5);}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.gl=null;fallback.hidden=false;});
  this.frame=this.frame.bind(this);requestAnimationFrame(this.frame);
 }
 reset(){this.azimuth=.4;this.elevation=.23;this.radius=10.8;}
 init(){const gl=this.gl;
  const compile=(type,code)=>{const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
  const vs=compile(gl.VERTEX_SHADER,'attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uModel;uniform mat4 uView;varying vec3 vNormal;varying vec3 vWorld;void main(){vec4 world=uModel*vec4(aPosition,1.0);vWorld=world.xyz;vNormal=mat3(uModel)*aNormal;gl_Position=uView*world;}');
  const fs=compile(gl.FRAGMENT_SHADER,'precision mediump float;uniform vec3 uColor;uniform float uGlow;varying vec3 vNormal;varying vec3 vWorld;void main(){vec3 normal=normalize(vNormal);float light=max(dot(normal,normalize(vec3(-0.4,0.8,0.7))),0.0);float rim=pow(1.0-abs(normal.z),2.0)*0.12;vec3 color=uColor*(0.32+light*0.68+rim)+uColor*uGlow;float fog=clamp(length(vWorld)/80.0,0.0,0.6);gl_FragColor=vec4(mix(color,vec3(0.026,0.047,0.065),fog),1.0);}');
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('WebGL link failed');this.program=program;gl.useProgram(program);
  this.loc={position:gl.getAttribLocation(program,'aPosition'),normal:gl.getAttribLocation(program,'aNormal'),model:gl.getUniformLocation(program,'uModel'),view:gl.getUniformLocation(program,'uView'),color:gl.getUniformLocation(program,'uColor'),glow:gl.getUniformLocation(program,'uGlow')};this.meshes={};
  for(const [name,vertices]of [['cube',cubeVertices()],['sphere',sphereVertices()]]){const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);this.meshes[name]={buffer,count:vertices.length/6};}
  gl.enable(gl.DEPTH_TEST);gl.clearColor(.026,.047,.065,1);
 }
 update(state){this.state=state;const taskNames={eva:'ВЫХОД В ОТКРЫТЫЙ КОСМОС',repair:'РЕМОНТ ОБОРУДОВАНИЯ',research:'НАУЧНЫЙ ЭКСПЕРИМЕНТ',evacuation:'АВАРИЙНОЕ ВОЗВРАЩЕНИЕ'};const status={working:'Участники выполняют задание',paused:'Работа приостановлена',waiting:'Проверка и назначение экипажа',completed:'Задание выполнено',cancelled:'Задание отменено',interrupted:'Задание прервано',finished:'Миссия завершена'};document.getElementById('scene-task-label').textContent=taskNames[state.task];document.getElementById('scene-status-label').textContent=status[state.status]||'Подготовка';document.getElementById('scene-progress-label').textContent=Math.round(state.progress*100)+'%';}
 draw(mesh,pos,scale,color,rotation=0,glow=0){const gl=this.gl,m=this.meshes[mesh];gl.bindBuffer(gl.ARRAY_BUFFER,m.buffer);gl.enableVertexAttribArray(this.loc.position);gl.enableVertexAttribArray(this.loc.normal);gl.vertexAttribPointer(this.loc.position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(this.loc.normal,3,gl.FLOAT,false,24,12);gl.uniformMatrix4fv(this.loc.model,false,this.personTransform?multiply(this.personTransform,modelMatrix(pos,scale,rotation)):modelMatrix(pos,scale,rotation));gl.uniform3fv(this.loc.color,color);gl.uniform1f(this.loc.glow,glow);gl.drawArrays(gl.TRIANGLES,0,m.count);}
 astronaut(x,y,z,index,working){
  const floating=this.state.scenario!=='surface';y+=floating?Math.sin(this.time*.85+index)*.14:0;
  const tilt=floating?(index===0?-.24:.15)+Math.sin(this.time*.5+index)*.055:0;
  this.personTransform=multiply(modelMatrix([x,y,z],[1,1,1],tilt),modelMatrix([-x,-y,-z],[1,1,1]));
  const suit=index===0?[.92,.93,.88]:[.87,.91,.9],trim=[.13,.2,.23],visor=[.025,.065,.08],warm=[.7,.65,.46],s=this.draw.bind(this,'sphere'),b=this.draw.bind(this,'cube'),move=working?Math.sin(this.time*2.6+index)*.2:Math.sin(this.time*.65+index)*.05;
  b([x,y+.03,z-.24],[.28,.4,.15],[.76,.79,.74]);b([x,y+.04,z-.41],[.17,.28,.025],trim);
  s([x,y+.05,z],[.32,.46,.23],suit);s([x,y-.35,z],[.31,.16,.22],suit);
  s([x,y+.73,z],[.4,.42,.36],suit);s([x,y+.75,z+.22],[.31,.27,.18],trim);s([x,y+.76,z+.27],[.285,.24,.14],visor);
  s([x-.14,y+.86,z+.365],[.065,.025,.012],[.48,.72,.75],0,.12);b([x+.33,y+.74,z],[.035,.22,.065],warm);
  s([x,y+.38,z],[.29,.07,.23],trim);b([x,y+.04,z+.22],[.17,.14,.035],[.68,.73,.7]);b([x,y+.07,z+.265],[.105,.045,.01],trim);b([x,y+.073,z+.279],[.065,.008,.005],[.27,.78,.69],0,.12);
  for(const side of [-1,1]){
   s([x+side*.32,y+.24,z],[.14,.15,.14],suit);
   b([x+side*.4,y+.02,z+.015],[.11,.24,.12],suit,-side*(.34+move));s([x+side*.48,y-.17,z+.06],[.12,.12,.12],trim);
   b([x+side*.48,y-.3,z+.12],[.105,.18,.12],suit,-side*(.1+move));s([x+side*.5,y-.47,z+.16],[.12,.14,.13],suit);b([x+side*.49,y-.34,z+.24],[.105,.035,.018],trim);
   const knee=side===-1&&floating?.08:0;
   b([x+side*.16,y-.63,z],[.13,.27,.14],suit,side*(.1+move*.25));s([x+side*.18,y-.83,z+knee],[.14,.1,.15],trim);
   b([x+side*.18,y-1.02,z+knee],[.13,.2,.14],suit,side*.07);s([x+side*.19,y-1.22,z+.09+knee],[.15,.11,.23],suit);b([x+side*.19,y-1.3,z+.09+knee],[.16,.025,.23],trim);
  }
  // Curved suit hose, formed from short segments in the astronaut's local frame.
  for(let j=0;j<15;j++){const angle=j/14*Math.PI;s([x+.26+Math.sin(angle)*.16,y-.04-j*.029,z+.25],[.032,.032,.032],j%2?trim:warm);}
  if(working&&['repair','eva'].includes(this.state.task)){s([x+.62,y-.45,z+.28],[.05,.05,.05],[.4,.9,1],0,.7+Math.sin(this.time*16)*.3);b([x+.56,y-.46,z+.19],[.04,.13,.04],[.6,.65,.68],-.6);}
  this.personTransform=null;
  if(floating){let previous=[x,y-.24,z-.15];for(let j=1;j<=16;j++){const t=j/16,point=[x+(1.1-x)*t,y-.24-.55*Math.sin(t*Math.PI),z-.15+(-1.3-z)*t];const dx=point[0]-previous[0],dy=point[1]-previous[1],dz=point[2]-previous[2],length=Math.hypot(dx,dy,dz);const dxn=dx/length,dyn=dy/length,dzn=dz/length,horizontal=Math.hypot(dxn,dzn),rx=dzn/horizontal,rz=-dxn/horizontal;
   this.personTransform=new Float32Array([rx*.016,0,rz*.016,0,dyn*rz*.016,(dzn*rx-dxn*rz)*.016,-dyn*rx*.016,0,dx*.5,dy*.5,dz*.5,0,(point[0]+previous[0])/2,(point[1]+previous[1])/2,(point[2]+previous[2])/2,1]);
   b([0,0,0],[1,1,1],[.67,.69,.49]);this.personTransform=null;previous=point;}}
 }

 station(){const b=this.draw.bind(this,'cube'),s=this.draw.bind(this,'sphere');b([2,.3,-1.4],[1.5,.8,.8],[.5,.6,.65]);s([.5,.3,-1.4],[.45,.8,.8],[.33,.43,.49]);b([2,.3,-.58],[.7,.35,.03],[.12,.23,.3]);b([2,.3,-.53],[.5,.035,.02],[.2,.8,.73],0,.25);b([2,.3,-2.4],[.3,.2,.4],[.3,.4,.48]);for(const side of [-1,1]){const x=2+side*2.9;b([x,.5,-1.5],[1.35,.045,.85],[.08,.27,.43]);for(let i=-3;i<=3;i++)b([x+i*.35,.55,-1.5],[.008,.015,.83],[.4,.63,.7]);for(const z of [-2.1,-1.5,-.9])b([x,.56,z],[1.34,.01,.008],[.4,.63,.7]);}for(let x=.7;x<3.5;x+=.7)b([x,-.48,-.55],[.018,.08,.018],[.68,.74,.77]);}
 frame(timestamp){
  if(!this.gl)return;requestAnimationFrame(this.frame);if(!this.canvas.getBoundingClientRect().width){this.last=timestamp;return;}
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,dt=Math.min(.05,(timestamp-(this.last||timestamp))/1000);this.last=timestamp;if(!['paused','finished','interrupted'].includes(this.state.status)&&!reduced)this.time+=dt;
  const gl=this.gl,rect=this.canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
  const eye=[Math.sin(this.azimuth)*Math.cos(this.elevation)*this.radius,Math.sin(this.elevation)*this.radius+1,Math.cos(this.azimuth)*Math.cos(this.elevation)*this.radius];gl.uniformMatrix4fv(this.loc.view,false,multiply(perspective(w/h),lookAt(eye,[0,0,0])));
  const b=this.draw.bind(this,'cube'),s=this.draw.bind(this,'sphere');
  for(let i=0;i<45;i++){const x=Math.sin(i*123.7)*25,y=Math.cos(i*53.1)*15+3,z=-18-Math.abs(Math.sin(i*19.3))*15;b([x,y,z],[.025,.025,.025],[.6,.73,.8],0,.3);}
  const ground=this.state.scenario==='surface';
  if(ground){b([0,-1.6,0],[8,.15,7],[.28,.3,.33]);for(let i=0;i<14;i++)s([Math.sin(i*3.8)*7,-1.4,Math.cos(i*5.1)*6],[.2+(i%3)*.12,.14,.3],[.35,.36,.38]);s([-6,6,-22],[3,3,3],[.08,.33,.47]);}else{s([-9,-7,-23],[9,9,9],[.06,.22,.35]);s([-9,-7,-23.2],[9.1,9.1,9.1],[.08,.27,.38]);}
  this.station();
  const working=this.state.status==='working',progress=this.state.progress;
  if(this.state.task==='evacuation'){const x=-1.2+progress*2;b([x,.1,1],[.8,.42,.5],[.54,.64,.67]);s([x,.3,1.3],[.5,.35,.3],[.08,.22,.31]);if(working)s([x-.9,.1,1],[.3+Math.sin(this.time*12)*.05,.13,.13],[.2,.7,1],0,.7);}
  if(this.state.task==='research'){b([-.9,-.55,.8],[.7,.09,.4],[.35,.48,.53]);for(const x of [-1.3,-.5])b([x,-1,.8],[.05,.4,.05],[.23,.33,.4]);for(let i=0;i<3;i++)s([-1.25+i*.3,-.3,.8],[.09,.15,.09],[.2,.7,.65]);}
  const count=Math.max(1,Math.min(2,this.state.team));for(let i=0;i<count;i++){const x=-1.6+i*1.4+(working&&this.state.task==='eva'?Math.sin(progress*Math.PI)*.25:0);this.astronaut(x,ground?-.3:0,.4+i*.25,i,working);if(this.state.task==='eva')b([x,-.3,-.2],[.015,.015,.6],[.8,.7,.3]);}
  if(this.state.alert){const pulse=.3+Math.abs(Math.sin(this.time*4))*.4;s([2,1.25,-1],[.09,.09,.09],[1,.17,.22],0,pulse);}
 }
}
