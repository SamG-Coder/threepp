import {OPS,CONSTANTS,SYNC} from './raw-gl-generated.mjs';

// Experimental graphics bridge, not a browser WebGL conformance implementation.
// No native scene, mesh, material or camera is created by this adapter.
export function createRawGLContext(native,canvas) {
  if(typeof native.rawGlCall!=='function')throw new Error('Rebuild the runtime with raw OpenGL bridge support');
  const cmd=globalThis.__TN?.cmd;
  if(typeof cmd?.rawGL!=='function')throw new Error('Load the main command buffer before creating direct GL');
  cmd.configureRawGL(OPS,process.env.THREEBROWSER_DISABLE_RAW_GL_COALESCING!=='1',process.env.THREEBROWSER_RAW_GL_UNIFORM_CACHE==='1');
  const synchronous=new Set(SYNC),encoder=new TextEncoder();
  const invoke=(name,args=[],data)=>{
    if(synchronous.has(name)) {cmd.invalidateRawGL();cmd.submit();return native.rawGlCall(OPS[name],args.map(x=>x==null?0:Number(x)),data);}
    const payload=data==null?null:typeof data==='string'?encoder.encode(data):data;
    cmd.rawGL(OPS[name],args,payload);
  };
  const gl={...CONSTANTS,canvas,getCommandStats:()=>({...cmd.rawGLStats})};
  Object.defineProperties(gl,{drawingBufferWidth:{get:()=>canvas.width},drawingBufferHeight:{get:()=>canvas.height}});
  const sources=new Map(),webPixelStore=new Map();
  const extensions={
    EXT_color_buffer_float:{},EXT_color_buffer_half_float:{},OES_texture_float_linear:{},
    EXT_texture_filter_anisotropic:{TEXTURE_MAX_ANISOTROPY_EXT:0x84fe,MAX_TEXTURE_MAX_ANISOTROPY_EXT:0x84ff}
  };
  gl.getSupportedExtensions=()=>Object.keys(extensions);
  gl.getExtension=name=>extensions[name]??null;
  gl.isContextLost=()=>!native.isOpen();
  gl.getContextAttributes=()=>({alpha:false,antialias:false,depth:true,stencil:true,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'default'});
  gl.getShaderPrecisionFormat=(_,precision)=>[gl.HIGH_FLOAT,gl.MEDIUM_FLOAT,gl.LOW_FLOAT].includes(precision)?{rangeMin:127,rangeMax:127,precision:23}:{rangeMin:31,rangeMax:30,precision:0};
  for(const name of Object.keys(OPS))gl[name]=(...args)=>invoke(name,args);
  for(const kind of ['Buffer','Texture','Framebuffer','Renderbuffer','VertexArray','Program','Shader'])gl['create'+kind]=(...args)=>{
    const id=invoke('create'+kind,args);
    return id?Object.freeze({id,kind,valueOf(){return id;}}):null;
  };
  gl.shaderSource=(shader,source)=>{sources.set(shader,source);invoke('shaderSource',[shader],source);};
  gl.getShaderSource=shader=>sources.get(shader)??'';
  gl.deleteShader=shader=>{sources.delete(shader);invoke('deleteShader',[shader]);};
  for(const kind of ['Uniform','Attrib'])gl['get'+kind+'Location']=(program,name)=>{const value=invoke('get'+kind+'Location',[program],name);return kind==='Uniform'&&value<0?null:value;};
  gl.bindAttribLocation=(program,index,name)=>invoke('bindAttribLocation',[program,index],name);
  gl.getProgramParameter=(program,pname)=>{const v=invoke('getProgramParameter',[program,pname]);return [gl.LINK_STATUS,gl.VALIDATE_STATUS,gl.DELETE_STATUS].includes(pname)?!!v:v;};
  gl.getShaderParameter=(shader,pname)=>{const v=invoke('getShaderParameter',[shader,pname]);return [gl.COMPILE_STATUS,gl.DELETE_STATUS].includes(pname)?!!v:v;};
  gl.pixelStorei=(pname,value)=>{
    if([gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_COLORSPACE_CONVERSION_WEBGL].includes(pname))webPixelStore.set(pname,value);
    else invoke('pixelStorei',[pname,value]);
  };
  gl.getParameter=pname=>webPixelStore.has(pname)?webPixelStore.get(pname):invoke('getParameter',[pname]);
  function slice(data,offset=0,length) {
    if(data==null)return null;
    if(data instanceof ArrayBuffer)return new Uint8Array(data,offset,length);
    if(!ArrayBuffer.isView(data)||data instanceof DataView)throw new Error('Raw GL requires typed pixel/buffer data; DOM image uploads are unsupported');
    return offset||length!==undefined?data.subarray(offset,length===undefined?undefined:offset+length):data;
  }
  gl.bufferData=(target,data,usage,offset=0,length)=>{
    if(typeof data==='number') {if(data<0||!Number.isSafeInteger(data))throw new Error('Invalid buffer size');invoke('bufferData',[target,data,usage]);}
    else {const view=slice(data,offset,length);invoke('bufferData',[target,view.byteLength,usage],view);}
  };
  gl.bufferSubData=(target,offset,data,sourceOffset=0,length)=>invoke('bufferSubData',[target,offset],slice(data,sourceOffset,length));
  gl.getBufferSubData=(target,offset,data,destinationOffset=0,length)=>invoke('getBufferSubData',[target,offset],slice(data,destinationOffset,length));
  gl.drawBuffers=values=>invoke('drawBuffers',[],new Uint32Array(values));
  gl.invalidateFramebuffer=(target,values)=>invoke('invalidateFramebuffer',[target],new Uint32Array(values));
  for(let n=1;n<=4;n++)for(const suffix of ['f','i','ui']){
    const Type=suffix==='f'?Float32Array:suffix==='i'?Int32Array:Uint32Array;
    gl[`uniform${n}${suffix}`]=(location,...values)=>{if(location!==null)invoke(`uniform${n}${suffix}`,[location,...values]);};
    gl[`uniform${n}${suffix}v`]=(location,values,offset=0,length)=>{if(location!==null)invoke(`uniform${n}${suffix}v`,[location],slice(values instanceof Type?values:new Type(values),offset,length));};
  }
  for(let n=2;n<=4;n++)gl[`uniformMatrix${n}fv`]=(location,transpose,values,offset=0,length)=>{
    if(transpose)throw new Error('WebGL matrix transpose must be false');
    if(location!==null)invoke(`uniformMatrix${n}fv`,[location,0],slice(values instanceof Float32Array?values:new Float32Array(values),offset,length));
  };
  for(let n=1;n<=4;n++)gl[`vertexAttrib${n}fv`]=(index,data)=>invoke(`vertexAttrib${n}fv`,[index],data instanceof Float32Array?data:new Float32Array(data));
  for(const [name,count] of [['texImage2D',8],['texSubImage2D',8],['texImage3D',9],['texSubImage3D',10]])gl[name]=(...args)=>{
    if(args.length<count+1)throw new Error(`${name}: raw GL supports typed-data overloads only`);
    const data=slice(args[count],args[count+1]??0);
    invoke(name,args.slice(0,count),data);
  };
  gl.readPixels=(x,y,width,height,format,type,destination,offset=0)=>invoke('readPixels',[x,y,width,height,format,type],slice(destination,offset));
  return gl;
}

export function createRawGLRenderer(T,host,size) {
  if(!host.native.start(size,size,'ThreeBrowser direct OpenGL experiment',0))throw new Error(host.native.lastError());
  host.native.setLoading(false,'Direct OpenGL');host.native.rawGlReset();host.loadCommandBuffer();
  const canvas=host.document.createElement('canvas');canvas.width=size;canvas.height=size;
  const context=createRawGLContext(host.native,canvas);
  const renderer=new T.WebGLRenderer({canvas,context,antialias:false,alpha:false});
  const render=renderer.render.bind(renderer);
  renderer.render=(scene,camera)=>{render(scene,camera);if(renderer.getRenderTarget()===null)context.present();};
  const dispose=renderer.dispose.bind(renderer);
  renderer.dispose=()=>{dispose();context.flush();};
  return renderer;
}
